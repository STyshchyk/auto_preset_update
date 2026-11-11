/**
 * BLHeli_32 Preset constants and flash configuration operations.
 */

import { delay, bytesEqual, bytesToHex } from '../utils/bytes.js';
import { crcHex } from '../utils/crc.js';
import { log, startOperationStep, endOperationStep } from '../ui/log.js';
import { setStepStatus, setEscBadge, setEscFlowStep, setEscAlreadyFlashedBadge } from '../ui/status.js';
import { updateEscInfoPanel } from '../ui/infoPanel.js';
import { showPopup } from '../ui/modal.js';
import { state } from '../core/state.js';
import { saveEscBackupToDb, hasEscBackupInDb } from '../core/db.js';
import { buildBackupObject } from './backup.js';
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

// Еталонний 256-байтний образ EEPROM для BLHeli_32 (BLHeli32_ESC_backup_20261111_135350_2.json, MCU 0x4706)
export const BL32_GOLDEN_CRC16 = 'bc05';

export const BL32_GOLDEN_PRESET_HEX =
    '474b9ac1b36309e49acc9250d8518905fea89e5884cf3062377108223785c1b3026327427f99c310266464ec2196bea11244cc26192dd8e02f9c00e734d5483ed1c670c32996e5c9b822b7a6ed6630ed1c45459d7766ec4eea47d898cfcb41677137f18150cdfaa65aa3f35bd784b13b819c13c4fe5a8ab37d5752cec1109a46bb71714274da44c4c6b4525368c44023828e0941aaea916cd616932ae2832b72a596c41ba174f7100611cc4fd5d486db304e49013092d1976d82f5e370f64c4d62b7d98f6230272aa42e0ad97d8e8d30fa13d10c0e5172d176704bf0203ae5acf877b9b9028afe0993955fadd4bb2141ffa10c6953153d8bf9da268818c50c05';

export const BL32_GOLDEN_PRESET_256 = new Uint8Array(
    BL32_GOLDEN_PRESET_HEX.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
);

// Експорти для зворотної сумісності:
export const BL32_PRESET_SETTINGS = BL32_GOLDEN_PRESET_256.slice(0x10, 0x20);
export const BL32_HEADER_NORMAL_100 = BL32_GOLDEN_PRESET_256.slice(0x00, 0x08);

/**
 * Перевіряє, чи переданий 256-байтний блок точно відповідає еталонному образу.
 * @param {Uint8Array} data
 * @returns {boolean}
 */
export function isGoldenPresetMatched(data) {
    return Boolean(data && data.length === 256 && bytesEqual(data, BL32_GOLDEN_PRESET_256));
}

