/**
 * BLHeli_32 Raw Backup and Restore operations.
 */

import { delay, bytesToHex, hexToBytes, bytesEqual, timestampStr, downloadTextFile } from '../utils/bytes.js';
import { crcHex } from '../utils/crc.js';
import { log } from '../ui/log.js';
import { setStepStatus, setEscBadge } from '../ui/status.js';
import { showPopup } from '../ui/modal.js';
import {
    CMD_INTERFACE_TEST_ALIVE,
    CMD_DEVICE_WRITE,
    CMD_DEVICE_READ,
    connectEscDevice,
    disconnectEscDevice,
    send4WayCmd
} from './protocol.js';
import {
    BL32_EEPROM_ADDR,
    ESC_BLOCK_LEN,
    ESC_COUNT,
    withEscSession,
    readEscBlock
} from './eeprom.js';

export const ESC_BACKUP_FORMAT = 'blheli32-esc-raw-backup';

/**
 * Builds standard backup object structure.
 * @param {Array<{index: number, signature: string, crc16: string, dataHex: string}>} escs
 * @param {boolean} complete
 * @returns {object}
 */
export function buildBackupObject(escs, complete) {
    return {
        format: ESC_BACKUP_FORMAT,
        version: 1,
        created: new Date().toISOString(),
        address: '0xF800',
        length: ESC_BLOCK_LEN,
        complete,
        escs
    };
}

/**
 * Parses and verifies an ESC backup JSON text.
 * @param {string} text
 * @returns {{ok: boolean, escs?: Array<{index: number, signature: string, data: Uint8Array}>, created?: string, complete?: boolean, msg?: string}}
 */
export function parseEscBackup(text) {
    let obj;
    try { obj = JSON.parse(text); } catch (e) { return { ok: false, msg: 'Файл не є коректним JSON.' }; }

    if (!obj || obj.format !== ESC_BACKUP_FORMAT) return { ok: false, msg: 'Це не файл копії ESC з цієї програми (невірний format).' };
    if (obj.version !== 1) return { ok: false, msg: `Непідтримувана версія файлу: ${obj.version}.` };
    if (obj.address !== '0xF800' || obj.length !== ESC_BLOCK_LEN) return { ok: false, msg: 'Невірна адреса або довжина блоку у файлі.' };
    if (!Array.isArray(obj.escs) || obj.escs.length === 0) return { ok: false, msg: 'У файлі немає жодного ESC.' };

    const seen = new Set();
    const escs = [];
    for (const e of obj.escs) {
        if (!Number.isInteger(e.index) || e.index < 0 || e.index >= ESC_COUNT) return { ok: false, msg: `Невірний номер ESC у файлі: ${e.index}.` };
        if (seen.has(e.index)) return { ok: false, msg: `ESC #${e.index + 1} повторюється у файлі.` };
        seen.add(e.index);

        const data = hexToBytes(e.dataHex);
        if (!data || data.length !== ESC_BLOCK_LEN) return { ok: false, msg: `ESC #${e.index + 1}: дані пошкоджені (очікується ${ESC_BLOCK_LEN} байт).` };
        if (crcHex(data) !== String(e.crc16).toLowerCase()) return { ok: false, msg: `ESC #${e.index + 1}: контрольна сума файлу не збігається, файл змінено або пошкоджено.` };
        if (typeof e.signature !== 'string') return { ok: false, msg: `ESC #${e.index + 1}: немає сигнатури чіпа.` };

        escs.push({ index: e.index, signature: e.signature.toLowerCase(), data });
    }
    return { ok: true, escs, created: obj.created, complete: obj.complete };
}

/**
 * Handles backing up all 4 ESCs to a JSON file.
 */
