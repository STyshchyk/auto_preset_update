import { delay, bytesEqual } from '../utils/bytes.js';
import { log } from '../ui/log.js';
import { setEscBadge, setStepStatus } from '../ui/status.js';
import { showPopup } from '../ui/modal.js';
import {
    CMD_INTERFACE_TEST_ALIVE,
    CMD_DEVICE_WRITE,
    send4WayCmd,
    connectEscDevice,
    disconnectEscDevice
} from './protocol.js';
import {
    BL32_EEPROM_ADDR,
    ESC_COUNT,
    withEscSession,
    readEscBlock
} from './eeprom.js';

// Еталонний блок налаштувань для Rampup=100%, LowRPM=Off, Beacon=Off (16 байт на зміщенні 0x10..0x1F)
export const BL32_PRESET_SETTINGS = new Uint8Array([
    0x9E, 0xDF, 0xFF, 0x55, 0x21, 0xE8, 0x2E, 0x9C,
    0x16, 0xBA, 0xC7, 0xD7, 0x50, 0xE7, 0xFA, 0x5B
]);

// Синхронізовані заголовки напрямку обертання (хеш 0x00..0x07) для пресету 100%:
export const BL32_HEADER_NORMAL_100 = new Uint8Array([
    0x90, 0xBD, 0x5D, 0xF6, 0xAA, 0x06, 0x4C, 0x53
]);
export const BL32_HEADER_REVERSED_100 = new Uint8Array([
    0x3F, 0xB9, 0xC0, 0xBA, 0x9A, 0x73, 0x5D, 0x27
]);

// Відомі заголовки для стану 50% (для автоматичного розпізнавання напрямку мотора):
export const BL32_HEADER_NORMAL_50 = new Uint8Array([
    0xA6, 0x8B, 0x9C, 0xD8, 0x35, 0x54, 0x67, 0x7C
]);
export const BL32_HEADER_REVERSED_50 = new Uint8Array([
    0x1F, 0xF3, 0x4B, 0x5B, 0x52, 0xA5, 0x18, 0x9A
]);

// Визначає напрямок обертання мотора за його 8-байтним заголовком або номером каналу
export function detectMotorDirection(header8, escIndex) {
    if (bytesEqual(header8, BL32_HEADER_REVERSED_100) || bytesEqual(header8, BL32_HEADER_REVERSED_50)) {
        return 'reversed';
    }
    if (bytesEqual(header8, BL32_HEADER_NORMAL_100) || bytesEqual(header8, BL32_HEADER_NORMAL_50)) {
        return 'normal';
    }
    // Стандартна конвенція для quad: мотори 2 і 4 (індекси 1 та 3) - reversed
    return (escIndex === 1 || escIndex === 3) ? 'reversed' : 'normal';
}

