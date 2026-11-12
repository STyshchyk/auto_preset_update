/**
 * Drone Sequential Orchestrator
 * Coordinates automated pipeline execution:
 * Step 1 (FC Flashing & UID Extraction) ➔ FC Reboot Delay ➔ Step 2 (BLHeli_32 ESC Configuration)
 * Updates Progression UI and Daily/All-Time statistics by Unique Device ID.
 */

import { delay } from '../utils/bytes.js';
import { state } from '../core/state.js';
import { log, setLogDeviceId } from '../ui/log.js';
import { flashBetaflightPreset } from '../betaflight/preset.js';
import { applyEscPreset } from '../blheli/preset.js';
import { setProgressionStep, setProgressionBanner, resetProgression } from '../ui/progression.js';
import { recordDeviceResult } from '../utils/stats.js';
import { setStep2Finished, spinAllMotors, setMotorCountdownOverlay } from '../motors/test.js';

export async function runFullDroneSequence() {
    const btnRun = document.getElementById('btnRunSimplified');
    if (btnRun) btnRun.disabled = true;

    setMotorCountdownOverlay(false);
    setStep2Finished(false);
    resetProgression();
    setProgressionBanner('working', 'Запуск автоматичної прошивки...', 'Ініціалізація зв\'язку з польотним контролером.');

    let capturedDeviceId = null;

    try {
        // --- STEP 1: BETAFLIGHT FC PRESET FLASHING ---
        const t0 = performance.now();
        setProgressionStep(1, 'working', 'Підключення та зчитування UID...');
        log('\n=== [АВТО-КОНВЕЄР] ЕТАП 1: ПРОШИВКА ПОЛЬОТНОГО КОНТРОЛЕРА ===');

        let tFlashStart = performance.now();

        // Execute Step 1 with onTelemetryReady callback
        const flashResult = await flashBetaflightPreset((fcDetails) => {
            const t1 = performance.now();
            const durValidation = ((t1 - t0) / 1000).toFixed(1);
            // As soon as board target, BTFL version, and device UID are identified:
            if (fcDetails && fcDetails.deviceId) {
                capturedDeviceId = fcDetails.deviceId;
                setLogDeviceId(capturedDeviceId);
            }
            // Transition Step 1 to success and immediately activate Step 2 as working!
            setProgressionStep(1, 'success', `Target: ${fcDetails.board} | UID: ${capturedDeviceId || 'OK'}`, durValidation);
            tFlashStart = performance.now();
            setProgressionStep(2, 'working', 'Заливання CLI команд пресету...');
            setProgressionBanner('working', 'Заливання пресету FC...', 'Передача команд конфігурації у польотний контролер.');
        });

        const durFlash = ((performance.now() - tFlashStart) / 1000).toFixed(1);

        const elDeviceId = document.getElementById('infoDeviceId');
        if (elDeviceId && elDeviceId.textContent && elDeviceId.textContent !== '—') {
            capturedDeviceId = elDeviceId.textContent.trim().toLowerCase();
        }

        // Verify if step 1 succeeded
        const stepStatus1 = document.getElementById('stepStatus1');
        if (stepStatus1 && stepStatus1.classList.contains('fail')) {
            throw new Error('Помилка під час прошивки Betaflight (Крок 1 не пройдено).');
        }

        const isSkipped = flashResult && flashResult.skipped;
        if (isSkipped) {
            setProgressionStep(2, 'success', 'Вже прошитий (0% розбіжностей, пропущено)', durFlash);
        } else {
            // Пресет FC успішно записано та перевірено (Крок 1 пройшов)
            setProgressionStep(2, 'success', 'Пресет FC успішно записано', durFlash);
        }

        // --- BATTERY CHECK IN SIMPLIFIED MODE ---
        // Betaflight 'status' detects battery presence. In simplified mode, ESC cannot be flashed without LiPo!
        if (state.lastFcDetails && state.lastFcDetails.batteryPresent === false) {
            log(`[УВАГА] Батарею не виявлено: ${state.lastFcDetails.batteryInfo}`);
            throw new Error(`Силову батарею (LiPo) не підключено: ${state.lastFcDetails.batteryInfo}! Підключіть LiPo акумулятор перед прошивкою регуляторів ESC.`);
        }

        const bannerDetails = isSkipped 
            ? 'Пристрій вже прошитий. Переходимо до налаштування ESC...' 
            : 'Очікування перезавантаження FC перед налаштуванням ESC...';
        setProgressionBanner('working', 'Крок 1 успішно!', bannerDetails);

        // --- STEP 2: REBOOT & 4-WAY HANDSHAKE WAIT ---
        const tRebootStart = performance.now();
        const waitTimeMs = isSkipped ? 2500 : 5000;
        setProgressionStep(3, 'working', isSkipped ? 'Готовність FC (2.5 сек)...' : 'Перезавантаження FC (5 сек)...');
        await delay(waitTimeMs);
        const durReboot = ((performance.now() - tRebootStart) / 1000).toFixed(1);
        setProgressionStep(3, 'success', 'FC готовий до 4-Way', durReboot);

        // --- STEP 3: BLHELI_32 ESC FLASHING ---
        const tEscStart = performance.now();
        setProgressionStep(4, 'working', 'Запис пресету 4-х ESC (LiPo 4S-6S)...');
        log('\n=== [АВТО-КОНВЕЄР] ЕТАП 2: КОНФІГУРАЦІЯ 4-Х ESC ===');

        await applyEscPreset();
        const durEsc = ((performance.now() - tEscStart) / 1000).toFixed(1);

        const stepStatus2 = document.getElementById('stepStatus2');
        if (stepStatus2 && stepStatus2.classList.contains('fail')) {
            throw new Error('Помилка під час налаштування ESC (Крок 2 не пройдено). Перевірте живлення LiPo!');
        }

        setProgressionStep(4, 'success', '4 ESC: Заливка ➔ Перевірка ➔ Статус OK', durEsc);

        // --- STEP 4: TRANSITION TO MOTOR DIRECTION TESTING (STEP 3 IN UI / STAGE 5 IN PROGRESSION) ---
        setStep2Finished(true, capturedDeviceId);
        setProgressionStep(5, 'working', 'Перезавантаження ESC та готовність (5 сек)...');
        setProgressionBanner('working', 'Крок 3: Підготовка моторів...', 'Перезавантаження ESC після запису. Мотори запустяться за 5 секунд.');

        // Show countdown spinner overlay over drone diagram
        setMotorCountdownOverlay(true, '8.0s');
        log('\n[КРОК 3] Очікування 5.0 секунд для стабілізації ESC після перезавантаження...');

        // 5-second countdown ticker (100ms updates)
        const countdownStart = performance.now();
        const totalWaitMs = 8000;
        while (performance.now() - countdownStart < totalWaitMs) {
            const remaining = Math.max(0, (totalWaitMs - (performance.now() - countdownStart)) / 1000).toFixed(1);
            setMotorCountdownOverlay(true, `${remaining}s`);
            await delay(100);
        }

        // Fade out overlay
        setMotorCountdownOverlay(false);
        setProgressionStep(5, 'working', 'Автоматичний запуск моторів...');
        setProgressionBanner('working', 'Крок 3: Перевірка моторів', 'Мотори запущено. Перевірте обертання та натисніть «Завершити налаштування».');

        // Automatically start all motors on safe idle speed
        try {
            await delay(150); // Minor stabilization delay
            await spinAllMotors();
        } catch (spinErr) {
            console.warn('Auto-spin warning:', spinErr);
            log(`Попередження автозапуску моторів: ${spinErr.message}`, 'warning');
        }

        log(`\n👉 [АВТО-КОНВЕЄР] ЕТАП 2 ЗАВЕРШЕНО. МОТОРИ ЗАПУЩЕНО АВТОМАТИЧНО. ПЕРЕВІРТЕ ОБЕРТАННЯ ТА НАТИСНІТЬ «🏁 Завершити налаштування».`);

    } catch (err) {
        console.error('[Pipeline Error]:', err);
        setMotorCountdownOverlay(false);
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
