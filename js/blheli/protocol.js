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

// Accumulates incoming bytes from reader until expected length or timeout
export async function read4WayRaw(reader, timeoutMs = 2500) {
    const start = Date.now();
    let buffer = new Uint8Array(0);

    while (Date.now() - start < timeoutMs) {
        const { value, done } = await Promise.race([
            reader.read(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 800))
        ]).catch(() => ({ value: null, done: false }));

        if (done) break;
        if (value && value.length > 0) {
            const next = new Uint8Array(buffer.length + value.length);
            next.set(buffer);
            next.set(value, buffer.length);
            buffer = next;

            // 4-Way packet structure:
            // [0] Escape (0x2E)
            // [1] CMD
            // [2,3] Addr Lo, Hi
            // [4] Param Len (0 = 256 for read)
            if (buffer.length >= 6 && buffer[0] === CMD_REMOTE_ESCAPE) {
                const rawLen = buffer[4];
                const expectedDataLen = (rawLen === 0 && (buffer[1] === CMD_DEVICE_READ || buffer[1] === CMD_DEVICE_WRITE)) ? 256 : rawLen;
                // Total frame = 5 header bytes + data + 1 ACK byte + 2 CRC bytes
                const totalExpected = 5 + expectedDataLen + 1 + 2;
                if (buffer.length >= totalExpected) {
                    break;
                }
            }
        }
    }
    return buffer;
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

    const rawParamLen = cleanResp[4];
    const dataLen = (rawParamLen === 0 && (cleanResp[1] === CMD_DEVICE_READ || cleanResp[1] === CMD_DEVICE_WRITE)) ? 256 : rawParamLen;
    const ackIndex = 5 + dataLen;
    const ack = cleanResp[ackIndex];

    if (ack !== 0x00) {
        return { ok: false, msg: `Помилка ACK від ESC: 0x${(ack !== undefined ? ack.toString(16) : 'null')}`, ack };
    }

    const dataBytes = cleanResp.slice(5, 5 + dataLen);

    // Перевірка CRC відповіді (CRC16/XMODEM по всьому кадру без двох останніх байтів)
    const frameLen = ackIndex + 1;
    let crcOk = false;
    if (cleanResp.length >= frameLen + 2) {
        const calc = crc16Xmodem(cleanResp.slice(0, frameLen));
        const got = (cleanResp[frameLen] << 8) | cleanResp[frameLen + 1];
        crcOk = calc === got;
    }
    return { ok: true, data: dataBytes, raw: cleanResp, crcOk };
}

// Switches FC to 4-Way, verifies BLHeli32 interface mode
export async function init4WayInterface(writer, reader) {
    log('[4-Way] Ініціалізація 4-Way passthrough (MSP 245)...');
    // Exact MSP payload from BLHeliSuite32 log: [0x24, 0x4D, 0x3C, 0x00, 0xF5, 0xF5]
    await sendMsp(writer, 245, []);
    
    // Wait for MSP response from FC: [0x24, 0x4D, 0x3E, 0x01, 0xF5, 0x04, 0xF0]
    try {
        await Promise.race([
            reader.read(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 500))
        ]);
    } catch (_) {}
    await delay(150);

    // 1. Check protocol version (cmd 0x31)
    const pVer = await send4WayCmd(writer, reader, CMD_PROTOCOL_GET_VERSION, 0, [0], 1500);
    if (pVer.ok) {
        log(`[4-Way] Протокол 4-Way активний: v${pVer.data[0] || '108'}`);
    }

    // 2. Set Interface Mode to BLHeli32 (cmd 0x3F, param [0x04]) - MANDATORY!
    log('[4-Way] Активація режиму BLHeli32 (InterfaceSetMode 0x04)...');
    const mRes = await send4WayCmd(writer, reader, CMD_INTERFACE_SET_MODE, 0, [0x04], 1500);
    if (!mRes.ok) {
        log(`[4-Way попередження]: ${mRes.msg}`);
    } else {
        log('[4-Way] Режим BLHeli32 успішно активовано.');
    }
    // Пауза перед початком опитування моторів
    await delay(300);
}

// Connects to a specific ESC bootloader (STM32G0 ARM) exactly like BLHeliSuite32
export async function connectEscDevice(writer, reader, escIndex) {
    // Step A: cmd_ProtocolGetVersion (resets channel state in FC)
    await send4WayCmd(writer, reader, CMD_PROTOCOL_GET_VERSION, 0, [0], 800);
    await delay(30);

    // Step B: cmd_DeviceReset(escIndex)
    await send4WayCmd(writer, reader, CMD_DEVICE_RESET, 0, [escIndex], 800);
    await delay(100); // 100ms bootloader delay as in BLHeliSuite32

    // Step C: cmd_DeviceInitFlash(escIndex) -> returns chip signature & bootloader
    const initRes = await send4WayCmd(writer, reader, CMD_DEVICE_INIT_FLASH, 0, [escIndex], 1200);
    if (!initRes.ok) {
        return { ok: false, msg: initRes.msg };
    }

    let chipInfo = 'ARM 32-bit';
    if (initRes.data.length >= 4) {
        const sig = ((initRes.data[1] << 8) | initRes.data[0]).toString(16).toUpperCase();
        chipInfo = `Сигнатура: 0x${sig}`;
    }
    return { ok: true, chipInfo };
}

// Disconnects an ESC device cleanly
export async function disconnectEscDevice(writer, reader, escIndex) {
    try {
        await send4WayCmd(writer, reader, CMD_DEVICE_RESET, 0, [escIndex], 600);
        await delay(30);
    } catch (_) {}
}
