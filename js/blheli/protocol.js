import { crc16Xmodem } from '../utils/crc.js';
import { delay } from '../utils/bytes.js';
import { log } from '../ui/log.js';

export const CMD_LOCAL_ESCAPE         = 0x2F; // '/'
export const CMD_REMOTE_ESCAPE        = 0x2E; // '.'

// Official 4-Way Command codes from serial_4way.c & BLHeliSuite32:
export const CMD_INTERFACE_TEST_ALIVE = 0x30;
export const CMD_PROTOCOL_GET_VERSION = 0x31;
export const CMD_INTERFACE_GET_NAME   = 0x32;
export const CMD_INTERFACE_GET_VER    = 0x33;
export const CMD_INTERFACE_EXIT       = 0x34;
export const CMD_DEVICE_RESET         = 0x35;
export const CMD_DEVICE_INIT_FLASH    = 0x37;
export const CMD_DEVICE_READ          = 0x3A;
export const CMD_DEVICE_WRITE         = 0x3B;
export const CMD_INTERFACE_SET_MODE   = 0x3F; // 0x04 = BLHeli32 mode

// Sends standard MSP command to Flight Controller
export async function sendMsp(writer, cmd, payload = []) {
    const size = payload.length;
    let checksum = size ^ cmd;
    for (let b of payload) checksum ^= b;
    const frame = new Uint8Array([0x24, 0x4D, 0x3C, size, cmd, ...payload, checksum]);
    await writer.write(frame);
    await delay(50);
}

// Persistent stream reader loop per reader instance to prevent competing Promise.race reads
const readerBuffers = new WeakMap();

function getReaderSession(reader) {
    let session = readerBuffers.get(reader);
    if (!session) {
        session = {
            buffer: new Uint8Array(0),
            waiters: [],
            running: true,
            loopPromise: null
        };
        session.loopPromise = (async () => {
            try {
                while (session.running) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    if (value && value.length > 0) {
                        const next = new Uint8Array(session.buffer.length + value.length);
                        next.set(session.buffer);
                        next.set(value, session.buffer.length);
                        session.buffer = next;

                        if (session.waiters.length > 0) {
                            const cbs = [...session.waiters];
                            session.waiters = [];
                            cbs.forEach(cb => cb());
                        }
                    }
                }
            } catch (err) {
                // Reader cancelled or error
            } finally {
                session.running = false;
                if (session.waiters.length > 0) {
                    const cbs = [...session.waiters];
                    session.waiters = [];
                    cbs.forEach(cb => cb());
                }
            }
        })();
        readerBuffers.set(reader, session);
    }
    return session;
}

/**
 * Accumulates incoming bytes from the persistent reader loop until expected 4-Way frame is ready.
 * Synchronizes immediately on CMD_REMOTE_ESCAPE (0x2E), discarding any leading noise.
 */
export async function read4WayRaw(reader, timeoutMs = 2500) {
    const session = getReaderSession(reader);
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        // Discard any noise prior to 0x2E
        let escIdx = -1;
        for (let i = 0; i < session.buffer.length; i++) {
            if (session.buffer[i] === CMD_REMOTE_ESCAPE) {
                escIdx = i;
                break;
            }
        }
        if (escIdx > 0) {
            session.buffer = session.buffer.slice(escIdx);
        }

        // Check if full 4-Way frame is present
        if (session.buffer.length >= 6 && session.buffer[0] === CMD_REMOTE_ESCAPE) {
            const rawLen = session.buffer[4];
            const expectedDataLen = (rawLen === 0 && (session.buffer[1] === CMD_DEVICE_READ || session.buffer[1] === CMD_DEVICE_WRITE)) ? 256 : rawLen;
            const totalExpected = 5 + expectedDataLen + 1 + 2; // header(5) + data + ACK(1) + CRC(2)
            if (session.buffer.length >= totalExpected) {
                const frame = session.buffer.slice(0, totalExpected);
                session.buffer = session.buffer.slice(totalExpected);
                return frame;
            }
        }

        if (!session.running) break;

        const remaining = timeoutMs - (Date.now() - start);
        if (remaining <= 0) break;

        await new Promise(resolve => {
            let timer = null;
            const onData = () => {
                if (timer) clearTimeout(timer);
                resolve();
            };
            timer = setTimeout(() => {
                const idx = session.waiters.indexOf(onData);
                if (idx !== -1) session.waiters.splice(idx, 1);
                resolve();
            }, Math.min(remaining, 500));
            session.waiters.push(onData);
        });
    }

    // If timeout reached without complete packet, return available buffer or empty
    const remainingBuf = session.buffer;
    session.buffer = new Uint8Array(0);
    return remainingBuf;
}

