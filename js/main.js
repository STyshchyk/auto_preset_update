/**
 * Drone Setup Station - Main Application Entry Point
 * Orchestrates event bindings and subsystem initialization.
 */

import { initSerialEvents } from './core/serial.js';
import { log, exportLogsToJson, clearTerminalAndDbLogs } from './ui/log.js';
import { resetAllStepStatuses } from './ui/status.js';
import { resetInfoPanel } from './ui/infoPanel.js';
import { closeModal, ensureInstructionsAcknowledged } from './ui/modal.js';
import { flashBetaflightPreset, skipToEsc, comparePresetWithFc } from './betaflight/preset.js';
import { backupBetaflightConfig } from './betaflight/backup.js';
import { readAllEscSettings } from './blheli/eeprom.js';
import { backupAllEscs, triggerRestoreFileSelect, handleRestoreFileChange } from './blheli/backup.js';
import { applyEscPreset } from './blheli/preset.js';
import { connectEscSession, disconnectEscSession } from './blheli/session.js';
import { runFullDroneSequence } from './core/pipeline.js';
import { renderStatsWidget, resetDailyStats } from './utils/stats.js';

// Expose closeModal globally for modal HTML onclick handler
window.closeModal = closeModal;

// DOM Elements
const btnFlashFC          = document.getElementById('btnFlashFC');
const btnComparePreset    = document.getElementById('btnComparePreset');
const btnBackup           = document.getElementById('btnBackup');
const btnSkipToEsc        = document.getElementById('btnSkipToEsc');
const btnConnectESC       = document.getElementById('btnConnectESC');
const btnDisconnectESC    = document.getElementById('btnDisconnectESC');
const btnReadESC          = document.getElementById('btnReadESC');
const btnBackupESC        = document.getElementById('btnBackupESC');
const btnRestoreESC       = document.getElementById('btnRestoreESC');
const fileRestoreESC      = document.getElementById('fileRestoreESC');
const btnConfigureESC     = document.getElementById('btnConfigureESC');
const modalCloseBtn       = document.getElementById('modalCloseBtn');
const btnToggleMode       = document.getElementById('btnToggleMode');
const btnRunSimplified    = document.getElementById('btnRunSimplified');
const btnResetDailyStats  = document.getElementById('btnResetDailyStats');
const btnExportLogsJson   = document.getElementById('btnExportLogsJson');
const btnClearLogs        = document.getElementById('btnClearLogs');

// --- SIMPLIFIED MODE TOGGLE ---
const MODE_STORAGE_KEY = 'drone_station_mode';

function applyMode(isSimplified) {
    if (isSimplified) {
        document.body.classList.add('simplified-mode');
        if (btnToggleMode) {
            btnToggleMode.textContent = '⚡ Спрощений режим: УВІМК';
            btnToggleMode.classList.add('active');
        }
    } else {
        document.body.classList.remove('simplified-mode');
        if (btnToggleMode) {
            btnToggleMode.textContent = '⚙️ Експертний режим: УВІМК';
            btnToggleMode.classList.remove('active');
        }
    }
    localStorage.setItem(MODE_STORAGE_KEY, isSimplified ? 'simplified' : 'expert');
}

// Default to simplified mode unless explicitly set to expert
const savedMode = localStorage.getItem(MODE_STORAGE_KEY);
const initialIsSimplified = savedMode !== 'expert';
applyMode(initialIsSimplified);

if (btnToggleMode) {
    btnToggleMode.addEventListener('click', () => {
        const currentlySimplified = document.body.classList.contains('simplified-mode');
        applyMode(!currentlySimplified);
    });
}

// --- STATS INITIALIZATION ---
renderStatsWidget();
if (btnResetDailyStats) {
    btnResetDailyStats.addEventListener('click', () => {
        if (window.confirm('Скинути статистику за сьогодні?')) {
            resetDailyStats();
        }
    });
}

// --- MASTER ACTION BUTTON FOR SIMPLIFIED MODE ---
if (btnRunSimplified) {
    btnRunSimplified.addEventListener('click', () => {
        ensureInstructionsAcknowledged(runFullDroneSequence);
    });
}

// --- PORT MANAGEMENT ---
initSerialEvents(log, () => {
    resetAllStepStatuses();
    resetInfoPanel();
});

// --- STEP 1: BETAFLIGHT CLI PRESET FLASHER ---
if (btnFlashFC) {
    btnFlashFC.addEventListener('click', () => {
        ensureInstructionsAcknowledged(flashBetaflightPreset);
    });
}
if (btnComparePreset) {
    btnComparePreset.addEventListener('click', () => {
        ensureInstructionsAcknowledged(comparePresetWithFc);
    });
}
if (btnSkipToEsc) btnSkipToEsc.addEventListener('click', skipToEsc);
if (btnBackup) btnBackup.addEventListener('click', backupBetaflightConfig);

// --- STEP 2: BLHELI_32 ESC OPERATIONS ---
if (btnConnectESC) btnConnectESC.addEventListener('click', connectEscSession);
if (btnDisconnectESC) btnDisconnectESC.addEventListener('click', disconnectEscSession);
if (btnReadESC) btnReadESC.addEventListener('click', readAllEscSettings);
if (btnBackupESC) btnBackupESC.addEventListener('click', backupAllEscs);
if (btnRestoreESC) btnRestoreESC.addEventListener('click', triggerRestoreFileSelect);
if (fileRestoreESC) fileRestoreESC.addEventListener('change', handleRestoreFileChange);
if (btnConfigureESC) btnConfigureESC.addEventListener('click', applyEscPreset);

// --- MODAL CONTROLS ---
if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeModal);

// --- EXPERT LOGGING CONTROLS ---
if (btnExportLogsJson) {
    btnExportLogsJson.addEventListener('click', exportLogsToJson);
}
if (btnClearLogs) {
    btnClearLogs.addEventListener('click', () => {
        if (window.confirm('Очистити термінал та видалити всі збережені логи операцій?')) {
            clearTerminalAndDbLogs();
        }
    });
}
