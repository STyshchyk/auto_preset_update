export function setStepStatus(stepNumber, state) {
    const el = document.getElementById(`stepStatus${stepNumber}`);
    if (!el) return;

    const labels = {
        awaiting: '⏳ Очікування',
        working: '🔄 Виконується...',
        success: '✅ Успішно',
        fail: '❌ Помилка'
    };

    el.className = `step-status ${state}`;
    el.textContent = labels[state] || labels.awaiting;
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

export function resetAllStepStatuses() {
    setStepStatus(1, 'awaiting');
    setStepStatus(2, 'awaiting');
    for (let i = 0; i < 4; i++) {
        setEscBadge(i, 'pending', 'Очікування');
    }
    resetEscFlowPipeline();
    setEscSessionConnected(false);
}

export function setAllEscButtons(disabled) {
    const ids = ['btnReadESC', 'btnBackupESC', 'btnRestoreESC', 'btnConfigureESC'];
    for (const id of ids) {
        const el = document.getElementById(id);
        if (el) el.disabled = disabled;
    }
}

export function setEscSessionConnected(isConnected) {
    const btnConnect = document.getElementById('btnConnectESC');
    const btnDisconnect = document.getElementById('btnDisconnectESC');
    if (btnConnect) btnConnect.disabled = isConnected;
    if (btnDisconnect) btnDisconnect.disabled = !isConnected;
    setAllEscButtons(!isConnected);
}