// Sends official 4-Way packet: [0x2F, CMD, AddrHi, AddrLo, ParamLen, ...params, CrcHi, CrcLo]
// NOTE: 4-Way Address is Big-Endian: [AddrHi, AddrLo] (e.g. 0xF800 -> [0xF8, 0x00] giving CRC 0x93F4)
export async function send4WayCmd(writer, reader, cmd, addr = 0, params = [], timeoutMs = 2500) {
    const pLen = params.length > 255 ? 0 : params.length;
    const addrHi = (addr >> 8) & 0xFF;
    const addrLo = addr & 0xFF;
    const header = [CMD_LOCAL_ESCAPE, cmd, addrHi, addrLo, pLen];
    const body = [...header, ...params];
    const crc = crc16Xmodem(body);
    const packet = new Uint8Array([...body, (crc >> 8) & 0xFF, crc & 0xFF]);

    await writer.write(packet);

    const resp = await read4WayRaw(reader, timeoutMs);
    if (!resp || resp.length < 6) {
        return { ok: false, msg: `Таймаут (отримано ${resp ? resp.length : 0} байт)` };
    }

    // Find escape byte if any noise preceded it
    let escIdx = -1;
    for (let i = 0; i < resp.length; i++) {
        if (resp[i] === CMD_REMOTE_ESCAPE) {
            escIdx = i;
            break;
        }
    }

    if (escIdx === -1) {
        return { ok: false, msg: `Немає 0x2E у відповіді (отримано: ${Array.from(resp.slice(0, 8)).map(b => '0x' + b.toString(16)).join(' ')})` };
    }

    const cleanResp = resp.slice(escIdx);
    if (cleanResp.length < 6) {
        return { ok: false, msg: 'Неповний 4-Way кадр' };
    }

    const respCmd = cleanResp[1];
    const respAddr = (cleanResp[2] << 8) | cleanResp[3];
    const rawParamLen = cleanResp[4];
    const dataLen = (rawParamLen === 0 && (respCmd === CMD_DEVICE_READ || respCmd === CMD_DEVICE_WRITE)) ? 256 : rawParamLen;
    const ackIndex = 5 + dataLen;

    if (cleanResp.length < ackIndex + 3) {
        return { ok: false, msg: `Неповний 4-Way кадр (довжина ${cleanResp.length}, очікується ${ackIndex + 3})` };
    }

    const ack = cleanResp[ackIndex];
    const dataBytes = cleanResp.slice(5, ackIndex);

    // 1. Перевірка CRC відповіді (CRC16/XMODEM по всьому кадру до байта ACK включно)
    const frameLen = ackIndex + 1;
    let crcOk = false;
    const calc = crc16Xmodem(cleanResp.slice(0, frameLen));
    const got = (cleanResp[frameLen] << 8) | cleanResp[frameLen + 1];
    crcOk = (calc === got);

    if (!crcOk) {
        return { ok: false, msg: `Помилка CRC відповіді 4-Way (calc: 0x${calc.toString(16)}, got: 0x${got.toString(16)})`, crcOk: false };
    }

    // 2. Валідація команди (cmd echo match)
    if (respCmd !== cmd) {
        return { ok: false, msg: `Невідповідність команди у відповіді: очікувалось 0x${cmd.toString(16)}, отримано 0x${respCmd.toString(16)}`, crcOk };
    }

    // 3. Валідація адреси (якщо передана ненульова адреса)
    if (addr !== 0 && respAddr !== addr) {
        return { ok: false, msg: `Невідповідність адреси у відповіді: очікувалось 0x${addr.toString(16)}, отримано 0x${respAddr.toString(16)}`, crcOk };
    }

    // 4. Валідація байта ACK (0x00 = ACK_OK)
    if (ack !== 0x00) {
        return { ok: false, msg: `Помилка ACK від ESC: 0x${ack.toString(16)}`, ack, crcOk };
    }

    return { ok: true, data: dataBytes, raw: cleanResp, ack, crcOk: true };
}

