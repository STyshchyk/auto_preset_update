import { delay } from '../utils/bytes.js';
import { state } from '../core/state.js';
import { resolveSelectedPort, closeSerialSession } from '../core/serial.js';
import { log } from '../ui/log.js';
import { setEscBadge, setStepStatus, setAllEscButtons } from '../ui/status.js';
import { showPopup } from '../ui/modal.js';
import {
    CMD_INTERFACE_EXIT,
    CMD_DEVICE_READ,
    send4WayCmd,
    init4WayInterface,
    connectEscDevice,
    disconnectEscDevice
} from './protocol.js';

export const BL32_EEPROM_ADDR = 0xF800;
export const ESC_BLOCK_LEN = 256;
export const ESC_COUNT = 4;

// Відкриває порт, вмикає 4-Way, виконує fn, гарантовано закриває порт
export async function withEscSession(fn) {
    let reader = null, writer = null;
    setAllEscButtons(true);
    try {
        state.port = await resolveSelectedPort(log);
        await state.port.open({ baudRate: 115200 });
        log('\n[BLHeli_32] COM-порт відкрито на 115200.');
        writer = state.port.writable.getWriter();
        reader = state.port.readable.getReader();
        await init4WayInterface(writer, reader);
        return await fn(writer, reader);
    } finally {
        try { await send4WayCmd(writer, reader, CMD_INTERFACE_EXIT, 0, [], 300); } catch (_) {}
        await closeSerialSession(state.port, reader, writer, null);
        state.port = null;
        setAllEscButtons(false);
        log('[BLHeli_32] COM-порт звільнено.');
    }
}

// Підключається до ESC і читає 256 байт з перевіркою CRC (до 3 спроб)
export async function readEscBlock(writer, reader, esc) {
    const conn = await connectEscDevice(writer, reader, esc);
    if (!conn.ok) return { ok: false, msg: conn.msg };

    const sigMatch = conn.chipInfo.match(/0x[0-9A-F]+/i);
    const signature = sigMatch ? sigMatch[0].toLowerCase() : 'unknown';

    let lastMsg = 'невідома помилка';
    for (let attempt = 1; attempt <= 3; attempt++) {
        const res = await send4WayCmd(writer, reader, CMD_DEVICE_READ, BL32_EEPROM_ADDR, [0x00]);
        if (res.ok && res.data.length === ESC_BLOCK_LEN && res.crcOk) {
            return { ok: true, data: new Uint8Array(res.data), signature };
        }
        lastMsg = !res.ok ? res.msg
            : (res.data.length !== ESC_BLOCK_LEN ? `довжина ${res.data.length} замість ${ESC_BLOCK_LEN}` : 'CRC відповіді не збігся');
        log(`ESC #${esc + 1}: спроба читання ${attempt}/3 невдала (${lastMsg})`);
        await delay(150);
    }
    return { ok: false, msg: lastMsg };
}

// Обробник зчитування поточних налаштувань ESC (#btnReadESC)
export async function readAllEscSettings() {
    const btnReadESC = document.getElementById('btnReadESC');
    const btnConfigureESC = document.getElementById('btnConfigureESC');

    if (!('serial' in navigator)) {
        setStepStatus(2, 'fail');
        showPopup('error', 'Помилка', 'Web Serial API не підтримується.');
        return;
    }

    if (btnReadESC) btnReadESC.disabled = true;
    if (btnConfigureESC) btnConfigureESC.disabled = true;
    setStepStatus(2, 'working');
    for (let i = 0; i < 4; i++) setEscBadge(i, 'pending', 'Очікування');

    let reader = null, writer = null;

    try {
        state.port = await resolveSelectedPort(log);
        await state.port.open({ baudRate: 115200 });
        log('\n[BLHeli_32] COM-порт відкрито на 115200.');

        writer = state.port.writable.getWriter();
        reader = state.port.readable.getReader();

        // Ініціалізація 4-Way з режимом BLHeli32
        await init4WayInterface(writer, reader);

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

            // Повний hex-дамп 256 байтів. Формат сторінки BLHeli_32 закритий, тому параметри
            // (Rampup/LowRPM/Beacon) тут НЕ розшифровуються: зміщення раніше були припущенням.
            log(`ESC #${esc + 1} RAW 0xF800 (${pageData.length} байт):`);
            for (let off = 0; off < pageData.length; off += 16) {
                const row = Array.from(pageData.slice(off, off + 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
                log(`  ${off.toString(16).padStart(4, '0')}: ${row}`);
            }

            setEscBadge(esc, 'ok', 'Зчитано (RAW)');
            escDetails.push(`ESC #${esc + 1}: ${connRes.chipInfo}, зчитано ${pageData.length} байт (RAW, без розшифровки)`);

            // Чисто відключаємо поточний ESC перед переходом до наступного
            await disconnectEscDevice(writer, reader, esc);
        }

        // Вихід з 4-Way режиму (cmd 0x34)
        try {
            await send4WayCmd(writer, reader, CMD_INTERFACE_EXIT, 0, [], 300);
        } catch (_) {}

        await closeSerialSession(state.port, reader, writer, null);
        state.port = null;
        log('\n[BLHeli_32] Зчитування завершено. COM-порт звільнено.');

        if (foundEscCount === 4) {
            setStepStatus(2, 'success');
            showPopup('success', 'Дані успішно зчитано', `Зчитано всі 4 ESC!\n\n` + escDetails.join('\n'), 3500);
        } else if (foundEscCount > 0) {
            setStepStatus(2, 'awaiting');
            showPopup('error', 'Зчитано частково', `Знайдено ${foundEscCount} з 4 ESC.\nПеревірте живлення LiPo!\n\n` + escDetails.join('\n'));
        } else {
            setStepStatus(2, 'fail');
            showPopup('error', 'ESC не відповідають', 'Жоден регулятор не відповів. Переконайтеся, що LiPo батарея підключена і мотори пропіщали!');
        }

    } catch (err) {
        console.error(err);
        setStepStatus(2, 'fail');
        log(`[ESC Помилка читання]: ${err.message}`);
        await closeSerialSession(state.port, reader, writer, null);
        state.port = null;
        showPopup('error', 'Збій зчитування ESC', err.message);
    } finally {
        if (btnReadESC) btnReadESC.disabled = false;
        if (btnConfigureESC) btnConfigureESC.disabled = false;
    }
}