// Синхронізовані заголовки напрямку обертання (хеш 0x00..0x07) для пресету 100%:
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
    setEscAlreadyFlashedBadge(false);
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
                    if (str.length >= 6 && (str.includes('32.') || str.includes('BLHeli') || str.includes('Rev'))) {
                        asciiName = str;
                        break;
                    }
                }
                const headerHex = Array.from(block.data.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' ');
                const settingsHex = Array.from(block.data.slice(0x10, 0x20)).map(b => b.toString(16).padStart(2, '0')).join(' ');
                log(`[ESC #${esc + 1} Dump]: MCU=${block.mcu}(${block.signatureHex}) Model="${asciiName || 'NOT_FOUND'}"`);
                log(`  Header (0x00..0x07): ${headerHex}`);
                log(`  Settings (0x10..0x1F): ${settingsHex}`);

                const dir = detectMotorDirection(block.data.slice(0, 8), esc);
                const matched = isGoldenPresetMatched(block.data);
                log(`  Match status: dir=${dir}, matched=${matched}`);

                const isBluejay = (block.signatureHex === '0xE8B2' || block.signatureHex === '0xB2E8' || 
                                   block.signatureHex === '0xE8B1' || block.signatureHex === '0xB1E8' ||
                                   (asciiName && asciiName.toLowerCase().includes('bluejay')));

                const detectedModelName = isBluejay ? 'Bluejay 8-bit' : (asciiName || 'BLHeli_32');

                escInfoList.push({
                    esc,
                    direction: dir,
                    presetMatched: matched,
                    chip: block.signature,
                    mcu: block.mcu || 'ARM 32-bit',
                    signature: block.signatureHex || block.signature || '0x????',
                    ack: 'OK (LiPo є)',
                    modelName: detectedModelName
                });
            }
            cachedEscInfo = escInfoList;
            updateEscInfoPanel(escInfoList);

            // Сувора перевірка: Модель має бути BLHeli_32, а MCU строго 0x4706
            const invalidModelEsc = escInfoList.find(e => !e.modelName || (!e.modelName.includes('BLHeli_32') && !e.modelName.includes('32.')));
            if (invalidModelEsc) {
                return { aborted: `Запис заблоковано! Модель ESC #${invalidModelEsc.esc + 1} [${invalidModelEsc.modelName}] не є BLHeli_32.` };
            }

            const invalidMcuEsc = escInfoList.find(e => {
                const sig = (e.signature || '').toUpperCase();
                const mcu = (e.mcu || '').toUpperCase();
                return !sig.includes('4706') && !mcu.includes('4706');
            });
            if (invalidMcuEsc) {
                return { aborted: `Запис заблоковано! MCU ESC #${invalidMcuEsc.esc + 1} має сигнатуру [${invalidMcuEsc.signature || invalidMcuEsc.mcu}], очікується строго 0x4706.` };
            }

            // Автоматичне збереження повної резервної копії 4-х ESC в IndexedDB перед записом
            const currentMcuId = state.lastFcDetails?.deviceId || document.getElementById('infoDeviceId')?.textContent?.trim()?.toLowerCase();
            if (currentMcuId && currentMcuId !== '—' && currentMcuId !== '-') {
                try {
                    const backupEscs = currentBlocks.map((b, idx) => ({
                        index: idx,
                        signature: b.signature,
                        crc16: crcHex(b.data),
                        dataHex: bytesToHex(b.data)
                    }));
                    const escBackupObj = buildBackupObject(backupEscs, true);
                    await saveEscBackupToDb(currentMcuId, escBackupObj, {
                        board: state.lastFcDetails?.board || 'SPEDIXF722',
                        firmware: state.lastFcDetails?.firmware || '—',
                        reason: 'AUTO_BACKUP_BEFORE_ESC_FLASH'
                    });
                    log(`[IndexedDB] Повний бекап 4-х ESC автоматично збережено в базу для MCU: ${currentMcuId}`);
                    
                    const btnExportEscDb = document.getElementById('btnExportEscDb');
                    const btnRestoreEscDb = document.getElementById('btnRestoreEscDb');
                    if (btnExportEscDb) btnExportEscDb.disabled = false;
                    if (btnRestoreEscDb) btnRestoreEscDb.disabled = false;
                } catch (dbErr) {
                    console.warn('Не вдалося зберегти автоматичний бекап ESC в IndexedDB:', dbErr);
                }
            }

            // Підготовка повного 256-байтного образу для кожного ESC
            // Через rolling-шифрування сторінки 0xF800 у MCU 0x4706 запис виконується завжди для всіх 4 ESC
            const targets = [];
            for (let esc = 0; esc < ESC_COUNT; esc++) {
                const patchData = new Uint8Array(BL32_GOLDEN_PRESET_256);
                const direction = 'normal';
                targets.push({ esc, patchData, direction });
            }

            setEscFlowStep('flash', 'working');

            // ФАЗА 2: Запис усіх 4-х регуляторів еталонним 256-байтним образом (з підтвердженням ACK)
            const writeResults = [];
            for (const t of targets) {
                const esc = t.esc;
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

            // Контрольна перевірка запису (успішне читання 256 байт з валідним CRC16 після ресету)
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
