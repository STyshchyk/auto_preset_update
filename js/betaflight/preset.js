import { delay } from '../utils/bytes.js';
import { state } from '../core/state.js';
import { resolveSelectedPort, closeSerialSession } from '../core/serial.js';
import { log } from '../ui/log.js';
import { setStepStatus, setFcSubStep, resetFcSubSteps } from '../ui/status.js';
import { showPopup } from '../ui/modal.js';
import { readCliResponse, parseBoardName } from './cli.js';
import { parseFcDetails, calculateMismatch } from './info.js';
import { updateInfoPanel } from '../ui/infoPanel.js';
import { isEscSessionActive, disconnectEscSession } from '../blheli/session.js';

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

export async function flashBetaflightPreset(onTelemetryReady = null) {
    if (!('serial' in navigator)) {
        setStepStatus(1, 'fail');
        showPopup('error', 'Помилка', 'Web Serial API не підтримується цим браузером.');
        return;
    }

    const btnFlashFC = document.getElementById('btnFlashFC');
    const script = document.getElementById('presetInput').value.trim();
    btnFlashFC.disabled = true;
    setStepStatus(1, 'working');
    resetFcSubSteps();
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

        log(`Виявлено плату: [${actualBoard || 'UNKNOWN'}]`);

        // Аналіз польотника та розрахунок % неспівпадіння через diff all (до прошивки)
        log('Аналіз поточної конфігурації польотника (diff all)...');
        const diffContent = await fetchCliDiff(reader, writer, 4000);
        log(`[Зчитування] Отримано ${diffContent.length} байт конфігурації FC.`);

        const fcDetails = parseFcDetails(verText, statusText + '\n' + mcuIdText);
        state.lastFcDetails = fcDetails;
        const mismatchStats = calculateMismatch(script, diffContent);
        updateInfoPanel(fcDetails, mismatchStats);
        log(`[Інфо] Плата: ${fcDetails.board}, Прошивка: ${fcDetails.firmware}, Дата: ${fcDetails.buildDate}`);
        log(`[Аналіз пресету (до запису)] Неспівпадіння: ${mismatchStats.mismatchPercent}% (${mismatchStats.mismatchCount}/${mismatchStats.totalPresetVars} змінних)`);

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
        updateInfoPanel(fcDetails, postMismatchStats);
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
        if (state.lastFcDetails && state.lastFcDetails.batteryPresent === false) {
            showPopup('error', 'Батарею не виявлено!', 'Прошивка FC успішна, але батареї немає. Прошивка ESC неможлива!', 2000);
        } else {
            showPopup('success', 'Крок 1 Завершено', 'Пресет записано! Переходимо до настройки ESC...', 2000, () => {
                log('Готовий до налаштування регуляторів (ESC). Перевірте підключення батареї LiPo!');
            });
        }

    } catch (err) {
        if (isRebooting || err.message.includes('device has been lost')) {
            state.ignoreRebootEventsUntil = Date.now() + 5000;
            setStepStatus(1, 'success');
            log('Контролер перезавантажився штатно.');
            state.port = null;
            if (state.lastFcDetails && state.lastFcDetails.batteryPresent === false) {
                showPopup('error', 'Батарею не виявлено!', 'Прошивка FC успішна, але батареї немає. Прошивка ESC неможлива!', 2000);
            } else {
                showPopup('success', 'Крок 1 Завершено', 'Пресет записано! Переходимо до настройки ESC...', 2000);
            }
        } else {
            console.error(err);
            state.ignoreRebootEventsUntil = Date.now() + 6000;
            setStepStatus(1, 'fail');
            log(`Помилка кроку 1: ${err.message}`);
            await closeSerialSession(state.port, reader, writer, textEncoder);
            state.port = null;
            showPopup('error', 'Збій заливання пресету', err.message);
        }
    } finally {
        btnFlashFC.disabled = false;
    }
}

export function skipToEsc() {
    log('Пропущено крок 1. Перехід до конфігурації ESC.');
}