// Застосування бінарного пресету до 4 ESC (#btnConfigureESC)
export async function applyEscPreset() {
    if (!('serial' in navigator)) {
        setStepStatus(2, 'fail');
        showPopup('error', 'Помилка', 'Web Serial API не підтримується.');
        return;
    }

    const confirmApply = window.confirm(
        'ЗАСТОСУВАННЯ ПРЕСЕТУ ДО 4 ESC:\n\n' +
        '• Rampup Power: 100%\n' +
        '• Low RPM Power Protect: Off (Вимкнено)\n' +
        '• Beacon Delay: Off (Вимкнено)\n\n' +
        'Програма виконає бінарну заміну блоків 0x00..0x07 (напрямок) та 0x10..0x1F (параметри).\n' +
        'Усі інші 232 байти (калібрування, залізо, таймінги) залишаться недоторканими.\n' +
        'Перед записом автоматично буде створено резервну копію поточного стану.\n' +
        'Після запису відбудеться побайтова верифікація 256 з 256 байт.\n\n' +
        'Перед продовженням: зніміть пропелери та підключіть LiPo!\n\nПродовжити?'
    );
    if (!confirmApply) {
        log('[Пресет ESC] Скасовано користувачем.');
        return;
    }

    setStepStatus(2, 'working');
    for (let i = 0; i < ESC_COUNT; i++) setEscBadge(i, 'pending', 'Очікування');

    try {
        const outcome = await withEscSession(async (writer, reader) => {
            // ФАЗА 1: Зчитуємо поточні блоки всіх 4 ESC
            const currentBlocks = [];
            for (let esc = 0; esc < ESC_COUNT; esc++) {
                log(`\n--- Зчитування ESC #${esc + 1} ---`);
                setEscBadge(esc, 'working', 'Читання...');
                const r = await readEscBlock(writer, reader, esc);
                await disconnectEscDevice(writer, reader, esc);
                if (!r.ok) {
                    setEscBadge(esc, 'fail', 'Збій читання');
                    return { aborted: `ESC #${esc + 1} не прочитано (${r.msg}). Пресет не застосовано.` };
                }
                currentBlocks.push(r);
            }

            // Підготовка патчів для кожного ESC
            const targets = [];
            let writeCount = 0;
            for (let esc = 0; esc < ESC_COUNT; esc++) {
                const originalData = currentBlocks[esc].data;
                const patchData = new Uint8Array(originalData);

                // Визначаємо напрямок мотора
                const currentHeader = originalData.slice(0, 8);
                const direction = detectMotorDirection(currentHeader, esc);
                const targetHeader = (direction === 'reversed') ? BL32_HEADER_REVERSED_100 : BL32_HEADER_NORMAL_100;

                // Підставляємо зв'язані блоки (0x00..0x07 та 0x10..0x1F)
                patchData.set(targetHeader, 0x00);
                patchData.set(BL32_PRESET_SETTINGS, 0x10);

                const needsWrite = !bytesEqual(originalData, patchData);
                if (needsWrite) writeCount++;
                targets.push({ esc, originalData, patchData, direction, needsWrite });
            }

            if (writeCount === 0) {
                log('\n[Пресет ESC] Усі 4 ESC вже мають цей пресет, запис не потрібен.');
                for (let esc = 0; esc < ESC_COUNT; esc++) {
                    setEscBadge(esc, 'ok', 'Вже застосовано');
                }
                return { results: targets.map(t => ({ esc: t.esc, status: 'unchanged', direction: t.direction })) };
            }

            // ФАЗА 2: Запис регуляторів, які потребують оновлення (з підтвердженням ACK)
            const writeResults = [];
            for (const t of targets) {
                const esc = t.esc;
                if (!t.needsWrite) {
                    log(`\nESC #${esc + 1} (Напрямок: ${t.direction.toUpperCase()}): вже має цей пресет, запис пропущено.`);
                    setEscBadge(esc, 'ok', 'Вже застосовано');
                    writeResults.push({ esc, status: 'unchanged', direction: t.direction });
                    continue;
                }

                log(`\n--- Запис ESC #${esc + 1} (Напрямок: ${t.direction.toUpperCase()}) ---`);
                setEscBadge(esc, 'working', 'Запис Flash...');

                const conn = await connectEscDevice(writer, reader, esc);
                if (!conn.ok) {
                    setEscBadge(esc, 'fail', 'Немає відповіді');
                    return { aborted: `ESC #${esc + 1}: втрачено зв'язок перед записом (${conn.msg}).`, results: writeResults };
                }

                await send4WayCmd(writer, reader, CMD_INTERFACE_TEST_ALIVE, 0, [0], 800);
                const wr = await send4WayCmd(writer, reader, CMD_DEVICE_WRITE, BL32_EEPROM_ADDR, Array.from(t.patchData), 4000);
                await disconnectEscDevice(writer, reader, esc);

                if (!wr.ok) {
                    setEscBadge(esc, 'fail', 'Збій запису');
                    return { aborted: `ESC #${esc + 1}: помилка запису Flash (${wr.msg}).`, results: writeResults };
                }

                log(`ESC #${esc + 1}: Flash записано успішно (ACK OK).`);
                setEscBadge(esc, 'ok', 'Записано (OK)');
                writeResults.push({ esc, status: 'written', direction: t.direction });
                await delay(100);
            }

            return { results: writeResults };
        });

        if (outcome.aborted) {
            setStepStatus(2, 'fail');
            log(`[Пресет ESC] ЗУПИНЕНО: ${outcome.aborted}`);
            showPopup('error', 'Застосування пресету зупинено', outcome.aborted);
            return;
        }

        const written = outcome.results.filter(r => r.status === 'written').length;
        const same = outcome.results.filter(r => r.status === 'unchanged').length;
        setStepStatus(2, 'success');
        log(`\n[Пресет ESC] Успішно завершено: оновлено ${written}, вже були актуальні ${same}.`);
        showPopup('success', 'Пресет застосовано', `Оновлено ESC: ${written}, без змін: ${same}.\nУсі регулятори отримали пресет!`, 3500);

    } catch (err) {
        console.error(err);
        setStepStatus(2, 'fail');
        log(`[Пресет ESC помилка]: ${err.message}`);
        showPopup('error', 'Збій застосування пресету', err.message);
    }
}
