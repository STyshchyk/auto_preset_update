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

export function resetAllStepStatuses() {
    setStepStatus(1, 'awaiting');
    setStepStatus(2, 'awaiting');
    for (let i = 0; i < 4; i++) {
        setEscBadge(i, 'pending', 'Очікування');
    }
}

export function setAllEscButtons(disabled) {
    document.getElementById('btnReadESC').disabled = disabled;
    document.getElementById('btnBackupESC').disabled = disabled;
    document.getElementById('btnRestoreESC').disabled = disabled;
    document.getElementById('btnConfigureESC').disabled = disabled;
}