// Switches FC to 4-Way, verifies BLHeli32 interface mode
export async function init4WayInterface(writer, reader) {
    // 0. Check if FC is already in 4-Way mode before sending MSP 245
    let pVer = await send4WayCmd(writer, reader, CMD_PROTOCOL_GET_VERSION, 0, [0], 400);
    if (!pVer.ok) {
        log('[4-Way] Ініціалізація 4-Way passthrough (MSP 245)...');
        // Exact MSP payload from BLHeliSuite32 log: [0x24, 0x4D, 0x3C, 0x00, 0xF5, 0xF5]
        await sendMsp(writer, 245, []);

        // Give FC enough time to switch UART muxing to 4-Way
        await delay(400);

        // 1. Check protocol version (cmd 0x31)
        pVer = await send4WayCmd(writer, reader, CMD_PROTOCOL_GET_VERSION, 0, [0], 1500);
    }
    if (!pVer.ok) {
        throw new Error(`Помилка 4-Way GET_VERSION: ${pVer.msg}`);
    }
    log(`[4-Way] Протокол 4-Way активний: v${pVer.data[0] || '108'}`);

    // 2. Set Interface Mode to BLHeli32 (cmd 0x3F, param [0x04]) - MANDATORY!
    log('[4-Way] Активація режиму BLHeli32 (InterfaceSetMode 0x04)...');
    const mRes = await send4WayCmd(writer, reader, CMD_INTERFACE_SET_MODE, 0, [0x04], 1500);
    if (!mRes.ok) {
        throw new Error(`Помилка 4-Way SET_MODE: ${mRes.msg}`);
    }
    log('[4-Way] Режим BLHeli32 успішно активовано.');
    // Пауза перед початком опитування моторів для повної стабілізації апаратної шини 4-Way
    await delay(2000);
}

// Connects to a specific ESC bootloader (STM32G0 ARM) exactly like BLHeliSuite32
export async function connectEscDevice(writer, reader, escIndex) {
    let lastInitRes = null;

    // Спроби ініціалізації (до 4 спроб з адаптивною паузою для усунення випадкових затримок стабілізації бутлоадера ESC)
    const MAX_ATTEMPTS = 4;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        // Step A: cmd_ProtocolGetVersion (resets channel state in FC)
        await send4WayCmd(writer, reader, CMD_PROTOCOL_GET_VERSION, 0, [0], 800);
        await delay(350);

        // Step B: cmd_DeviceReset(escIndex)
        await send4WayCmd(writer, reader, CMD_DEVICE_RESET, 0, [escIndex], 800);
        await delay(520); // bootloader delay

        // Step C: cmd_DeviceInitFlash(escIndex) -> returns chip signature & bootloader
        const initRes = await send4WayCmd(writer, reader, CMD_DEVICE_INIT_FLASH, 0, [escIndex], 1200);
        if (initRes.ok) {
            lastInitRes = initRes;
            break;
        }

        lastInitRes = initRes;
        if (attempt < MAX_ATTEMPTS) {
            const retryDelay = 250 + (attempt * 200); // 450ms, 650ms, 850ms
            log(`[ESC #${escIndex + 1} InitFlash спроба ${attempt}/${MAX_ATTEMPTS} не вдалась (${initRes.msg})]. Повтор через ${retryDelay}мс...`);
            await delay(retryDelay);
        }
    }

    if (!lastInitRes || !lastInitRes.ok) {
        log(`[ESC #${escIndex + 1} InitFlash RAW FAIL]: ${lastInitRes ? lastInitRes.msg : 'невідома помилка'}`);
        return { ok: false, msg: lastInitRes ? lastInitRes.msg : 'Помилка ініціалізації Flash' };
    }

    const initRes = lastInitRes;
    const rawInitHex = Array.from(initRes.data).map(b => b.toString(16).padStart(2, '0')).join(' ');
    log(`[ESC #${escIndex + 1} InitFlash RAW]: bytes[${initRes.data.length}] = ${rawInitHex}`);

    const KNOWN_MCUS = {
        '0460': 'STM32G071',
        '0466': 'STM32G031',
        '0467': 'STM32G0B1',
        '0444': 'STM32F051',
        '0440': 'STM32F030',
        '0448': 'STM32F070',
        '0410': 'STM32F103',
        '0421': 'STM32F446',
        '0452': 'STM32F722',
        '0450': 'STM32F745',
        '0484': 'STM32G474',
        'E8B2': '0xE8B2',
        'B2E8': '0xE8B2',
        'E8B1': '0xE8B1',
        'B1E8': '0xE8B1'
    };

    let chipInfo = 'ARM 32-bit';
    let mcu = 'ARM 32-bit';
    let signatureHex = '0x????';

    if (initRes.data.length >= 4) {
        const rawSig = ((initRes.data[1] << 8) | initRes.data[0]).toString(16).toUpperCase().padStart(4, '0');
        signatureHex = `0x${rawSig}`;
        mcu = KNOWN_MCUS[rawSig] || `MCU 0x${rawSig}`;
        chipInfo = `${mcu} (${signatureHex})`;
    }

    return { ok: true, chipInfo, mcu, signatureHex };
}

// Disconnects an ESC device cleanly
export async function disconnectEscDevice(writer, reader, escIndex) {
    try {
        await send4WayCmd(writer, reader, CMD_DEVICE_RESET, 0, [escIndex], 600);
        await delay(30);
    } catch (_) {}
}
