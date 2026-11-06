/**
 * UI Renderer for Left Info Panel
 */

/**
 * Updates the left information panel with FC telemetry and mismatch percentage.
 * @param {object} fcDetails Parsed FC telemetry { board, firmware, buildDate, mcu }
 * @param {object} mismatchResult Result from calculateMismatch
 */
export function updateInfoPanel(fcDetails = {}, mismatchResult = null) {
    const elBoard = document.getElementById('infoBoardName');
    const elFw = document.getElementById('infoFirmwareVer');
    const elDate = document.getElementById('infoBuildDate');
    const elMcu = document.getElementById('infoMcuType');

    if (elBoard) elBoard.textContent = fcDetails.board || '—';
    if (elFw) elFw.textContent = fcDetails.firmware || '—';
    if (elDate) elDate.textContent = fcDetails.buildDate || '—';
    if (elMcu) elMcu.textContent = fcDetails.mcu || '—';

    const elBadge = document.getElementById('infoMismatchBadge');
    const elNote = document.getElementById('infoMismatchNote');

    if (!elBadge || !elNote) return;

    if (!mismatchResult || mismatchResult.totalPresetVars === 0) {
        elBadge.textContent = '0%';
        elBadge.className = 'mismatch-badge match-exact';
        elNote.textContent = 'Змінних у пресеті не виявлено';
        return;
    }

    const pct = mismatchResult.mismatchPercent;
    elBadge.textContent = `${pct}%`;

    elBadge.className = 'mismatch-badge';
    if (pct === 0) {
        elBadge.classList.add('match-exact');
    } else if (pct <= 30) {
        elBadge.classList.add('match-low-diff');
    } else {
        elBadge.classList.add('match-high-diff');
    }

    elNote.textContent = `${mismatchResult.mismatchCount} із ${mismatchResult.totalPresetVars} змінних відрізняються`;
}

/**
 * Resets the left info panel to its initial awaiting state.
 */
export function resetInfoPanel() {
    const elBoard = document.getElementById('infoBoardName');
    const elFw = document.getElementById('infoFirmwareVer');
    const elDate = document.getElementById('infoBuildDate');
    const elMcu = document.getElementById('infoMcuType');
    const elBadge = document.getElementById('infoMismatchBadge');
    const elNote = document.getElementById('infoMismatchNote');

    if (elBoard) elBoard.textContent = '—';
    if (elFw) elFw.textContent = '—';
    if (elDate) elDate.textContent = '—';
    if (elMcu) elMcu.textContent = '—';

    if (elBadge) {
        elBadge.textContent = '—';
        elBadge.className = 'mismatch-badge';
    }
    if (elNote) {
        elNote.textContent = 'Очікує запуску (натисніть «Залити»)...';
    }
}
