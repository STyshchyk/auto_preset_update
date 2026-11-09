/**
 * Drone Sequential Orchestrator
 * Coordinates automated pipeline execution:
 * Step 1 (FC Flashing & UID Extraction) ➔ FC Reboot Delay ➔ Step 2 (BLHeli_32 ESC Configuration)
 * Updates Progression UI and Daily/All-Time statistics by Unique Device ID.
 */

import { delay } from '../utils/bytes.js';
import { state } from '../core/state.js';
import { log } from '../ui/log.js';
import { flashBetaflightPreset } from '../betaflight/preset.js';
import { applyEscPreset } from '../blheli/preset.js';
import { setProgressionStep, setProgressionBanner, resetProgression } from '../ui/progression.js';
import { recordDeviceResult } from '../utils/stats.js';

export async function runFullDroneSequence() {
    const btnRun = document.getElementById('btnRunSimplified');
    if (btnRun) btnRun.disabled = true;

    resetProgression();
    setProgressionBanner('working', 'Запуск автоматичної прошивки...', 'Ініціалізація зв\'язку з польотним контролером.');

    let capturedDeviceId = null;

    try {
        // --- STEP 1: BETAFLIGHT FC PRESET FLASHING ---
        setProgressionStep(1, 'working', 'Підключення та зчитування UID...');
        log('\n=== [АВТО-КОНВЕЄР] ЕТАП 1: ПРОШИВКА ПОЛЬОТНОГО КОНТРОЛЕРА ===');

        // Execute Step 1 with onTelemetryReady callback
        await flashBetaflightPreset((fcDetails) => {
            // As soon as board target, BTFL version, and device UID are identified:
            if (fcDetails && fcDetails.deviceId) {
                capturedDeviceId = fcDetails.deviceId;
            }
            // Transition Step 1 to success and immediately activate Step 2 as working!
            setProgressionStep(1, 'success', `Target: ${fcDetails.board} | UID: ${capturedDeviceId || 'OK'}`);
            setProgressionStep(2, 'working', 'Заливання CLI команд пресету...');
            setProgressionBanner('working', 'Заливання пресету FC...', 'Передача команд конфігурації у польотний контролер.');
        });

        const elDeviceId = document.getElementById('infoDeviceId');
        if (elDeviceId && elDeviceId.textContent && elDeviceId.textContent !== '—') {
            capturedDeviceId = elDeviceId.textContent.trim().toLowerCase();
        }

        // Verify if step 1 succeeded
        const stepStatus1 = document.getElementById('stepStatus1');
        if (stepStatus1 && stepStatus1.classList.contains('fail')) {
            throw new Error('Помилка під час прошивки Betaflight (Крок 1 не пройдено).');
        }

        // --- BATTERY CHECK IN SIMPLIFIED MODE ---
        // Betaflight 'status' detects battery presence. In simplified mode, ESC cannot be flashed without LiPo!
        if (state.lastFcDetails && state.lastFcDetails.batteryPresent === false) {
            log(`[УВАГА] Батарею не виявлено: ${state.lastFcDetails.batteryInfo}`);
            throw new Error(`Силову батарею (LiPo) не підключено: ${state.lastFcDetails.batteryInfo}! Підключіть LiPo акумулятор перед прошивкою регуляторів ESC.`);
        }

        setProgressionStep(1, 'success', `UID: ${capturedDeviceId || 'OK'}`);
        setProgressionStep(2, 'success', 'Пресет FC успішно записано');
        setProgressionBanner('working', 'Крок 1 успішно!', 'Очікування перезавантаження FC перед налаштуванням ESC...');

        // --- STEP 2: REBOOT & 4-WAY HANDSHAKE WAIT ---
        setProgressionStep(3, 'working', 'Перезавантаження FC (3.5 сек)...');
        await delay(3500);
        setProgressionStep(3, 'success', 'FC готовий до 4-Way');

        // --- STEP 3: BLHELI_32 ESC FLASHING ---
        setProgressionStep(4, 'working', 'Запис пресету 4-х ESC (LiPo 4S-6S)...');
        log('\n=== [АВТО-КОНВЕЄР] ЕТАП 2: КОНФІГУРАЦІЯ 4-Х ESC ===');

        await applyEscPreset();

        const stepStatus2 = document.getElementById('stepStatus2');
        if (stepStatus2 && stepStatus2.classList.contains('fail')) {
            throw new Error('Помилка під час налаштування ESC (Крок 2 не пройдено). Перевірте живлення LiPo!');
        }

        setProgressionStep(4, 'success', '4 ESC: Заливка ➔ Перевірка ➔ Статус OK');
        setProgressionBanner('success', 'ДРОН ПРОШИТО УСПІШНО! 🎉', `UID: ${capturedDeviceId || 'Успішно'}. Всі 4 мотори готові до польоту.`);

        // Record successful run by UID
        recordDeviceResult(capturedDeviceId, true);
        log(`\n🎉 [АВТО-КОНВЕЄР] УСПІШНО ЗАВЕРШЕНО ДЛЯ ПРИСТРОЮ: ${capturedDeviceId || 'OK'}`);

    } catch (err) {
        console.error('[Pipeline Error]:', err);
        const errMsg = err.message || 'Невідома помилка під час прошивки.';
        setProgressionBanner('fail', 'ЗБІЙ ПРОШИВКИ ДРОНА', errMsg);

        // Mark corresponding progression steps as failed
        const stepStatus1 = document.getElementById('stepStatus1');
        if (stepStatus1 && stepStatus1.classList.contains('fail')) {
            setProgressionStep(1, 'fail', 'Збій FC');
            setProgressionStep(2, 'fail', 'Не записано');
        } else {
            setProgressionStep(4, 'fail', 'Збій ESC (LiPo?)');
        }

        // Record failure
        recordDeviceResult(capturedDeviceId, false);
        log(`\n❌ [АВТО-КОНВЕЄР] ПОМИЛКА: ${errMsg}`);
    } finally {
        if (btnRun) btnRun.disabled = false;
    }
}
