/**
 * BLHeli_32 EEPROM access and session lifecycle management.
 */

import { delay } from '../utils/bytes.js';
import { state } from '../core/state.js';
import { resolveSelectedPort, closeSerialSession } from '../core/serial.js';
import { log } from '../ui/log.js';
import { setStepStatus, setEscBadge, setAllEscButtons, setEscFlowStep } from '../ui/status.js';
import { updateEscInfoPanel } from '../ui/infoPanel.js';
import { showPopup } from '../ui/modal.js';
import {
    CMD_DEVICE_READ,
    CMD_INTERFACE_EXIT,
    init4WayInterface,
    connectEscDevice,
    disconnectEscDevice,
    send4WayCmd
} from './protocol.js';
import {
    BL32_PRESET_SETTINGS,
    BL32_HEADER_NORMAL_100,
    BL32_HEADER_REVERSED_100,
    detectMotorDirection
} from './preset.js';
import { bytesEqual } from '../utils/bytes.js';
import { isEscSessionActive } from './session.js';

export const BL32_EEPROM_ADDR = 0xF800;
export const ESC_BLOCK_LEN    = 256;
export const ESC_COUNT        = 4;

/**
 * Open serial port, enter 4-Way mode, execute callback, and safely exit 4-Way & close port.
 * If a persistent session is already active, reuses its writer/reader without closing.
 * @param {Function} fn - async (writer, reader) => result
 * @returns {Promise<any>}
 */
export async function withEscSession(fn) {
    if (isEscSessionActive()) {
        setAllEscButtons(true);
        try {
            return await fn(state.escSession.writer, state.escSession.reader);
        } finally {
            setAllEscButtons(false);
        }
    }

    let reader = null, writer = null;
    setAllEscButtons(true);
    try {
        // Retry loop to accommodate OS COM port re-enumeration after FC reboot
        let opened = false;
        let lastOpenErr = null;
        for (let attempt = 1; attempt <= 7; attempt++) {
            try {
                state.port = await resolveSelectedPort(log);
                await state.port.open({ baudRate: 115200 });
                opened = true;
                break;
            } catch (openErr) {
                lastOpenErr = openErr;
                log(`[BLHeli_32] Очікування готовності COM-порту (спроба ${attempt}/7: ${openErr.message})...`);
                await delay(700);
            }
        }

        if (!opened) {
            throw lastOpenErr || new Error('Не вдалося відкрити COM-порт.');
        }

        log('\n[BLHeli_32] COM-порт відкрито на 115200.');
        writer = state.port.writable.getWriter();
        reader = state.port.readable.getReader();
        await init4WayInterface(writer, reader);
        return await fn(writer, reader);
    } finally {
        setEscFlowStep('close', 'working');
        try {
            const exitRes = await send4WayCmd(writer, reader, CMD_INTERFACE_EXIT, 0, [0], 600);
            log(`[BLHeli_32] Команду виходу 0x34 виконано (${exitRes.ok ? 'ACK OK' : exitRes.msg}).`);
            setEscFlowStep('close', exitRes.ok ? 'success' : 'fail');
        } catch (_) {
            setEscFlowStep('close', 'fail');
        }
        await delay(200);
        await closeSerialSession(state.port, reader, writer, null);
        state.port = null;
        setAllEscButtons(!isEscSessionActive());
        log('[BLHeli_32] COM-порт звільнено.');
    }
}

/**
 * Connect to an ESC and read its 256-byte EEPROM block with CRC verification (up to 3 attempts).
 * @param {WritableStreamDefaultWriter} writer
 * @param {ReadableStreamDefaultReader} reader
 * @param {number} esc - 0-indexed ESC number (0..3)
 * @returns {Promise<{ok: boolean, data?: Uint8Array, signature?: string, mcu?: string, signatureHex?: string, msg?: string}>}
 */
