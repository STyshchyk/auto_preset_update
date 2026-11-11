export function setStepStatus(stepNumber, state, customText = null) {
    const el = document.getElementById(`stepStatus${stepNumber}`) || document.getElementById(`statusPillStep${stepNumber}`);
    if (!el) return;

    const labels = {
        awaiting: '⏳ Очікування',
        idle: '⏳ Очікування',
        working: '🔄 Виконується...',
        success: '✅ Успішно',
        ok: '✅ Успішно',
        fail: '❌ Помилка'
    };

    el.className = `status-pill ${state} step-status`;
    el.textContent = customText || labels[state] || labels.awaiting;
}

/**
 * Updates the FC State Badge next to Step 1 status.
 * States supported:
 * - 'ALREADY_FLASHED': ⚡ Вже прошитий (shown in all modes)
 * - 'NEW_HARDWARE': ⚠️ Нове обладнання (shown in all modes)
 * - 'CLEAN': 🧼 Чистий контролер (shown ONLY in Expert Mode; hidden in Simplified Mode)
 * - null: hidden
 *
 * @param {'ALREADY_FLASHED'|'NEW_HARDWARE'|'CLEAN'|null} state
 * @param {string} [customLabel]
 */
export function setFcStateBadge(state, customLabel = null) {
    const badge = document.getElementById('fcStateBadge') || document.getElementById('badgeAlreadyFlashed');
    if (!badge) return;

    badge.classList.remove('state-already-flashed', 'state-new-hardware', 'state-clean');

    const isSimplified = document.body.classList.contains('simplified-mode');

    if (state === 'ALREADY_FLASHED') {
        badge.textContent = customLabel || '⚡ Вже прошитий';
        badge.classList.add('state-already-flashed');
        badge.title = 'Цей польотний контролер уже на 100% відповідає зразку пресету';
        badge.style.display = 'inline-flex';
    } else if (state === 'NEW_HARDWARE') {
        badge.textContent = customLabel || '⚠️ Нове обладнання';
        badge.classList.add('state-new-hardware');
        badge.title = 'Виявлено невідому конфігурацію або відмінний пресет на польотному контролері';
        badge.style.display = 'inline-flex';
    } else if (state === 'CLEAN') {
        // Чистий бейдж відображається ТІЛЬКИ в режимі експерта
        if (!isSimplified) {
            badge.textContent = customLabel || '🧼 Чистий контролер';
            badge.classList.add('state-clean');
            badge.title = 'Польотний контролер містить чистий заводський дамп';
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
    } else {
        badge.style.display = 'none';
    }
}

/**
 * Shows or hides the separate history badge indicating that this MCU
 * was previously recorded in the unexpected / modified hardware registry.
 *
 * @param {boolean} visible
 * @param {string} [customLabel]
 */
export function setFcHistoryBadge(visible, customLabel = '⚠️ Був модифікований') {
    const badge = document.getElementById('fcHistoryBadge');
    if (!badge) return;
    if (visible) {
        badge.textContent = customLabel;
        badge.style.display = 'inline-flex';
    } else {
        badge.style.display = 'none';
    }
}

/**
 * Backward compatibility wrapper for setAlreadyFlashedBadge.
 * @param {boolean} visible
 * @param {string} [customLabel]
 */
export function setAlreadyFlashedBadge(visible, customLabel = '⚡ Вже прошитий') {
    setFcStateBadge(visible ? 'ALREADY_FLASHED' : null, customLabel);
}

/**
 * Shows or hides the "⚡ Вже прошитий" badge next to Step 2 status (ESC).
 * @param {boolean} visible
 * @param {string} [customLabel]
 */
export function setEscAlreadyFlashedBadge(visible, customLabel = '⚡ Вже прошитий') {
    const badge = document.getElementById('badgeEscAlreadyFlashed');
    if (!badge) return;
    if (visible) {
        badge.textContent = customLabel;
        badge.style.display = 'inline-flex';
    } else {
        badge.style.display = 'none';
    }
}

export function setEscBadge(escIndex, state, text) {
    const badge = document.getElementById(`badgeEsc${escIndex}`);
    if (badge) {
        badge.className = `esc-badge ${state}`;
        badge.textContent = `ESC #${escIndex + 1}: ${text}`;
    }
}

/**
 * Updates an individual stage in the ESC Flow Pipeline.
 * @param {'connect'|'flash'|'verify'|'status'|'close'} stage
 * @param {'awaiting'|'working'|'success'|'fail'} state
 * @param {string} [customLabel]
 */
export function setEscFlowStep(stage, state, customLabel = null) {
    const map = {
        connect: 'escFlowConnect',
        flash:   'escFlowFlash',
        verify:  'escFlowVerify',
        status:  'escFlowStatus',
        close:   'escFlowClose'
    };
    const id = map[stage];
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;

    el.className = `esc-flow-step ${state}`;
    const dot = el.querySelector('.step-dot');
    const label = el.querySelector('.step-label');

    const defaultIcons = {
        connect: '🔗',
        flash:   '⚡',
        verify:  '🔍',
        status:  '🎯',
        close:   '🔒'
    };

    if (dot) {
        if (state === 'working') dot.textContent = '⚙️';
        else if (state === 'success') dot.textContent = '✅';
        else if (state === 'fail') dot.textContent = '❌';
        else dot.textContent = defaultIcons[stage] || '⏳';
    }

    if (customLabel && label) {
        label.textContent = customLabel;
    }
}

/**
 * Resets all 5 stages in the ESC flow pipeline.
 */
export function resetEscFlowPipeline() {
    const stages = [
        { key: 'connect', label: '1. Підключення' },
        { key: 'flash',   label: '2. Заливка' },
        { key: 'verify',  label: '3. Перевірка' },
        { key: 'status',  label: '4. Статус OK' },
        { key: 'close',   label: '5. Закриття' }
    ];
    stages.forEach(s => setEscFlowStep(s.key, 'awaiting', s.label));
}

/**
 * Updates an individual sub-step badge in Step 1 (Betaflight Flash Progress).
 * @param {'flash'|'readDiff'|'verify'} stepKey
 * @param {'pending'|'working'|'ok'|'fail'} state
 * @param {string} [customLabel]
 */
export function setFcSubStep(stepKey, state, customLabel = null) {
    const map = {
        flash:    'subStepFlash',
        readDiff: 'subStepReadDiff',
        verify:   'subStepVerify'
    };
    const id = map[stepKey];
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;

    el.className = `fc-sub-step ${state}`;
    const icon = el.querySelector('.sub-step-icon');
    const label = el.querySelector('.sub-step-label');

    const defaultLabels = {
        flash:    '1. Прошивка команд',
        readDiff: '2. Фінальне читання',
        verify:   '3. Перевірка пресету'
    };

    if (icon) {
        if (state === 'working') icon.textContent = '⚙️';
        else if (state === 'ok') icon.textContent = '✅';
        else if (state === 'fail') icon.textContent = '❌';
        else icon.textContent = '⏳';
    }

    if (label) {
        label.textContent = customLabel || defaultLabels[stepKey] || '';
    }
}

/**
 * Resets the 3 sub-steps in Step 1 to pending.
 */
export function resetFcSubSteps() {
    setFcSubStep('flash', 'pending');
    setFcSubStep('readDiff', 'pending');
    setFcSubStep('verify', 'pending');
}

export function resetAllStepStatuses() {
    setStepStatus(1, 'awaiting');
    setStepStatus(2, 'awaiting');
    setStepStatus(3, 'awaiting');
    setAlreadyFlashedBadge(false);
    setFcHistoryBadge(false);
    setEscAlreadyFlashedBadge(false);
    resetFcSubSteps();
    for (let i = 0; i < 4; i++) {
        setEscBadge(i, 'pending', 'Очікування');
    }
    resetEscFlowPipeline();
    setEscSessionConnected(false);
}

import { state } from '../core/state.js';

export function setAllEscButtons(disabled) {
    const ids = ['btnReadESC', 'btnBackupESC', 'btnRestoreESC', 'btnExportEscDb', 'btnRestoreEscDb'];
    for (const id of ids) {
        const el = document.getElementById(id);
        if (el) el.disabled = disabled;
    }
    const btnConfigure = document.getElementById('btnConfigureESC');
    if (btnConfigure) {
        if (disabled) {
            btnConfigure.disabled = true;
        } else if (state.escChecksPassed === false) {
            btnConfigure.disabled = true;
            btnConfigure.title = 'Прошивка заблокована: невідповідність моделі або MCU ESC!';
        } else {
            btnConfigure.disabled = false;
            btnConfigure.title = '';
        }
    }
}

export function setEscSessionConnected(isConnected) {
    const btnConnect = document.getElementById('btnConnectESC');
    const btnDisconnect = document.getElementById('btnDisconnectESC');
    if (btnConnect) btnConnect.disabled = isConnected;
    if (btnDisconnect) btnDisconnect.disabled = !isConnected;
    setAllEscButtons(!isConnected);
}