export async function backupAllEscs() {
    if (!('serial' in navigator)) {
        setStepStatus(2, 'fail');
        showPopup('error', 'Помилка', 'Web Serial API не підтримується.');
        return;
    }

    setStepStatus(2, 'working');
    for (let i = 0; i < ESC_COUNT; i++) setEscBadge(i, 'pending', 'Очікування');

    try {
        const result = await withEscSession(async (writer, reader) => {
            const escs = [];
            const failed = [];
            for (let esc = 0; esc < ESC_COUNT; esc++) {
                log(`\n--- Копія ESC #${esc + 1} ---`);
                setEscBadge(esc, 'working', 'Читання...');
                const r = await readEscBlock(writer, reader, esc);
                await disconnectEscDevice(writer, reader, esc);
                if (!r.ok) {
                    log(`ESC #${esc + 1}: копію не знято (${r.msg})`);
                    setEscBadge(esc, 'fail', 'Збій читання');
                    failed.push(esc + 1);
                    continue;
                }
                log(`ESC #${esc + 1}: прочитано ${r.data.length} байт, CRC OK, чіп ${r.signature}`);
                setEscBadge(esc, 'ok', 'Копію знято');
                escs.push({ index: esc, signature: r.signature, crc16: crcHex(r.data), dataHex: bytesToHex(r.data) });
            }
            return { escs, failed };
        });

        if (result.escs.length === 0) {
            setStepStatus(2, 'fail');
            showPopup('error', 'Копію не створено', 'Жоден ESC не вдалося прочитати. Перевірте LiPo та зʼєднання.');
            return;
        }

        const complete = result.failed.length === 0;
        const filename = `BLHeli32_ESC_backup_${timestampStr()}.json`;
        downloadTextFile(filename, JSON.stringify(buildBackupObject(result.escs, complete), null, 2));
        log(`Файл копії збережено: ${filename}`);

        if (complete) {
            setStepStatus(2, 'success');
            showPopup('success', 'Копію створено', `Збережено всі 4 ESC у файл ${filename}`, 3000);
        } else {
            setStepStatus(2, 'fail');
            showPopup('error', 'Копія неповна', `Збережено ESC: ${result.escs.length} з 4. Не прочитано: #${result.failed.join(', #')}.\nФайл: ${filename}`);
        }
    } catch (err) {
        console.error(err);
        setStepStatus(2, 'fail');
        log(`[Копія ESC помилка]: ${err.message}`);
        showPopup('error', 'Збій створення копії', err.message);
    }
}

/**
 * Triggers file input click for ESC restore.
 */
export function triggerRestoreFileSelect() {
    if (!('serial' in navigator)) {
        showPopup('error', 'Помилка', 'Web Serial API не підтримується.');
        return;
    }
    const fileRestoreESC = document.getElementById('fileRestoreESC');
    if (fileRestoreESC) fileRestoreESC.click();
}

/**
 * Handles backup file restore execution.
 * @param {Event} event
 */
