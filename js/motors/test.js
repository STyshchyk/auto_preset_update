/**
 * Motor testing, rotation verification, and direction reversal via Betaflight MSP.
 */

import { delay } from '../utils/bytes.js';
import { state } from '../core/state.js';
import { resolveSelectedPort } from '../core/serial.js';
import { log, startOperationStep, endOperationStep } from '../ui/log.js';
import { setStepStatus } from '../ui/status.js';
import { showPopup } from '../ui/modal.js';
import {
    sendMsp,
    setMotorOutputs,
    sendDshotProgCommand,
    DSHOT_CMD_SPIN_DIRECTION_1,
    DSHOT_CMD_SPIN_DIRECTION_2,
    DSHOT_CMD_SAVE_SETTINGS
} from '../betaflight/msp.js';

// QuadX Standard Motor Layout:
// Motor 1: Rear Right (Usually CCW or CW depending on props out)
// Motor 2: Front Right
// Motor 3: Rear Left
// Motor 4: Front Left
export const MOTOR_COUNT = 4;
export const DEFAULT_SPIN_THROTTLE = 1030; // Safe idle spin speed (~3%)

export const motorState = {
    isSpinning: false,
    isBusy: false,
    propellersRemovedConfirmed: false,
    currentThrottle: DEFAULT_SPIN_THROTTLE,
    directions: ['normal', 'normal', 'normal', 'normal'] // 0: M1, 1: M2, 2: M3, 3: M4
};

/**
 * Updates UI representation of motor directions and states.
 */
export function updateMotorUi() {
    for (let i = 0; i < MOTOR_COUNT; i++) {
        const dir = motorState.directions[i];
        const badge = document.getElementById(`mBadge${i + 1}`);
        const icon = document.getElementById(`mArrow${i + 1}`);
        const btnRev = document.getElementById(`btnRevMotor${i + 1}`);

        if (badge) {
            badge.textContent = dir === 'reversed' ? 'REVERSED' : 'NORMAL';
            badge.className = `motor-dir-badge ${dir}`;
        }
        if (icon) {
            icon.className = `motor-arrow ${dir}`;
        }
        if (btnRev) {
            btnRev.textContent = 'Реверс';
        }
    }

    const btnSpin = document.getElementById('btnSpinAllMotors');
    const btnStop = document.getElementById('btnStopAllMotors');
    const btnSave = document.getElementById('btnSaveMotorDirections');
    const chkSafety = document.getElementById('chkPropellersRemoved');
    const slider = document.getElementById('throttleSlider');
    const badgeVal = document.getElementById('throttleValBadge');

    const canOperate = Boolean(chkSafety && chkSafety.checked) && !motorState.isBusy;

    if (slider) {
        slider.disabled = !canOperate;
        slider.value = motorState.currentThrottle;
    }
    if (badgeVal) {
        badgeVal.textContent = motorState.currentThrottle;
    }

    if (btnSpin) {
        btnSpin.disabled = !canOperate || motorState.isSpinning;
    }
    if (btnStop) {
        btnStop.disabled = !canOperate || !motorState.isSpinning;
    }
    for (let i = 1; i <= MOTOR_COUNT; i++) {
        const b = document.getElementById(`btnRevMotor${i}`);
        if (b) b.disabled = !canOperate;
    }
    if (btnSave) {
        btnSave.disabled = !canOperate;
    }
}

/**
 * Spins all 4 motors simultaneously at low idle speed.
 */
export async function spinAllMotors() {
    if (!motorState.propellersRemovedConfirmed) {
        showPopup('warning', 'Увага: Безпека!', 'Будь ласка, зніміть пропелери та підтвердіть чекбокс безпеки перед пуском.');
        return;
    }

    const port = await resolveSelectedPort();
    if (!port) {
        showPopup('error', 'Помилка', 'Оберіть та підключіть COM-порт.');
        return;
    }

    try {
        setStepStatus(3, 'working');
        startOperationStep('MOTOR_SPIN_ALL', 'Тестовий запуск 4 моторів');
        const targetThrottle = motorState.currentThrottle || DEFAULT_SPIN_THROTTLE;
        log(`Пуск усіх 4 моторів на швидкості ${targetThrottle}µs...`);

        if (!port.readable || !port.writable) {
            await port.open({ baudRate: 115200 });
        }

        const writer = port.writable.getWriter();
        try {
            await setMotorOutputs(writer, [
                targetThrottle,
                targetThrottle,
                targetThrottle,
                targetThrottle
            ]);
            motorState.isSpinning = true;
            updateMotorUi();
            log(`Мотори обертаються (${targetThrottle}µs). Перевірте напрямок кожного мотора.`);
        } finally {
            writer.releaseLock();
        }
    } catch (e) {
        log(`Помилка пуску моторів: ${e.message}`, 'error');
        showPopup('error', 'Помилка пуску', `Не вдалося запустити мотори: ${e.message}`);
        setStepStatus(3, 'fail');
    }
}

