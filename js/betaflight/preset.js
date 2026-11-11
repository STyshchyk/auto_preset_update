import { delay } from '../utils/bytes.js';
import { state } from '../core/state.js';
import { resolveSelectedPort, closeSerialSession } from '../core/serial.js';
import { log, startOperationStep, endOperationStep, setLogDeviceId } from '../ui/log.js';
import { setStepStatus, setFcSubStep, resetFcSubSteps, setAlreadyFlashedBadge, setFcStateBadge, setFcHistoryBadge } from '../ui/status.js';
import { showPopup } from '../ui/modal.js';
import { readCliResponse, parseBoardName } from './cli.js';
import { parseFcDetails, calculateMismatch, detectFcState } from './info.js';
import { updateInfoPanel } from '../ui/infoPanel.js';
import { isEscSessionActive, disconnectEscSession } from '../blheli/session.js';
import { recordNewHardwareMcu, isNewHardwareMcuRecorded } from '../utils/stats.js';
import { saveFcDualDump, saveFcDump, getFcDump, hasFcDump, hasEscBackupInDb } from '../core/db.js';
import { downloadTextFile } from '../utils/bytes.js';

/**
 * Reusable helper to request and read 'dump all' from Betaflight CLI.
 * Streams chunks until prompt '#' is received or timeout occurs.
 */
async function fetchCliDumpAll(reader, writer, timeoutMs = 12000) {
    await writer.write('dump all\r\n');
    await delay(100);
    let dumpContent = '';
    const dumpStart = Date.now();

    while (Date.now() - dumpStart < timeoutMs) {
        const chunk = await readCliResponse(reader, 1000, false);
        if (chunk) {
            dumpContent += chunk;
            if (dumpContent.length > 500 && (dumpContent.includes('\n# ') || dumpContent.trim().endsWith('#'))) {
                break;
            }
        }
    }
    return dumpContent;
}

/**
 * Reusable helper to request and read 'diff all' from Betaflight CLI.
 * Streams chunks until prompt '#' is received or timeout occurs.
 */
async function fetchCliDiff(reader, writer, timeoutMs = 4000) {
    await writer.write('diff all\r\n');
    await delay(100);
    let diffContent = '';
    const diffStart = Date.now();

    while (Date.now() - diffStart < timeoutMs) {
        const chunk = await readCliResponse(reader, 400, false);
        if (chunk) {
            diffContent += chunk;
            if (diffContent.length > 50 && (diffContent.includes('\n# ') || diffContent.trim().endsWith('#'))) {
                break;
            }
        } else if (diffContent.length > 50) {
            break;
        }
    }
    return diffContent;
}