export async function handleRestoreFileChange(event) {
    const fileRestoreESC = event.target;
    const file = fileRestoreESC.files && fileRestoreESC.files[0];
    fileRestoreESC.value = ''; // дозволяє вибрати той самий файл повторно
    if (!file) return;

    const parsed = parseEscBackup(await file.text());
    if (!parsed.ok) {
        log(`[Відновлення] Файл відхилено: ${parsed.msg}`);
        showPopup('error', 'Файл не підходить', parsed.msg);
        return;
    }

    const list = parsed.escs.map(e => `#${e.index + 1}`).join(', ');
    const okToWrite = window.confirm(
        `ВІДНОВЛЕННЯ ESC з файлу "${file.name}"\n` +
        `Створено: ${parsed.created || 'невідомо'}\n` +
        `Буде ПЕРЕЗАПИСАНО налаштування ESC: ${list}\n\n` +
        `Перед записом програма автоматично збереже поточний стан ESC окремим файлом.\n` +
        `Перед продовженням: зніміть пропелери та підключіть LiPo.\n\nПродовжити?`
    );
    if (!okToWrite) {
        log('[Відновлення] Скасовано користувачем.');
        return;
    }

    setStepStatus(2, 'working');
    for (let i = 0; i < ESC_COUNT; i++) setEscBadge(i, 'pending', 'Очікування');

    try {
        const outcome = await withEscSession(async (writer, reader) => {
            // ФАЗА 1: читаємо поточний стан, перевіряємо чіпи, нічого не пишемо
            const current = new Map();
            for (const target of parsed.escs) {
                const esc = target.index;
                log(`\n--- Перевірка ESC #${esc + 1} перед записом ---`);
                setEscBadge(esc, 'working', 'Перевірка...');
                const r = await readEscBlock(writer, reader, esc);
                await disconnectEscDevice(writer, reader, esc);
                if (!r.ok) {
                    setEscBadge(esc, 'fail', 'Збій читання');
                    return { aborted: `ESC #${esc + 1} не прочитано (${r.msg}). Нічого не записано.` };
                }
                if (r.signature !== target.signature) {
                    setEscBadge(esc, 'fail', 'Інший чіп');
                    return { aborted: `ESC #${esc + 1}: чіп ${r.signature} не збігається з файлом (${target.signature}). Нічого не записано.` };
                }
                current.set(esc, r);
            }

            // Автоматична копія поточного стану ПЕРЕД будь-яким записом
            const pre = [...current.entries()].map(([index, r]) => ({
                index, signature: r.signature, crc16: crcHex(r.data), dataHex: bytesToHex(r.data)
            }));
            const preName = `BLHeli32_ESC_pre-restore_${timestampStr()}.json`;
            downloadTextFile(preName, JSON.stringify(buildBackupObject(pre, pre.length === ESC_COUNT), null, 2));
            log(`Поточний стан збережено: ${preName}`);
            await delay(400);

            // ФАЗА 2: запис і контрольне читання
            const results = [];
            for (const target of parsed.escs) {
                const esc = target.index;
                log(`\n--- Відновлення ESC #${esc + 1} ---`);

                if (bytesEqual(current.get(esc).data, target.data)) {
                    log(`ESC #${esc + 1}: вже збігається з файлом, запис не потрібен.`);
                    setEscBadge(esc, 'ok', 'Без змін');
                    results.push({ esc, status: 'unchanged' });
                    continue;
                }

                setEscBadge(esc, 'working', 'Запис...');
                const conn = await connectEscDevice(writer, reader, esc);
                if (!conn.ok) {
                    setEscBadge(esc, 'fail', 'Немає відповіді');
                    return { aborted: `ESC #${esc + 1}: втрачено звʼязок перед записом (${conn.msg}). Далі нічого не записано.`, results };
                }

                await send4WayCmd(writer, reader, CMD_INTERFACE_TEST_ALIVE, 0, [0], 800);
                const wr = await send4WayCmd(writer, reader, CMD_DEVICE_WRITE, BL32_EEPROM_ADDR, Array.from(target.data), 4000);
                if (!wr.ok) {
                    setEscBadge(esc, 'fail', 'Збій запису');
                    await disconnectEscDevice(writer, reader, esc);
                    return { aborted: `ESC #${esc + 1}: запис не підтверджено (${wr.msg}). Далі нічого не записано. Відновіть цей ESC з файлу ${preName}.`, results };
                }
                
                // Контрольне зчитування одразу в тій самій сесії (як у BLHeliSuite32, без зайвого reset)
                setEscBadge(esc, 'working', 'Верифікація...');
                await delay(100);
                let vr = await send4WayCmd(writer, reader, CMD_DEVICE_READ, BL32_EEPROM_ADDR, [0x00], 2500);

                // Якщо перша спроба дала збій, одна повторна спроба
                if (!vr.ok || vr.data.length !== ESC_BLOCK_LEN || !vr.crcOk) {
                    await delay(150);
                    vr = await send4WayCmd(writer, reader, CMD_DEVICE_READ, BL32_EEPROM_ADDR, [0x00], 2500);
                }

                // Чисто закриваємо ESC тільки ПІСЛЯ завершення перевірки
                await disconnectEscDevice(writer, reader, esc);
                await delay(50);

                if (vr.ok && vr.data.length === ESC_BLOCK_LEN && bytesEqual(vr.data, target.data)) {
                    log(`ESC #${esc + 1}: записано і перевірено (збіг 256 з 256 байт).`);
                    setEscBadge(esc, 'ok', 'Відновлено');
                    results.push({ esc, status: 'written' });
                } else {
                    const reason = !vr.ok ? vr.msg : (vr.data.length !== ESC_BLOCK_LEN ? `довжина ${vr.data.length}` : 'дані у флеші не збігаються з файлом');
                    setEscBadge(esc, 'fail', 'Збій верифікації');
                    return { aborted: `ESC #${esc + 1}: після запису ${reason}. Далі нічого не записано. Відновіть цей ESC з файлу ${preName}.`, results };
                }
            }
            return { results };
        });

        if (outcome.aborted) {
            setStepStatus(2, 'fail');
            log(`[Відновлення] ЗУПИНЕНО: ${outcome.aborted}`);
            showPopup('error', 'Відновлення зупинено', outcome.aborted);
            return;
        }

        const written = outcome.results.filter(r => r.status === 'written').length;
        const same = outcome.results.filter(r => r.status === 'unchanged').length;
        setStepStatus(2, 'success');
        log(`[Відновлення] Готово: записано ${written}, без змін ${same}.`);
        showPopup('success', 'Відновлення завершено', `Записано ESC: ${written}, без змін: ${same}. Усі записані блоки перевірено читанням.`, 3500);
    } catch (err) {
        console.error(err);
        setStepStatus(2, 'fail');
        log(`[Відновлення помилка]: ${err.message}`);
        showPopup('error', 'Збій відновлення', err.message);
    }
}