/**
 * Stops all motors immediately.
 */
export async function stopAllMotors() {
    const port = await resolveSelectedPort();
    if (!port) return;

    try {
        if (!port.readable || !port.writable) {
            await port.open({ baudRate: 115200 });
        }

        const writer = port.writable.getWriter();
        try {
            await setMotorOutputs(writer, [1000, 1000, 1000, 1000]);
            motorState.isSpinning = false;
            updateMotorUi();
            log('Всі мотори зупинено (1000µs).');
            endOperationStep('MOTOR_SPIN_ALL');
            setStepStatus(3, 'idle');
        } finally {
            writer.releaseLock();
        }
    } catch (e) {
        log(`Помилка зупинки моторів: ${e.message}`, 'error');
    }
}

/**
 * Toggles and immediately applies rotation direction + EEPROM save for a single motor
 * via DShot (MSP2_SEND_DSHOT_COMMAND + Betaflight CLI dshotprog).
 *
 * @param {number} motorIndex 0-indexed (0=M1, 1=M2, 2=M3, 3=M4)
 */
export async function toggleMotorDirection(motorIndex) {
    if (motorIndex < 0 || motorIndex >= MOTOR_COUNT || motorState.isBusy) return;

    const currentDir = motorState.directions[motorIndex];
    const newDir = currentDir === 'normal' ? 'reversed' : 'normal';
    const dshotCmd = newDir === 'reversed' ? DSHOT_CMD_SPIN_DIRECTION_2 : DSHOT_CMD_SPIN_DIRECTION_1;

    const port = await resolveSelectedPort();
    if (!port) {
        showPopup('error', 'Помилка', 'Оберіть COM-порт для відправки команд DShot.');
        return;
    }

    motorState.isBusy = true;
    updateMotorUi();

    try {
        log(`Зміна напрямку Мотора #${motorIndex + 1}: ${currentDir.toUpperCase()} -> ${newDir.toUpperCase()}...`);
        if (!port.readable || !port.writable) {
            await port.open({ baudRate: 115200 });
        }

        const wasSpinning = motorState.isSpinning;

        // 1. Betaflight requires ALL motors to be at 1000µs (!motorIsEnabled) to accept blocking DShot commands
        if (wasSpinning) {
            const writer = port.writable.getWriter();
            try {
                await setMotorOutputs(writer, [1000, 1000, 1000, 1000]);
            } finally {
                writer.releaseLock();
            }
            await delay(300); // Allow all 4 motors to come to a complete stop
        }

        // 2. Dispatch DShot direction command (7 or 8) + Save Settings (12) immediately
        await sendDshotProgCommand(port, motorIndex, [dshotCmd, DSHOT_CMD_SAVE_SETTINGS]);
        motorState.directions[motorIndex] = newDir;
        log(`Напрямок Мотора #${motorIndex + 1} змінено та збережено: ${newDir.toUpperCase()} (DShot cmd ${dshotCmd} + 12).`);

        // 3. If motors were spinning, spin all 4 motors back up automatically
        if (wasSpinning && motorState.isSpinning) {
            const targetThrottle = motorState.currentThrottle || DEFAULT_SPIN_THROTTLE;
            const writer = port.writable.getWriter();
            try {
                await setMotorOutputs(writer, [
                    targetThrottle,
                    targetThrottle,
                    targetThrottle,
                    targetThrottle
                ]);
            } finally {
                writer.releaseLock();
            }
            log(`Обертання моторів відновлено (${targetThrottle}µs).`);
        }
    } catch (e) {
        log(`Помилка зміни напрямку мотора #${motorIndex + 1}: ${e.message}`, 'error');
        showPopup('error', 'Помилка реверсу', e.message);
    } finally {
        motorState.isBusy = false;
        updateMotorUi();
    }
}

/**
 * Stops any spinning motors, finalizes Step 3, and cleanly closes the serial port connection.
 */