export async function readEscBlock(writer, reader, esc) {
    const conn = await connectEscDevice(writer, reader, esc);
    if (!conn.ok) return { ok: false, msg: conn.msg };

    const sigMatch = conn.chipInfo.match(/0x[0-9A-F]+/i);
    const signature = sigMatch ? sigMatch[0].toLowerCase() : 'unknown';

    let lastMsg = 'невідома помилка';
    for (let attempt = 1; attempt <= 3; attempt++) {
        const res = await send4WayCmd(writer, reader, CMD_DEVICE_READ, BL32_EEPROM_ADDR, [0x00]);
        if (res.ok && res.data.length === ESC_BLOCK_LEN && res.crcOk) {
            const hexHeader = Array.from(res.data.slice(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' ');
            log(`[ESC #${esc + 1} Read RAW (0x00..0x1F)]: ${hexHeader}`);
            return { ok: true, data: new Uint8Array(res.data), signature, mcu: conn.mcu, signatureHex: conn.signatureHex, rawData: res.data };
        }
        lastMsg = !res.ok ? res.msg
            : (res.data.length !== ESC_BLOCK_LEN ? `довжина ${res.data.length} замість ${ESC_BLOCK_LEN}` : 'CRC відповіді не збігся');
        log(`ESC #${esc + 1}: спроба читання ${attempt}/3 невдала (${lastMsg})`);
        await delay(150);
    }
    return { ok: false, msg: lastMsg };
}

/**
 * Complete read sequence for all 4 ESCs with telemetry updates and hex dumping.
 * Operates either within an existing active session or temporary session.
 */
export async function readAllEscSettings() {
    if (!('serial' in navigator)) {
        setStepStatus(2, 'fail');
        showPopup('error', 'Помилка', 'Web Serial API не підтримується.');
        return;
    }

    const hasActiveSession = isEscSessionActive();

    setStepStatus(2, 'working');
    setAllEscButtons(true);
    for (let i = 0; i < 4; i++) setEscBadge(i, 'pending', 'Очікування');

    const executeRead = async (writer, reader) => {
        let foundEscCount = 0;
        const escDetails = [];

        for (let esc = 0; esc < 4; esc++) {
            log(`\n--- Зчитування ESC #${esc + 1} (Канал ${esc}) ---`);
            setEscBadge(esc, 'working', 'Підключення...');

            // 1. Підключення до бутлоадера ESC (Reset + InitFlash)
            const connRes = await connectEscDevice(writer, reader, esc);
            if (!connRes.ok) {
                log(`ESC #${esc + 1}: не відповідає. Перевірте LiPo живлення! (${connRes.msg})`);
                setEscBadge(esc, 'fail', 'Немає відповіді');
                continue;
            }
            log(`ESC #${esc + 1}: Знайдено (${connRes.chipInfo})`);

            // 2. Зчитування 256 байтів EEPROM/Setup (cmd_DeviceRead 0x3A, Addr: 0xF800, len 0 = 256)
            setEscBadge(esc, 'working', 'Читання EEPROM...');
            const readRes = await send4WayCmd(writer, reader, CMD_DEVICE_READ, BL32_EEPROM_ADDR, [0x00]);
            if (!readRes.ok || readRes.data.length < 32) {
                log(`ESC #${esc + 1}: помилка зчитування Flash/EEPROM (${readRes.msg})`);
                setEscBadge(esc, 'fail', 'Збій читання');
                continue;
            }

            foundEscCount++;
            const pageData = readRes.data;

            // Перевірка напрямку та відповідності нашому пресету
            const direction = detectMotorDirection(pageData.slice(0, 8), esc);
            const hasPresetSettings = pageData.length >= 32 && bytesEqual(pageData.slice(0x10, 0x20), BL32_PRESET_SETTINGS);
            const expectedHeader = (direction === 'reversed') ? BL32_HEADER_REVERSED_100 : BL32_HEADER_NORMAL_100;
            const hasPresetHeader = bytesEqual(pageData.slice(0, 8), expectedHeader);
            const presetMatched = hasPresetSettings && hasPresetHeader;

            // Витяг відкритого ASCII тексту назви та версії прошивки з блоку
            let asciiName = '';
            for (let i = 0x20; i < pageData.length - 8; i++) {
                const slice = pageData.slice(i, i + 32);
                let str = '';
                for (let b of slice) {
                    if (b >= 32 && b <= 126) str += String.fromCharCode(b);
                    else break;
                }
                if (str.length >= 6 && (str.includes('32.') || str.includes('BLHeli') || str.includes('_') || str.includes('Rev'))) {
                    asciiName = str;
                    break;
                }
            }

            const isBluejay = (connRes.signatureHex === '0xE8B2' || connRes.signatureHex === '0xB2E8' || 
                               connRes.signatureHex === '0xE8B1' || connRes.signatureHex === '0xB1E8' ||
                               (asciiName && asciiName.toLowerCase().includes('bluejay')));
            const detectedModelName = isBluejay ? 'Bluejay 8-bit' : (asciiName || 'BLHeli_32');

            escDetails.push({
                esc,
                direction,
                presetMatched,
                chip: connRes.chipInfo,
                mcu: connRes.mcu || 'ARM 32-bit',
                signature: connRes.signatureHex || '0x????',
                ack: 'OK (LiPo є)',
                modelName: detectedModelName
            });

            // Повний hex-дамп 256 байтів
            log(`ESC #${esc + 1} RAW 0xF800 (${pageData.length} байт, ${direction.toUpperCase()}, ${presetMatched ? 'Пресет 100% OK' : 'Stock/Інше'}):`);
            for (let off = 0; off < pageData.length; off += 16) {
                const row = Array.from(pageData.slice(off, off + 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
                log(`  ${off.toString(16).padStart(4, '0')}: ${row}`);
            }

            setEscBadge(esc, 'ok', presetMatched ? `${direction.toUpperCase()} (100%)` : `${direction.toUpperCase()}`);

            // Чисто відключаємо поточний ESC перед переходом до наступного
            await disconnectEscDevice(writer, reader, esc);
        }

        // Оновлюємо інфо-панель зліва даними про мотори
        updateEscInfoPanel(escDetails);

        return { foundEscCount, escDetails };
    };

    try {
        let result = null;
        if (hasActiveSession) {
            // Використовуємо активну сесію без закриття порту
            result = await executeRead(state.escSession.writer, state.escSession.reader);
        } else {
            // Одноразова сесія (фолбек)
            result = await withEscSession(async (writer, reader) => {
                return await executeRead(writer, reader);
            });
        }

        const { foundEscCount, escDetails } = result;

        if (foundEscCount === 4) {
            setStepStatus(2, 'success');
            showPopup('success', 'Дані успішно зчитано', `Зчитано всі 4 ESC!\n\n` + escDetails.map(e => `ESC #${e.esc + 1}: ${e.direction.toUpperCase()} (${e.presetMatched ? '100%' : 'Stock'}) - ${e.mcu}`).join('\n'), 3500);
        } else if (foundEscCount > 0) {
            setStepStatus(2, 'awaiting');
            showPopup('error', 'Зчитано частково', `Знайдено ${foundEscCount} з 4 ESC.\nПеревірте живлення LiPo!\n\n` + escDetails.map(e => `ESC #${e.esc + 1}: ${e.direction.toUpperCase()} - ${e.mcu}`).join('\n'));
        } else {
            setStepStatus(2, 'fail');
            showPopup('error', 'ESC не відповідають', 'Жоден регулятор не відповів. Переконайтеся, що LiPo батарея підключена і мотори пропіщали!');
        }

    } catch (err) {
        console.error(err);
        setStepStatus(2, 'fail');
        log(`[ESC Помилка читання]: ${err.message}`);
        showPopup('error', 'Збій зчитування ESC', err.message);
    } finally {
        setAllEscButtons(!isEscSessionActive());
    }
}
