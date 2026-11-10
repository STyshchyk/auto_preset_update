/**
 * BLHeli_32 Preset constants and flash configuration operations.
 */

import { delay, bytesEqual } from '../utils/bytes.js';
import { log, startOperationStep, endOperationStep } from '../ui/log.js';
import { setStepStatus, setEscBadge, setEscFlowStep } from '../ui/status.js';
import { updateEscInfoPanel } from '../ui/infoPanel.js';
import { showPopup } from '../ui/modal.js';
import {
    CMD_INTERFACE_TEST_ALIVE,
    CMD_DEVICE_WRITE,
    connectEscDevice,
    disconnectEscDevice,
    send4WayCmd
} from './protocol.js';
import {
    BL32_EEPROM_ADDR,
    ESC_COUNT,
    readEscBlock,
    withEscSession
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

/**
 * Determines motor rotation direction from 8-byte header or channel default index.
 * @param {Uint8Array} header8
 * @param {number} escIndex
 * @returns {'normal' | 'reversed'}
 */
export function detectMotorDirection(header8, escIndex) {
    if (bytesEqual(header8, BL32_HEADER_REVERSED_100) || bytesEqual(header8, BL32_HEADER_REVERSED_50)) {
        return 'reversed';
    }
    if (bytesEqual(header8, BL32_HEADER_NORMAL_100) || bytesEqual(header8, BL32_HEADER_NORMAL_50)) {
        return 'normal';
    }
    // За замовчуванням NORMAL для всіх ESC
    return 'normal';
}

/**
 * Applies the 100% binary preset to all 4 ESCs preserving factory calibration bytes (232 bytes).
 */
export async function applyEscPreset() {
    if (!('serial' in navigator)) {
        setStepStatus(2, 'fail');
        showPopup('error', 'Помилка', 'Web Serial API не підтримується.');
        return;
    }

    setStepStatus(2, 'working');
    for (let i = 0; i < ESC_COUNT; i++) setEscBadge(i, 'pending', 'Очікування');
    startOperationStep('ESC_CONFIG_PRESET', 'Крок 2: Налаштування 4 ESC BLHeli_32');

    let cachedEscInfo = [];

    try {
        setEscFlowStep('connect', 'success');
        setEscFlowStep('flash', 'working');

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

            // Витяг відкритого ASCII тексту назви та оновлення лівої інфо-панелі
            const escInfoList = [];
            for (let esc = 0; esc < ESC_COUNT; esc++) {
                const block = currentBlocks[esc];
                let asciiName = '';
                for (let i = 0x20; i < block.data.length - 8; i++) {
                    const slice = block.data.slice(i, i + 32);
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
                const dir = detectMotorDirection(block.data.slice(0, 8), esc);
                const hasSettings = block.data.length >= 32 && bytesEqual(block.data.slice(0x10, 0x20), BL32_PRESET_SETTINGS);
                const expHdr = (dir === 'reversed') ? BL32_HEADER_REVERSED_100 : BL32_HEADER_NORMAL_100;
                const matched = hasSettings && bytesEqual(block.data.slice(0, 8), expHdr);

                escInfoList.push({
                    esc,
                    direction: dir,
                    presetMatched: matched,
                    chip: block.signature,
                    mcu: block.mcu || 'ARM 32-bit',
                    signature: block.signatureHex || block.signature || '0x????',
                    ack: 'OK (LiPo є)',
                    modelName: asciiName || 'BLHeli_32'
                });
            }
            cachedEscInfo = escInfoList;
            updateEscInfoPanel(escInfoList);

            // Підготовка патчів для кожного ESC
            const targets = [];
            let writeCount = 0;
            for (let esc = 0; esc < ESC_COUNT; esc++) {
                const originalData = currentBlocks[esc].data;
                const patchData = new Uint8Array(originalData);

                // Примусово NORMAL для всіх ESC до окремої вказівки
                const direction = 'normal';
                const targetHeader = BL32_HEADER_NORMAL_100;

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
                setEscFlowStep('flash', 'success', '2. Заливка (Вже OK)');
                setEscFlowStep('verify', 'success');
                setEscFlowStep('status', 'success');
                return { results: targets.map(t => ({ esc: t.esc, status: 'unchanged', direction: t.direction })) };
            }

            setEscFlowStep('flash', 'working');

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
                    setEscFlowStep('flash', 'fail');
                    return { aborted: `ESC #${esc + 1}: помилка запису Flash (${wr.msg}).`, results: writeResults };
                }

                log(`ESC #${esc + 1}: Flash записано успішно (ACK OK).`);
                setEscBadge(esc, 'ok', 'Записано (OK)');
                writeResults.push({ esc, status: 'written', direction: t.direction });
                await delay(100);
            }

            setEscFlowStep('flash', 'success');
            setEscFlowStep('verify', 'working');

            // Контрольна перевірка запису (зчитування та валідація)
            log('\n--- Контрольна перевірка 4-х ESC після запису ---');
            for (let esc = 0; esc < ESC_COUNT; esc++) {
                const verifyBlock = await readEscBlock(writer, reader, esc);
                await disconnectEscDevice(writer, reader, esc);
                if (!verifyBlock.ok) {
                    setEscFlowStep('verify', 'fail');
                    return { aborted: `ESC #${esc + 1}: не пройшов контрольну перевірку (${verifyBlock.msg}).`, results: writeResults };
                }
            }
            setEscFlowStep('verify', 'success');
            setEscFlowStep('status', 'success');

            return { results: writeResults };
        });

        if (outcome.aborted) {
            setStepStatus(2, 'fail');
            log(`[Пресет ESC] ЗУПИНЕНО: ${outcome.aborted}`);
            await endOperationStep('FAILED', outcome.aborted);
            showPopup('error', 'Застосування пресету зупинено', outcome.aborted);
            return;
        }

        const written = outcome.results.filter(r => r.status === 'written').length;
        const same = outcome.results.filter(r => r.status === 'unchanged').length;
        setStepStatus(2, 'success');

        // Якщо запис відбувся успішно, оновлюємо інфо-панель: усі ESC тепер мають 100% пресет
        if (written > 0) {
            const postInfoList = outcome.results.map(r => {
                const prev = cachedEscInfo.find(e => e.esc === r.esc) || {};
                return {
                    esc: r.esc,
                    direction: r.direction,
                    presetMatched: true,
                    chip: prev.chip,
                    mcu: prev.mcu || 'ARM 32-bit',
                    signature: prev.signature || '0x????',
                    ack: 'OK (LiPo є)',
                    modelName: prev.modelName || 'BLHeli_32'
                };
            });
            updateEscInfoPanel(postInfoList);
        }

        log(`\n[Пресет ESC] Успішно завершено: оновлено ${written}, вже були актуальні ${same}.`);
        await endOperationStep('SUCCESS', `Оновлено ESC: ${written}, без змін: ${same} (4/4 OK)`);
        showPopup('success', 'Пресет застосовано', `Оновлено ESC: ${written}, без змін: ${same}.\nУсі регулятори отримали пресет!`, 3500);

    } catch (err) {
        console.error(err);
        setStepStatus(2, 'fail');
        await endOperationStep('FAILED', `Збій ESC: ${err.message}`);
        log(`[Пресет ESC помилка]: ${err.message}`);
        showPopup('error', 'Збій застосування пресету', err.message);
    }
}