export async function saveMotorDirections() {
    if (motorState.isBusy) return;

    const port = await resolveSelectedPort();
    if (!port) {
        showPopup('error', 'Помилка', 'Оберіть та підключіть COM-порт.');
        return;
    }

    motorState.isBusy = true;
    updateMotorUi();

    try {
        setStepStatus(3, 'working');
        startOperationStep('MOTOR_SAVE_SETTINGS', 'Завершення налаштування моторів та закриття з\'єднання');

        // 1. Stop motors if currently spinning
        if (motorState.isSpinning) {
            log('Зупинка моторів перед закриттям з\'єднання...');
            await stopAllMotors();
            await delay(200);
        }

        // 2. Close serial port connection cleanly
        if (port.readable || port.writable) {
            log('Закриття послідовного порту (COM)...');
            try {
                await port.close();
            } catch (closeErr) {
                console.warn('port.close() warning:', closeErr);
            }
        }
        state.port = null;

        log('Налаштування напрямків моторів завершено. З\'єднання з портом закрито.');
        endOperationStep('MOTOR_SAVE_SETTINGS');
        setStepStatus(3, 'ok');
        showPopup('success', 'Успішно', 'Напрямки обертання моторів збережено, мотори зупинено, з\'єднання з портом закрито!');
    } catch (e) {
        log(`Помилка завершення налаштувань ESC: ${e.message}`, 'error');
        showPopup('error', 'Помилка', `Не вдалося завершити збереження: ${e.message}`);
        setStepStatus(3, 'fail');
    } finally {
        motorState.isBusy = false;
        updateMotorUi();
    }
}

/**
 * Initializes DOM listeners and safety state for Step 3.
 */
export function initMotorControls() {
    const chkSafety = document.getElementById('chkPropellersRemoved');
    if (chkSafety) {
        chkSafety.addEventListener('change', (e) => {
            motorState.propellersRemovedConfirmed = e.target.checked;
            updateMotorUi();
        });
    }

    const btnSpin = document.getElementById('btnSpinAllMotors');
    if (btnSpin) {
        btnSpin.addEventListener('click', spinAllMotors);
    }

    const btnStop = document.getElementById('btnStopAllMotors');
    if (btnStop) {
        btnStop.addEventListener('click', stopAllMotors);
    }

    const btnSave = document.getElementById('btnSaveMotorDirections');
    if (btnSave) {
        btnSave.addEventListener('click', saveMotorDirections);
    }

    for (let i = 1; i <= MOTOR_COUNT; i++) {
        const btn = document.getElementById(`btnRevMotor${i}`);
        if (btn) {
            btn.addEventListener('click', () => toggleMotorDirection(i - 1));
        }
    }

    const slider = document.getElementById('throttleSlider');
    const badgeVal = document.getElementById('throttleValBadge');
    if (slider) {
        slider.addEventListener('input', async (e) => {
            const val = parseInt(e.target.value, 10);
            motorState.currentThrottle = val;
            if (badgeVal) badgeVal.textContent = val;

            // If motors are currently active, live-update their speed in real-time
            if (motorState.isSpinning) {
                const port = await resolveSelectedPort();
                if (port && port.writable) {
                    const writer = port.writable.getWriter();
                    try {
                        await setMotorOutputs(writer, [val, val, val, val]);
                    } catch (err) {
                        // ignore live slider transmission glitches
                    } finally {
                        writer.releaseLock();
                    }
                }
            }
        });
    }

    const btnResetThrottle = document.getElementById('btnApplyDefaultThrottle');
    if (btnResetThrottle) {
        btnResetThrottle.addEventListener('click', async () => {
            motorState.currentThrottle = DEFAULT_SPIN_THROTTLE;
            if (slider) slider.value = DEFAULT_SPIN_THROTTLE;
            if (badgeVal) badgeVal.textContent = DEFAULT_SPIN_THROTTLE;

            if (motorState.isSpinning) {
                const port = await resolveSelectedPort();
                if (port && port.writable) {
                    const writer = port.writable.getWriter();
                    try {
                        await setMotorOutputs(writer, [DEFAULT_SPIN_THROTTLE, DEFAULT_SPIN_THROTTLE, DEFAULT_SPIN_THROTTLE, DEFAULT_SPIN_THROTTLE]);
                    } finally {
                        writer.releaseLock();
                    }
                }
            }
            log(`Швидкість скинуто до дефолтної: ${DEFAULT_SPIN_THROTTLE}µs.`);
        });
    }

    updateMotorUi();
}
