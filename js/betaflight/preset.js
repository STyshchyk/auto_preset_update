import { delay } from '../utils/bytes.js';
import { state } from '../core/state.js';
import { resolveSelectedPort, closeSerialSession } from '../core/serial.js';
import { log } from '../ui/log.js';
import { setStepStatus } from '../ui/status.js';
import { showPopup } from '../ui/modal.js';
import { readCliResponse, parseBoardName } from './cli.js';
import { presetComparator } from './comparison_coordinator.js';
import { ComparisonStatus } from '../ui/fc_panel.js';

export async function flashBetaflightPreset() {
    if (!('serial' in navigator)) {
        setStepStatus(1, 'fail');
        showPopup('error', 'Помилка', 'Web Serial API не підтримується цим браузером.');
        return;
    }

    const btnFlashFC = document.getElementById('btnFlashFC');
    const script = document.getElementById('presetInput').value.trim();
    btnFlashFC.disabled = true;
    setStepStatus(1, 'working');

    // =========================================================================
    // PRE-FLASH PRESET COMPARISON & VALIDATION (Read-Only)
    // Runs or checks comparison: if configuration already matches, bypasses flashing.
    // =========================================================================
    try {
        let compResult = presetComparator.lastComparisonResult;
        const textMatches = presetComparator.lastComparedPresetText === script;

        if (!compResult || !textMatches || compResult.status === ComparisonStatus.NOT_CHECKED) {
            log('\n[Pre-Flash Перевірка] Запуск порівняння поточної конфігурації з пресетом...');
            compResult = await presetComparator.runComparison({
                presetScript: script,
                log
            });
        }

        if (compResult && compResult.status === ComparisonStatus.MATCH) {
            setStepStatus(1, 'success');
            log('✅ [PASS] Конфігурація вже повністю відповідає пресету. Повторне заливання скасовано.');
            btnFlashFC.disabled = false;
            showPopup('success', 'Пресет актуальний', 'Конфігурація FC вже повністю відповідає обраному пресету. Повторне заливання не потрібне.', 3000);
            return;
        }

        if (compResult && compResult.diffCount > 0) {
            log(`⚠️ [Конфігурація відрізняється]: Виявлено ${compResult.diffCount} відмінностей. Переходимо до заливання пресету...`);
        }
    } catch (valErr) {
        log(`ℹ️ [Попередження порівняння]: ${valErr.message}. Продовжуємо стандартне заливання...`);
    }

    let reader = null, writer = null, textEncoder = null;
    let isRebooting = false;

    try {
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

        const actualBoard = parseBoardName(initEcho + '\n' + verText + '\n' + statusText);
        const expectedBoardMatch = script.match(/(?:board_name|#\s*target:?)\s+([A-Za-z0-9_-]+)/i);
        const expectedBoard = expectedBoardMatch ? expectedBoardMatch[1].toUpperCase() : null;

        log(`Виявлено плату: [${actualBoard || 'UNKNOWN'}]`);

        if (expectedBoard && actualBoard && !actualBoard.includes(expectedBoard) && !expectedBoard.includes(actualBoard)) {
            try { await writer.write('exit\r\n'); } catch (_) {}
            throw new Error(`Невідповідність плати! Очікувалось [${expectedBoard}], підключено [${actualBoard}].`);
        }

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
            
            // Читаємо відповідь від FC для кожної команди для виявлення помилок (abort on error)
            const resp = await readCliResponse(reader, 600);
            if (resp) {
                const cleanResp = resp.trim();
                // Перевіряємо маркери помилок CLI Betaflight
                const errorMatch = cleanResp.match(/(###ERROR[^\r\n#]*###|PARSE ERROR[^\r\n#]*|UNKNOWN COMMAND[^\r\n#]*|INVALID[^\r\n#]*)/i);
                if (errorMatch) {
                    const errMsg = errorMatch[1].trim();
                    log(`[УВАГА / ПОМИЛКА FC]: ${errMsg}`);
                    // ПРИМУСОВИЙ ABORT:
                    // Захищаємо статус від випадкового скидання через reboot/disconnect
                    state.ignoreRebootEventsUntil = Date.now() + 6000;
                    try {
                        await writer.write('exit\r\n');
                        await delay(200);
                    } catch (_) {}
                    throw new Error(`Помилка у команді "${line}":\n${errMsg}\nЗапис перервано (ABORT), зміни НЕ збережено!`);
                }
            }
        }

        isRebooting = true;
        state.ignoreRebootEventsUntil = Date.now() + 5000;
        log('> save');
        await writer.write('save\r\n');
        await delay(400);

        await closeSerialSession(state.port, reader, writer, textEncoder);
        state.port = null;

        setStepStatus(1, 'success');
        log('Пресет успішно залито. Контролер перезавантажився.');
        showPopup('success', 'Крок 1 Завершено', 'Пресет записано! Переходимо до настройки ESC...', 2000, () => {
            log('Готовий до налаштування регуляторів (ESC). Перевірте підключення батареї LiPo!');
        });

    } catch (err) {
        if (isRebooting || err.message.includes('device has been lost')) {
            state.ignoreRebootEventsUntil = Date.now() + 5000;
            setStepStatus(1, 'success');
            log('Контролер перезавантажився штатно.');
            state.port = null;
            showPopup('success', 'Крок 1 Завершено', 'Пресет записано! Переходимо до настройки ESC...', 2000);
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