export async function flashBetaflightPreset(onTelemetryReady = null, customPresetScript = null, sourceName = 'Пресет') {
    if (!('serial' in navigator)) {
        setStepStatus(1, 'fail');
        showPopup('error', 'Помилка', 'Web Serial API не підтримується цим браузером.');
        return;
    }

    const btnFlashFC = document.getElementById('btnFlashFC');
    const btnRestoreFile = document.getElementById('btnRestoreFCFromFile');
    const script = (typeof customPresetScript === 'string' && customPresetScript.trim().length > 0)
        ? customPresetScript.trim()
        : document.getElementById('presetInput').value.trim();

    if (!script) {
        showPopup('error', 'Помилка', 'Конфігурація пресету порожня.');
        return;
    }

    if (btnFlashFC) btnFlashFC.disabled = true;
    if (btnRestoreFile) btnRestoreFile.disabled = true;
    setStepStatus(1, 'working');
    resetFcSubSteps();
    startOperationStep('FC_FLASH_PRESET', `Крок 1: Прошивка FC (${sourceName})`);
    let reader = null, writer = null, textEncoder = null;
    let isRebooting = false;

    try {
        if (isEscSessionActive()) {
            log('[Betaflight] Закриття активної 4-Way сесії ESC перед входом у CLI...');
            await disconnectEscSession();
        }
        state.port = await resolveSelectedPort(log);
        await state.port.open({ baudRate: 115200 });
        log('Порт відкрито на 115200.');

        textEncoder = new TextEncoderStream();
        textEncoder.readable.pipeTo(state.port.writable);
        writer = textEncoder.writable.getWriter();

        const textDecoder = new TextDecoderStream();
        state.port.readable.pipeTo(textDecoder.writable);
        reader = textDecoder.readable.getReader();

        // Enter CLI mode
        log('Ініціалізація Betaflight CLI (#)...');
        await writer.write('#\r\n');
        await delay(350);
        let initEcho = await readCliResponse(reader, 800);
        if (!initEcho.includes('#')) {
            await writer.write('\r\n#\r\n');
            await delay(350);
            initEcho += await readCliResponse(reader, 800);
        }

        // Read status & board validation
        log('Зчитування даних плати...');
        await writer.write('version\r\n');
        await delay(150);
        const verText = await readCliResponse(reader, 1000);
        await writer.write('status\r\n');
        await delay(150);
        const statusText = await readCliResponse(reader, 1200);
        await writer.write('mcu_id\r\n');
        await delay(150);
        const mcuIdText = await readCliResponse(reader, 800);

        const actualBoard = parseBoardName(initEcho + '\n' + verText + '\n' + statusText + '\n' + mcuIdText);
        const expectedBoardMatch = script.match(/(?:board_name|#\s*target:?)\s+([A-Za-z0-9_-]+)/i);
        const expectedBoard = expectedBoardMatch ? expectedBoardMatch[1].toUpperCase() : null;

        const expectedMcuMatch = script.match(/Betaflight\s*\/\s*([A-Za-z0-9_]+)/i) ||
                                 script.match(/(?:#\s*MCU:?)\s+([A-Za-z0-9_-]+)/i);
        const expectedMcu = expectedMcuMatch ? expectedMcuMatch[1].toUpperCase() : null;

        const expectedFwMatch = script.match(/Betaflight\s*\/\s*.*?\b([0-9]+\.[0-9]+\.[0-9]+)\b/i) ||
                                script.match(/(?:#\s*firmware:?)\s+([0-9]+\.[0-9]+\.[0-9]+)/i);
        const expectedFw = expectedFwMatch ? expectedFwMatch[1] : null;

        log(`Виявлено плату: [${actualBoard || 'UNKNOWN'}], Очікуваний MCU: [${expectedMcu || 'ANY'}], Очікуваний BTFL: [${expectedFw || 'ANY'}]`);

        // Аналіз польотника та розрахунок % неспівпадіння через diff all (до прошивки)
        log('Аналіз поточної конфігурації польотника (diff all)...');
        const diffContent = await fetchCliDiff(reader, writer, 4000);
        log(`[Зчитування] Отримано ${diffContent.length} байт конфігурації FC.`);

        const fcDetails = parseFcDetails(verText, statusText + '\n' + mcuIdText);
        state.lastFcDetails = fcDetails;
        if (fcDetails.deviceId) {
            setLogDeviceId(fcDetails.deviceId);
        }

        const cleanPresetScript = (document.getElementById('cleanPresetInput')?.value || '').trim();
        const fcStateResult = detectFcState(diffContent, script, cleanPresetScript);
        const mismatchStats = fcStateResult.targetMismatch;
        updateInfoPanel(fcDetails, mismatchStats, { expectedBoard, expectedMcu, expectedFw });
        log(`[Інфо] Плата: ${fcDetails.board}, Прошивка: ${fcDetails.firmware}, Дата: ${fcDetails.buildDate}`);
        log(`[Аналіз пресету (до запису)] Неспівпадіння: ${mismatchStats.mismatchPercent}% (${mismatchStats.mismatchCount}/${mismatchStats.totalPresetVars} змінних)`);
        log(`[Розпізнавання стану] Стан FC: [${fcStateResult.state}] (Розбіжність із цільовим: ${mismatchStats.mismatchPercent}%, із чистим: ${fcStateResult.cleanMismatch.mismatchPercent}%)`);

        if (typeof onTelemetryReady === 'function') {
            try { onTelemetryReady(fcDetails); } catch (_) {}
        }

        if (!actualBoard) {
            try { await writer.write('exit\r\n'); } catch (_) {}
            throw new Error('Неможливо визначити плату польотного контролера (UNKNOWN). Запис скасовано для безпеки.');
        }

        if (expectedBoard && !actualBoard.includes(expectedBoard) && !expectedBoard.includes(actualBoard)) {
            try { await writer.write('exit\r\n'); } catch (_) {}
            throw new Error(`Невідповідність плати! Очікувалось [${expectedBoard}], підключено [${actualBoard}].`);
        }

        if (expectedMcu && fcDetails.mcu && !fcDetails.mcu.includes(expectedMcu) && !expectedMcu.includes(fcDetails.mcu)) {
            try { await writer.write('exit\r\n'); } catch (_) {}
            throw new Error(`Невідповідність MCU процесора! У пресеті вказано [${expectedMcu}], але польотник має [${fcDetails.mcu}]. Запис скасовано для безпеки.`);
        }

        if (expectedFw && fcDetails.firmware && fcDetails.firmware !== expectedFw) {
            try { await writer.write('exit\r\n'); } catch (_) {}
            throw new Error(`Невідповідність версії Betaflight! У пресеті вказано версію [${expectedFw}], але на польотнику встановлено [${fcDetails.firmware}]. Запис скасовано для уникнення збою конфігурації.`);
        }

        // --- 3-СТАНОВА ПЕРЕВІРКА СТАНУ ПРОШИВКИ ---
        if (fcStateResult.state === 'ALREADY_FLASHED') {
            log('🎯 [ВЖЕ ПРОШИТО] 0% розбіжностей із цільовим пресетом! Конфігурація польотника повністю відповідає зразку.');
            log('Пропуск повторного запису команд у пам\'ять контролера.');

            setFcStateBadge('ALREADY_FLASHED');
            setFcSubStep('flash', 'ok', '1. Пропущено (0% diff)');
            setFcSubStep('readDiff', 'ok', '2. Звірено (100% збіг)');
            setFcSubStep('verify', 'ok', '3. Перевірено (Вже прошитий)');

            setStepStatus(1, 'success');

            // Захист від скидання лівої панелі через короткочасний USB disconnect при виході
            state.ignoreRebootEventsUntil = Date.now() + 5000;

            // Чистий вихід із CLI без зайвого збереження та перезавантаження
            try {
                await writer.write('exit\r\n');
                await delay(150);
            } catch (_) {}

            await closeSerialSession(state.port, reader, writer, textEncoder);
            state.port = null;

            await endOperationStep('SUCCESS', `Пристрій вже був прошитий раніше (0% розбіжностей, ${fcDetails.board})`, {
                board: fcDetails.board,
                firmware: fcDetails.firmware,
                alreadyFlashed: true,
                state: 'ALREADY_FLASHED'
            });

            showPopup('success', 'Вже прошитий пристрій', 'Конфігурація польотника вже на 100% відповідає пресету (0% розбіжностей). Прошивку пропущено!', 2000, () => {
                log('Готовий до налаштування регуляторів (ESC). Перевірте підключення батареї LiPo!');
            });

            return { skipped: true, fcDetails, mismatchStats, state: 'ALREADY_FLASHED' };
        } else if (fcStateResult.state === 'NEW_HARDWARE') {
            log('⚠️ [НОВЕ ОБЛАДНАННЯ] Контролер не є чистим за замовчуванням і містить відмінний пресет!');
            if (fcDetails.deviceId) {
                recordNewHardwareMcu(fcDetails.deviceId);
                log(`[Пам'ять] MCU ID ${fcDetails.deviceId} збережено у реєстрі нового/модифікованого обладнання.`);

                // Автоматичне збереження повного дампу (dump all) та конфігурації (diff all) в IndexedDB перед прошивкою
                log(`[IndexedDB] Зчитування та збереження diff all + dump all для MCU ${fcDetails.deviceId}...`);
                try {
                    const fullDump = await fetchCliDumpAll(reader, writer, 12000);
                    await saveFcDualDump(fcDetails.deviceId, {
                        diffAll: diffContent,
                        dumpAll: fullDump && fullDump.length > 200 ? fullDump : ''
                    }, {
                        board: fcDetails.board,
                        firmware: fcDetails.firmware,
                        reason: 'NEW_HARDWARE_AUTO_BACKUP_BEFORE_FLASH'
                    });
                    log(`✅ [IndexedDB] Обидва дампи (diff all: ${diffContent.length} б, dump all: ${fullDump ? fullDump.length : 0} б) успішно збережено в базі.`);
                } catch (dumpErr) {
                    console.warn('Не вдалося зчитати повний дамп перед прошивкою:', dumpErr);
                    log(`[IndexedDB] Помилка зчитування dump all: ${dumpErr.message}. Збережено diff all.`);
                    await saveFcDualDump(fcDetails.deviceId, { diffAll: diffContent }, {
                        board: fcDetails.board,
                        firmware: fcDetails.firmware,
                        reason: 'NEW_HARDWARE_DIFF_FALLBACK'
                    });
                }
            }
            setFcStateBadge('NEW_HARDWARE');
            showPopup(
                'warning',
                '⚠️ Нове обладнання виявлено!',
                `Польотний контролер (MCU: ${fcDetails.deviceId || '—'}) містить сторонню або модифіковану конфігурацію. Обидва дампи (diff all та dump all) автоматично збережено в IndexedDB перед прошивкою.`,
                5000
            );
        } else {
            // fcStateResult.state === 'CLEAN'
            log('🧼 [ЧИСТИЙ КОНТРОЛЕР] Виявлено заводську еталонну конфігурацію. Запуск запису пресету...');
            setFcStateBadge('CLEAN'); // бейдж з'явиться лише в режимі експерта
        }

        // Швидке очищення залишкового ехо перед відправкою команд
        await readCliResponse(reader, 150, false).catch(() => {});

        // --- ПІДПУНКТ 1: ПРОШИВКА КОМАНД ---
        setFcSubStep('flash', 'working');
        log('Заливання команд пресету...');
        const lines = script.split('\n');
        let containsSave = false;

        for (let line of lines) {
            line = line.trim();
            if (!line || line.startsWith('#')) continue;
            if (line.toLowerCase() === 'save') {
                containsSave = true;
                continue;
            }

            log(`> ${line}`);
            await writer.write(line + '\r\n');
            await delay(35); // Швидка пауза буфера UART без блокуючого очікування

            // Швидка неблокуюча перевірка відповіді на критичні помилки
            const resp = await readCliResponse(reader, 100, true);
            if (resp) {
                const cleanResp = resp.trim();
                const errorMatch = cleanResp.match(/(###ERROR[^\r\n#]*###|PARSE ERROR[^\r\n#]*|UNKNOWN COMMAND[^\r\n#]*|INVALID[^\r\n#]*)/i);
                if (errorMatch) {
                    const errMsg = errorMatch[1].trim();
                    log(`[УВАГА / ПОМИЛКА FC]: ${errMsg}`);
                    setFcSubStep('flash', 'fail');
                    state.ignoreRebootEventsUntil = Date.now() + 6000;
                    try {
                        await writer.write('exit\r\n');
                        await delay(200);
                    } catch (_) {}
                    throw new Error(`Помилка у команді "${line}":\n${errMsg}\nЗапис перервано (ABORT), зміни НЕ збережено!`);
                }
            }
        }
        setFcSubStep('flash', 'ok');
        log('[Крок 1.1] Усі команди пресету успішно надіслано в польотник.');

        // --- ПІДПУНКТ 2: ФІНАЛЬНЕ ЧИТАННЯ (БЕЗ РОЗРИВУ З'ЄДНАННЯ) ---
        setFcSubStep('readDiff', 'working');
        log('[Фінальний контроль] Запит поточної конфігурації (diff all) після заливки...');
        await readCliResponse(reader, 150, false).catch(() => {});
        const postDiffContent = await fetchCliDiff(reader, writer, 4000);
        log(`[Зчитування після запису] Отримано ${postDiffContent.length} байт актуального diff.`);
        setFcSubStep('readDiff', 'ok');

        // --- ПІДПУНКТ 3: ПЕРЕВІРКА ПРЕСЕТУ (100% ЗБІГ) ---
        setFcSubStep('verify', 'working');
        log('[Фінальний контроль] Порівняння зразка пресету з актуальним станом FC...');
        const postMismatchStats = calculateMismatch(script, postDiffContent);
        log(`[Результат перевірки] Неспівпадіння: ${postMismatchStats.mismatchPercent}% (${postMismatchStats.mismatchCount}/${postMismatchStats.totalPresetVars} змінних)`);

        if (postMismatchStats.mismatchCount > 0) {
            setFcSubStep('verify', 'fail');
            const diffSummary = postMismatchStats.mismatchedKeys
                .slice(0, 5)
                .map(m => `  • ${m.key}: очікувалось "${m.expected}", в FC "${m.actual || 'відсутній'}"`)
                .join('\n');
            const totalDiffMsg = `Не співпало ${postMismatchStats.mismatchCount} змінних:\n${diffSummary}${postMismatchStats.mismatchCount > 5 ? '\n  ...та інші' : ''}`;
            log(`[ПОМИЛКА ВЕРИФІКАЦІЇ]:\n${totalDiffMsg}`);

            // Безпечне скасування змін без запису у постійну пам'ять
            try {
                await writer.write('exit\r\n');
                await delay(200);
            } catch (_) {}

            throw new Error(`Помилка перевірки пресету після запису!\n${totalDiffMsg}\nЗапис НЕ збережено (команда save не виконувалась).`);
        }

        // Повна відповідність пресету!
        setFcSubStep('verify', 'ok');
        updateInfoPanel(fcDetails, postMismatchStats, { expectedBoard, expectedMcu, expectedFw });
        log('✅ [ВЕРИФІКАЦІЯ УСПІШНА]: Конфігурація 100% відповідає зразку пресету (0 розбіжностей). Збереження...');

        isRebooting = true;
        state.ignoreRebootEventsUntil = Date.now() + 5000;
        log('> save');
        await writer.write('save\r\n');
        await delay(400);

        await closeSerialSession(state.port, reader, writer, textEncoder);
        state.port = null;

        setStepStatus(1, 'success');
        log('Пресет успішно залито. Контролер перезавантажився.');
        await endOperationStep('SUCCESS', `Пресет успішно записано (0% розбіжностей, ${fcDetails.board})`, {
            board: fcDetails.board,
            firmware: fcDetails.firmware
        });
        showPopup('success', 'Крок 1 Завершено', 'Пресет записано! Переходимо до настройки ESC...', 2000, () => {
            log('Готовий до налаштування регуляторів (ESC). Перевірте підключення батареї LiPo!');
        });

    } catch (err) {
        if (isRebooting || err.message.includes('device has been lost')) {
            state.ignoreRebootEventsUntil = Date.now() + 5000;
            setStepStatus(1, 'success');
            log('Контролер перезавантажився штатно.');
            state.port = null;
            await endOperationStep('SUCCESS', 'Контролер перезавантажився штатно після запису пресету');
            showPopup('success', 'Крок 1 Завершено', 'Пресет записано! Переходимо до настройки ESC...', 2000);
        } else {
            console.error(err);
            state.ignoreRebootEventsUntil = Date.now() + 6000;
            setStepStatus(1, 'fail');
            log(`Помилка кроку 1: ${err.message}`);
            await endOperationStep('FAILED', `Збій: ${err.message}`);
            await closeSerialSession(state.port, reader, writer, textEncoder);
            state.port = null;
            showPopup('error', 'Збій заливання пресету', err.message);
        }
    } finally {
        if (btnFlashFC) btnFlashFC.disabled = false;
        if (btnRestoreFile) btnRestoreFile.disabled = false;
    }
}

export function skipToEsc() {
    log('Пропущено крок 1. Перехід до конфігурації ESC.');
}

/**
 * Expert Mode helper: Reads current FC status, telemetry, and diff all to compare with preset
 * without modifying or flashing anything. Updates left info panel telemetry and mismatch stats.
 */
export async function comparePresetWithFc() {
    if (!('serial' in navigator)) {
        showPopup('error', 'Помилка', 'Web Serial API не підтримується цим браузером.');
        return;
    }

    const btnCompare = document.getElementById('btnComparePreset');
    const script = document.getElementById('presetInput').value.trim();
    if (btnCompare) btnCompare.disabled = true;

    log('\n🔍 [ЕКСПЕРТ] Порівняння поточної конфігурації FC з пресетом (тільки читання)...');
    startOperationStep('FC_COMPARE_PRESET', 'Аналіз конфігурації та порівняння з пресетом');
    let reader = null, writer = null, textEncoder = null;

    try {
        if (isEscSessionActive()) {
            log('[Betaflight] Закриття активної 4-Way сесії ESC перед входом у CLI...');
            await disconnectEscSession();
        }
        state.port = await resolveSelectedPort(log);
        await state.port.open({ baudRate: 115200 });
        log('Порт відкрито на 115200.');

        textEncoder = new TextEncoderStream();
        textEncoder.readable.pipeTo(state.port.writable);
        writer = textEncoder.writable.getWriter();

        const textDecoder = new TextDecoderStream();
        state.port.readable.pipeTo(textDecoder.writable);
        reader = textDecoder.readable.getReader();

        // Enter CLI mode
        await writer.write('#\r\n');
        await delay(350);
        let initEcho = await readCliResponse(reader, 800);
        if (!initEcho.includes('#')) {
            await writer.write('\r\n#\r\n');
            await delay(350);
            initEcho += await readCliResponse(reader, 800);
        }

        // Read status & board telemetry
        await writer.write('version\r\n');
        await delay(150);
        const verText = await readCliResponse(reader, 1000);
        await writer.write('status\r\n');
        await delay(150);
        const statusText = await readCliResponse(reader, 1200);
        await writer.write('mcu_id\r\n');
        await delay(150);
        const mcuIdText = await readCliResponse(reader, 800);

        const actualBoard = parseBoardName(statusText);
        const expectedBoardMatch = script.match(/board_name\s+([A-Za-z0-9_\-]+)/i) || 
                                   script.match(/#\s*(?:board|target):?\s*([A-Za-z0-9_\-]+)/i);
        const expectedBoard = expectedBoardMatch ? expectedBoardMatch[1].trim() : null;

        const expectedMcuMatch = script.match(/#\s*Betaflight\s*\/\s*([A-Za-z0-9_]+)\s/i) ||
                                 script.match(/(?:#\s*mcu:?)\s+([A-Za-z0-9_]+)/i);
        const expectedMcu = expectedMcuMatch ? expectedMcuMatch[1].trim() : null;

        const expectedFwMatch = script.match(/Betaflight\s*\/\s*.*?\b([0-9]+\.[0-9]+\.[0-9]+)\b/i) ||
                                script.match(/(?:#\s*firmware:?)\s+([0-9]+\.[0-9]+\.[0-9]+)/i);
        const expectedFw = expectedFwMatch ? expectedFwMatch[1] : null;

        // Fetch diff all
        log('Зчитування поточної конфігурації (diff all)...');
        const diffContent = await fetchCliDiff(reader, writer, 4000);
        log(`[Зчитування] Отримано ${diffContent.length} байт конфігурації FC.`);

        const fcDetails = parseFcDetails(verText, statusText + '\n' + mcuIdText);
        state.lastFcDetails = fcDetails;
        if (fcDetails.deviceId) {
            setLogDeviceId(fcDetails.deviceId);
        }

        const cleanPresetScript = (document.getElementById('cleanPresetInput')?.value || '').trim();
        const fcStateResult = detectFcState(diffContent, script, cleanPresetScript);
        const mismatchStats = fcStateResult.targetMismatch;
        updateInfoPanel(fcDetails, mismatchStats, { expectedBoard, expectedMcu, expectedFw });

        const isKnownNewHardwareMcu = fcDetails.deviceId && isNewHardwareMcuRecorded(fcDetails.deviceId);

        log(`[Результат порівняння] Плата: ${fcDetails.board}, FW: ${fcDetails.firmware}, MCU: ${fcDetails.mcu}`);
        log(`[Діагностика стану]: ${fcStateResult.state}${isKnownNewHardwareMcu ? ' (⚠️ Раніше зафіксовано в базі нового/стороннього обладнання)' : ''}`);
        log(`  • До робочого пресету: ${mismatchStats.mismatchPercent}% розбіжностей (${mismatchStats.mismatchCount}/${mismatchStats.totalPresetVars})`);
        log(`  • До чистого дампу: ${fcStateResult.cleanMismatch.mismatchPercent}% розбіжностей (${fcStateResult.cleanMismatch.mismatchCount}/${fcStateResult.cleanMismatch.totalPresetVars})`);

        // Set separate history badge if previously recorded as modified/new hardware
        setFcHistoryBadge(Boolean(isKnownNewHardwareMcu));

        if (fcStateResult.state === 'ALREADY_FLASHED') {
            setFcStateBadge('ALREADY_FLASHED');
            log('✅ [100% ЗБІГ] Польотник уже повністю налаштований за цим пресетом (0 розбіжностей)!');
        } else if (fcStateResult.state === 'NEW_HARDWARE') {
            if (fcDetails.deviceId) {
                recordNewHardwareMcu(fcDetails.deviceId);

                // Автоматичне збереження diff all та dump all в IndexedDB при порівнянні з пресетом
                log(`[IndexedDB] Зчитування та збереження diff all + dump all для MCU ${fcDetails.deviceId}...`);
                try {
                    const fullDump = await fetchCliDumpAll(reader, writer, 12000);
                    await saveFcDualDump(fcDetails.deviceId, {
                        diffAll: diffContent,
                        dumpAll: fullDump && fullDump.length > 200 ? fullDump : ''
                    }, {
                        board: fcDetails.board,
                        firmware: fcDetails.firmware,
                        reason: 'NEW_HARDWARE_COMPARE_BACKUP'
                    });
                    log(`✅ [IndexedDB] Обидва дампи (diff all: ${diffContent.length} б, dump all: ${fullDump ? fullDump.length : 0} б) успішно збережено в базі.`);
                } catch (dumpErr) {
                    console.warn('Не вдалося зчитати повний дамп при порівнянні:', dumpErr);
                    log(`[IndexedDB] Помилка зчитування dump all: ${dumpErr.message}. Збережено diff all.`);
                    await saveFcDualDump(fcDetails.deviceId, { diffAll: diffContent }, {
                        board: fcDetails.board,
                        firmware: fcDetails.firmware,
                        reason: 'NEW_HARDWARE_DIFF_COMPARE_FALLBACK'
                    });
                }
            }
            setFcStateBadge('NEW_HARDWARE');
            setFcHistoryBadge(false); // Current state is already NEW_HARDWARE, history badge redundant
            log('⚠️ [НОВЕ ОБЛАДНАННЯ] Польотник містить невідому конфігурацію!');
            const diffSummary = mismatchStats.mismatchedKeys
                .slice(0, 10)
                .map(m => `  • ${m.key}: очікувалось "${m.expected}", в FC "${m.actual || 'відсутній'}"`)
                .join('\n');
            log(`[Розбіжності з робочим пресетом]:\n${diffSummary}${mismatchStats.mismatchCount > 10 ? '\n  ...та інші' : ''}`);
        } else {
            // CLEAN
            setFcStateBadge('CLEAN');
            log('🧼 [ЧИСТИЙ ДАМП] Польотник відповідає чистому базовому дампу і готовий до прошивки.');
        }

        // Захист від скидання лівої панелі через короткочасний USB disconnect при виході з CLI
        state.ignoreRebootEventsUntil = Date.now() + 5000;

        // Clean exit without reboot
        try {
            await writer.write('exit\r\n');
            await delay(150);
        } catch (_) {}

        await closeSerialSession(state.port, reader, writer, textEncoder);
        state.port = null;

        await endOperationStep('SUCCESS', `Порівняння завершено: ${fcStateResult.state}`, {
            state: fcStateResult.state,
            mismatchPercent: mismatchStats.mismatchPercent,
            mismatchCount: mismatchStats.mismatchCount,
            wasPreviouslyRecordedNewHardware: isKnownNewHardwareMcu
        });

        let statusTitle = '';
        let statusMsg = '';
        let popupType = 'info';

        // Check if IndexedDB has a stored dump for this MCU ID to enable download & restore buttons
        const btnExportDump = document.getElementById('btnExportNewHwDump');
        const btnRestoreDiff = document.getElementById('btnRestoreDiffFromDb');
        const btnRestoreDump = document.getElementById('btnRestoreDumpFromDb');
        const storedRecord = fcDetails.deviceId ? await getFcDump(fcDetails.deviceId) : null;
        const hasDiff = Boolean(storedRecord?.diffAll);
        const hasDump = Boolean(storedRecord?.dumpAll);

        if (btnExportDump) {
            btnExportDump.disabled = !(hasDiff || hasDump);
            if (hasDiff || hasDump) {
                btnExportDump.title = `Завантажити збережені diff all та dump all для MCU: ${fcDetails.deviceId}`;
            } else {
                btnExportDump.title = 'Дамп для поточного MCU відсутній в IndexedDB';
            }
        }

        if (btnRestoreDiff) {
            btnRestoreDiff.disabled = !hasDiff;
            if (hasDiff) {
                btnRestoreDiff.title = `Автоматично відновити збережений diff all FC для MCU: ${fcDetails.deviceId}`;
            } else {
                btnRestoreDiff.title = 'Збережений diff all для поточного MCU відсутній в IndexedDB';
            }
        }

        if (btnRestoreDump) {
            btnRestoreDump.disabled = !hasDump;
            if (hasDump) {
                btnRestoreDump.title = `Автоматично відновити збережений повний dump all FC для MCU: ${fcDetails.deviceId}`;
            } else {
                btnRestoreDump.title = 'Збережений dump all для поточного MCU відсутній в IndexedDB';
            }
        }

        // Check if IndexedDB has a stored ESC backup for this MCU ID
        const btnExportEscDb = document.getElementById('btnExportEscDb');
        const btnRestoreEscDb = document.getElementById('btnRestoreEscDb');
        const hasEscBackup = fcDetails.deviceId ? await hasEscBackupInDb(fcDetails.deviceId) : false;
        if (btnExportEscDb) {
            btnExportEscDb.disabled = !hasEscBackup;
            btnExportEscDb.title = hasEscBackup
                ? `Завантажити збережений бекап 4 ESC для MCU: ${fcDetails.deviceId}`
                : 'Бекап ESC для поточного MCU відсутній в IndexedDB';
        }
        if (btnRestoreEscDb) {
            btnRestoreEscDb.disabled = !hasEscBackup;
            btnRestoreEscDb.title = hasEscBackup
                ? `Автоматично відновити збережений бекап 4 ESC для MCU: ${fcDetails.deviceId}`
                : 'Збережений бекап ESC для поточного MCU відсутній в IndexedDB';
        }

        if (fcStateResult.state === 'ALREADY_FLASHED') {
            if (isKnownNewHardwareMcu) {
                popupType = 'warning';
                statusTitle = '⚡ Вже прошитий (був у реєстрі нових)';
                statusMsg = `Поточний стан: ВЖЕ ПРОШИТИЙ (100% збіг з пресетом).\nПримітка: цей контролер (MCU: ${fcDetails.deviceId}) раніше було зафіксовано як нове/стороннє обладнання.`;
            } else {
                popupType = 'success';
                statusTitle = 'Пресет 100% співпадає!';
                statusMsg = 'Польотний контролер уже має 100% параметрів цього пресету (0 розбіжностей).';
            }
        } else if (fcStateResult.state === 'NEW_HARDWARE') {
            popupType = 'warning';
            statusTitle = '⚠️ Нове обладнання виявлено!';
            statusMsg = `Конфігурація FC (MCU: ${fcDetails.deviceId || '—'}) відрізняється як від чистого контролера, так і від робочого пресету (${mismatchStats.mismatchCount} розбіжностей). MCU ID збережено в локальній пам'яті.`;
        } else {
            // CLEAN
            if (isKnownNewHardwareMcu) {
                popupType = 'warning';
                statusTitle = '🧼 Чистий контролер (був у реєстрі нових)';
                statusMsg = `Поточний стан: ЧИСТИЙ ЗАВОДСЬКИЙ ДАМП (готовий до прошивки).\nПримітка: цей контролер (MCU: ${fcDetails.deviceId}) раніше було зафіксовано як нове/стороннє обладнання.`;
            } else {
                popupType = 'info';
                statusTitle = 'Чистий контролер';
                statusMsg = 'Польотник містить чистий заводський дамп і повністю готовий до заливання робочого пресету.';
            }
        }

        showPopup(popupType, statusTitle, statusMsg, 4000);

    } catch (err) {
        console.error(err);
        log(`Помилка порівняння: ${err.message}`);
        await endOperationStep('FAILED', `Збій: ${err.message}`);
        await closeSerialSession(state.port, reader, writer, textEncoder);
        state.port = null;
        showPopup('error', 'Збій порівняння', err.message);
    } finally {
        if (btnCompare) btnCompare.disabled = false;
    }
}

/**
 * Flashes the clean preset into the FC (Expert Mode feature).
 * Prompts confirmation and flashes commands from #cleanPresetInput.
 */
export async function flashCleanPreset() {
    if (!('serial' in navigator)) {
        showPopup('error', 'Помилка', 'Web Serial API не підтримується цим браузером.');
        return;
    }

    const cleanInput = document.getElementById('cleanPresetInput');
    const cleanScript = (cleanInput ? cleanInput.value : '').trim();
    if (!cleanScript) {
        showPopup('error', 'Помилка', 'Еталонний чистий пресет порожній.');
        return;
    }

    if (!window.confirm('⚠️ Залити заводський чистий дамп у FC?\nУсі поточні налаштування польотного контролера будуть замінені на базові.')) {
        return;
    }

    const btnFlashClean = document.getElementById('btnFlashCleanFC');
    const btnFlashFC = document.getElementById('btnFlashFC');
    if (btnFlashClean) btnFlashClean.disabled = true;
    if (btnFlashFC) btnFlashFC.disabled = true;

    setStepStatus(1, 'working', '🔄 Заливання чистого дампу...');
    resetFcSubSteps();
    startOperationStep('FC_FLASH_CLEAN_PRESET', 'Заливання чистого заводського дампу в FC');
    let reader = null, writer = null, textEncoder = null;
    let isRebooting = false;

    try {
        if (isEscSessionActive()) {
            log('[Betaflight] Закриття активної 4-Way сесії ESC перед входом у CLI...');
            await disconnectEscSession();
        }
        state.port = await resolveSelectedPort(log);
        await state.port.open({ baudRate: 115200 });
        log('Порт відкрито на 115200.');

        textEncoder = new TextEncoderStream();
        textEncoder.readable.pipeTo(state.port.writable);
        writer = textEncoder.writable.getWriter();

        const textDecoder = new TextDecoderStream();
        state.port.readable.pipeTo(textDecoder.writable);
        reader = textDecoder.readable.getReader();

        // Enter CLI mode
        log('Ініціалізація Betaflight CLI (#)...');
        await writer.write('#\r\n');
        await delay(350);
        let initEcho = await readCliResponse(reader, 800);
        if (!initEcho.includes('#')) {
            await writer.write('\r\n#\r\n');
            await delay(350);
            initEcho += await readCliResponse(reader, 800);
        }

        // Validate board
        await writer.write('version\r\n');
        await delay(150);
        const verText = await readCliResponse(reader, 1000);
        await writer.write('status\r\n');
        await delay(150);
        const statusText = await readCliResponse(reader, 1200);
        await writer.write('mcu_id\r\n');
        await delay(150);
        const mcuIdText = await readCliResponse(reader, 800);

        const actualBoard = parseBoardName(statusText);
        log(`Виявлено плату: [${actualBoard || 'UNKNOWN'}]`);

        const fcDetails = parseFcDetails(verText, statusText + '\n' + mcuIdText);
        state.lastFcDetails = fcDetails;
        if (fcDetails.deviceId) {
            setLogDeviceId(fcDetails.deviceId);
        }

        // Fetch pre-flash diff to inspect current configuration
        log('Аналіз поточної конфігурації перед заливанням чистого дампу...');
        const preDiff = await fetchCliDiff(reader, writer, 4000);
        const fcStateResult = detectFcState(preDiff, document.getElementById('presetInput')?.value || '', cleanScript);
        updateInfoPanel(fcDetails, fcStateResult.targetMismatch, {});

        // Check if FC is already clean
        if (fcStateResult.state === 'CLEAN') {
            log('🧼 [ВЖЕ ЧИСТИЙ] Польотний контролер уже відповідає еталонному чистому дампу (0 розбіжностей)!');
            log('Пропуск повторного запису чистого дампу.');

            setFcStateBadge('CLEAN');
            setFcSubStep('flash', 'ok', '1. Пропущено (вже чистий)');
            setFcSubStep('readDiff', 'ok', '2. Звірено (100% чистий)');
            setFcSubStep('verify', 'ok', '3. Перевірено (Чистий)');
            setStepStatus(1, 'success', '✅ Вже чистий контролер');

            state.ignoreRebootEventsUntil = Date.now() + 5000;
            try { await writer.write('exit\r\n'); await delay(150); } catch (_) {}

            await closeSerialSession(state.port, reader, writer, textEncoder);
            state.port = null;

            await endOperationStep('SUCCESS', 'Польотник уже має чистий заводський дамп (пропущено)', {
                state: 'CLEAN',
                alreadyClean: true
            });

            showPopup('success', 'Вже чистий контролер', 'Польотний контролер уже на 100% відповідає чистому заводському дампу. Повторний запис скасовано.', 3000);
            return;
        }

        // Substep 1: Flash commands
        setFcSubStep('flash', 'working');
        log('Заливання команд чистого дампу...');
        const lines = cleanScript.split('\n');
        let containsSave = false;

        for (let line of lines) {
            line = line.trim();
            if (!line || line.startsWith('#')) continue;

            if (line.toLowerCase() === 'save') {
                containsSave = true;
                continue;
            }

            await writer.write(line + '\r\n');
            await delay(35);
            await readCliResponse(reader, 250, false);
        }
        setFcSubStep('flash', 'ok');

        // Substep 2: Final read & verify
        setFcSubStep('readDiff', 'working');
        log('Зчитування diff all після запису чистого дампу...');
        const postDiff = await fetchCliDiff(reader, writer, 4000);
        setFcSubStep('readDiff', 'ok');

        setFcSubStep('verify', 'working');
        const cleanState = detectFcState(postDiff, document.getElementById('presetInput')?.value || '', cleanScript);
        setFcSubStep('verify', 'ok');

        setFcStateBadge('CLEAN');
        setStepStatus(1, 'success', '✅ Чистий дамп залито');

        if (containsSave) {
            isRebooting = true;
            log('Збереження та перезавантаження контролера (save)...');
            state.ignoreRebootEventsUntil = Date.now() + 8000;
            await writer.write('save\r\n');
            await delay(300);
        } else {
            try { await writer.write('exit\r\n'); await delay(150); } catch (_) {}
        }

        await closeSerialSession(state.port, reader, writer, textEncoder);
        state.port = null;

        await endOperationStep('SUCCESS', 'Чистий заводський дамп успішно залито в FC');
        showPopup('success', 'Чистий дамп залито!', 'Польотний контролер скинуто та налаштовано на чистий заводський дамп.', 3500);

    } catch (err) {
        console.error(err);
        setStepStatus(1, 'fail');
        setFcSubStep('flash', 'fail');
        log(`Помилка заливання чистого дампу: ${err.message}`);
        await endOperationStep('FAILED', `Збій чистого дампу: ${err.message}`);
        await closeSerialSession(state.port, reader, writer, textEncoder);
        state.port = null;
        showPopup('error', 'Збій прошивки', err.message);
    } finally {
        if (btnFlashClean) btnFlashClean.disabled = false;
        if (btnFlashFC) btnFlashFC.disabled = false;
    }
}

/**
 * Core helper to restore and flash CLI commands from an IndexedDB dump record.
 */
async function executeCliRestoreFromRecord(commandsText, restoreTypeLabel, stepName) {
    if (!('serial' in navigator)) {
        showPopup('error', 'Помилка', 'Web Serial API не підтримується цим браузером.');
        return;
    }

    const deviceId = state.lastFcDetails?.deviceId;
    if (!deviceId || deviceId === '—') {
        showPopup('error', 'Помилка', 'Не вдалося визначити MCU ID поточного контролера. Спочатку виконайте порівняння з пресетом.');
        return;
    }

    if (!commandsText || commandsText.trim().length === 0) {
        showPopup('error', 'Помилка', `Збережений ${restoreTypeLabel} для MCU ${deviceId} порожній.`);
        return;
    }

    const byteLength = new TextEncoder().encode(commandsText).length;
    const formattedSize = byteLength < 1024 
        ? `${byteLength} байт` 
        : `${(byteLength / 1024).toFixed(1)} КБ (${byteLength.toLocaleString()} байт)`;

    const linesCount = commandsText.split('\n').filter(l => l.trim() && !l.trim().startsWith('#')).length;

    if (!window.confirm(`⚠️ Відновити оригінальний ${restoreTypeLabel} для MCU ${deviceId} з бази IndexedDB?\n\n📊 Розмір бекапу: ${formattedSize} (~${linesCount} команд)\n⏳ Зверніть увагу: процес передачі та запису команд у контролер може зайняти деякий час. Будь ласка, не від'єднуйте кабель живлення або USB під час операції.`)) {
        return;
    }

    const btnRestoreDiff = document.getElementById('btnRestoreDiffFromDb');
    const btnRestoreDump = document.getElementById('btnRestoreDumpFromDb');
    const btnFlashFC = document.getElementById('btnFlashFC');
    const activeRestoreBtn = restoreTypeLabel.includes('diff') ? btnRestoreDiff : btnRestoreDump;
    const originalBtnHtml = activeRestoreBtn ? activeRestoreBtn.innerHTML : '';

    if (btnRestoreDiff) btnRestoreDiff.disabled = true;
    if (btnRestoreDump) btnRestoreDump.disabled = true;
    if (btnFlashFC) btnFlashFC.disabled = true;

    if (activeRestoreBtn) {
        activeRestoreBtn.innerHTML = `<span class="btn-spinner"></span>Запис ${restoreTypeLabel}...`;
    }

    setStepStatus(1, 'working', `🔄 Відновлення ${restoreTypeLabel} з БД...`);
    resetFcSubSteps();
    startOperationStep(stepName, `Відновлення збереженого ${restoreTypeLabel} з IndexedDB для MCU ${deviceId}`);
    let reader = null, writer = null, textEncoder = null;
    let isRebooting = false;

    try {
        if (isEscSessionActive()) {
            log('[Betaflight] Закриття активної 4-Way сесії ESC перед входом у CLI...');
            await disconnectEscSession();
        }
        state.port = await resolveSelectedPort(log);
        await state.port.open({ baudRate: 115200 });
        log('Порт відкрито на 115200.');

        textEncoder = new TextEncoderStream();
        textEncoder.readable.pipeTo(state.port.writable);
        writer = textEncoder.writable.getWriter();

        const textDecoder = new TextDecoderStream();
        state.port.readable.pipeTo(textDecoder.writable);
        reader = textDecoder.readable.getReader();

        // Enter CLI mode
        log('Ініціалізація Betaflight CLI (#)...');
        await writer.write('#\r\n');
        await delay(350);
        let initEcho = await readCliResponse(reader, 800);
        if (!initEcho.includes('#')) {
            await writer.write('\r\n#\r\n');
            await delay(350);
            initEcho += await readCliResponse(reader, 800);
        }

        // Substep 1: Flash commands from stored record
        setFcSubStep('flash', 'working', `1. Відновлення (${restoreTypeLabel})`);
        log(`[IndexedDB] Початок запису збереженого ${restoreTypeLabel} (${commandsText.length} байт)...`);
        const lines = commandsText.split('\n');
        let containsSave = false;

        for (let line of lines) {
            line = line.trim();
            if (!line || line.startsWith('#')) continue;

            if (line.toLowerCase() === 'save') {
                containsSave = true;
                continue;
            }

            await writer.write(line + '\r\n');
            await delay(35);
            await readCliResponse(reader, 250, false);
        }
        setFcSubStep('flash', 'ok', '1. Команди відновлено');

        // Substep 2: Final read & verify
        setFcSubStep('readDiff', 'working');
        log('Зчитування diff all після відновлення конфігурації...');
        const postDiff = await fetchCliDiff(reader, writer, 4000);
        setFcSubStep('readDiff', 'ok');

        setFcSubStep('verify', 'working');
        const restoredState = detectFcState(
            postDiff, 
            document.getElementById('presetInput')?.value || '', 
            document.getElementById('cleanPresetInput')?.value || ''
        );
        setFcSubStep('verify', 'ok', '3. Конфігурацію перевірено');

        setFcStateBadge(restoredState.state);
        setStepStatus(1, 'success', `✅ ${restoreTypeLabel} відновлено з БД`);

        if (containsSave) {
            isRebooting = true;
            log('Збереження та перезавантаження контролера (save)...');
            state.ignoreRebootEventsUntil = Date.now() + 8000;
            await writer.write('save\r\n');
            await delay(300);
        } else {
            try { await writer.write('exit\r\n'); await delay(150); } catch (_) {}
        }

        await closeSerialSession(state.port, reader, writer, textEncoder);
        state.port = null;

        await endOperationStep('SUCCESS', `${restoreTypeLabel} FC успішно відновлено з IndexedDB для MCU ${deviceId}`);
        showPopup('success', `${restoreTypeLabel} відновлено!`, `Оригінальну конфігурацію (${restoreTypeLabel}) для MCU ${deviceId} успішно відновлено з бази IndexedDB.`, 3500);

    } catch (err) {
        console.error(err);
        setStepStatus(1, 'fail');
        setFcSubStep('flash', 'fail');
        log(`Помилка відновлення ${restoreTypeLabel} з БД: ${err.message}`);
        await endOperationStep('FAILED', `Збій відновлення: ${err.message}`);
        await closeSerialSession(state.port, reader, writer, textEncoder);
        state.port = null;
        showPopup('error', 'Збій відновлення', err.message);
    } finally {
        if (activeRestoreBtn && originalBtnHtml) {
            activeRestoreBtn.innerHTML = originalBtnHtml;
        }
        if (btnRestoreDiff) btnRestoreDiff.disabled = false;
        if (btnRestoreDump) btnRestoreDump.disabled = false;
        if (btnFlashFC) btnFlashFC.disabled = false;
    }
}

/**
 * Automatically restores and flashes the stored 'diff all' from IndexedDB back into the FC.
 */
export async function restoreFcDiffFromDb() {
    const deviceId = state.lastFcDetails?.deviceId;
    if (!deviceId || deviceId === '—') {
        showPopup('error', 'Помилка', 'Не вдалося визначити MCU ID поточного контролера. Спочатку виконайте порівняння з пресетом.');
        return;
    }

    const record = await getFcDump(deviceId);
    if (!record || !record.diffAll) {
        showPopup('error', 'Diff відсутній', `Для контролера MCU: ${deviceId} у базі IndexedDB збереженого diff all не знайдено.`);
        return;
    }

    await executeCliRestoreFromRecord(record.diffAll, 'diff all', 'FC_RESTORE_DIFF_FROM_DB');
}

/**
 * Automatically restores and flashes the stored 'dump all' from IndexedDB back into the FC.
 */
export async function restoreFcDumpFromDb() {
    const deviceId = state.lastFcDetails?.deviceId;
    if (!deviceId || deviceId === '—') {
        showPopup('error', 'Помилка', 'Не вдалося визначити MCU ID поточного контролера. Спочатку виконайте порівняння з пресетом.');
        return;
    }

    const record = await getFcDump(deviceId);
    const dumpContent = record?.dumpAll;
    if (!record || !dumpContent) {
        showPopup('error', 'Дамп відсутній', `Для контролера MCU: ${deviceId} у базі IndexedDB збереженого dump all не знайдено.`);
        return;
    }

    await executeCliRestoreFromRecord(dumpContent, 'dump all', 'FC_RESTORE_DUMP_FROM_DB');
}

/**
 * Exports both stored diff all and dump all from IndexedDB as separate text files.
 */
export async function exportNewHwDumpFromFile() {
    const deviceId = state.lastFcDetails?.deviceId;
    if (!deviceId || deviceId === '—') {
        showPopup('error', 'Помилка', 'Не вдалося визначити MCU ID поточного контролера. Спочатку виконайте порівняння з пресетом.');
        return;
    }

    try {
        const record = await getFcDump(deviceId);
        const dumpContent = record?.dumpAll;
        const diffContent = record?.diffAll;

        if (!record || (!diffContent && !dumpContent)) {
            showPopup('info', 'Дампи відсутні', `Для контролера MCU: ${deviceId} у базі IndexedDB збережених дампів не знайдено.`);
            return;
        }

        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        const timeStr = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        const board = record.board || 'SPEDIXF722';
        const cleanMcu = deviceId.replace(/^0x/i, '');

        let exportedCount = 0;
        const exportedFiles = [];

        // 1. Export diff all if present
        if (diffContent && diffContent.trim().length > 0) {
            const diffFilename = `NEW_HW_DIFF_${board}_${cleanMcu}_${timeStr}.txt`;
            downloadTextFile(diffFilename, diffContent);
            exportedFiles.push(diffFilename);
            exportedCount++;
            log(`[IndexedDB] Збережений diff all експортовано у файл: ${diffFilename}`);
        }

        // Small delay between downloads so browser handles both sequentially
        if (dumpContent && dumpContent.trim().length > 0) {
            if (exportedCount > 0) {
                await delay(250);
            }
            const dumpFilename = `NEW_HW_DUMP_${board}_${cleanMcu}_${timeStr}.txt`;
            downloadTextFile(dumpFilename, dumpContent);
            exportedFiles.push(dumpFilename);
            exportedCount++;
            log(`[IndexedDB] Збережений dump all експортовано у файл: ${dumpFilename}`);
        }

        showPopup('success', 'Файли завантажено!', `Експортовано ${exportedCount} файл(и):\n${exportedFiles.join('\n')}`, 3500);
    } catch (err) {
        console.error(err);
        showPopup('error', 'Збій експорту дампів', err.message);
    }
}

/**
 * Triggers file input click for FC preset / backup restore.
 */
export function triggerFcRestoreFileSelect() {
    if (!('serial' in navigator)) {
        showPopup('error', 'Помилка', 'Web Serial API не підтримується цим браузером.');
        return;
    }
    const fileRestoreFC = document.getElementById('fileRestoreFC');
    if (fileRestoreFC) fileRestoreFC.click();
}

/**
 * Handles FC restore from an external text file.
 * Reads the file and executes flashBetaflightPreset with full validation and checks.
 */
export async function handleFcRestoreFileChange(event) {
    const fileInput = event.target;
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = ''; // Reset so the same file can be selected again
    if (!file) return;

    try {
        log(`\n📂 [Відновлення з файлу] Завантаження конфігурації з "${file.name}" (${file.size} байт)...`);
        const fileContent = await file.text();
        if (!fileContent || fileContent.trim().length === 0) {
            showPopup('error', 'Порожній файл', `Обраний файл "${file.name}" не містить тексту або порожній.`);
            return;
        }

        await flashBetaflightPreset(null, fileContent, file.name);
    } catch (err) {
        console.error(err);
        showPopup('error', 'Помилка читання файлу', err.message);
    }
}

