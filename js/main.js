/**
 * Drone Setup Station - Main Application Entry Point
 * Orchestrates event bindings and subsystem initialization.
 */

import { initSerialEvents } from './core/serial.js';
import { log } from './ui/log.js';
import { resetAllStepStatuses } from './ui/status.js';
import { resetInfoPanel } from './ui/infoPanel.js';
import { closeModal } from './ui/modal.js';
import { flashBetaflightPreset, skipToEsc } from './betaflight/preset.js';
import { backupBetaflightConfig } from './betaflight/backup.js';
import { readAllEscSettings } from './blheli/eeprom.js';
import { backupAllEscs, triggerRestoreFileSelect, handleRestoreFileChange } from './blheli/backup.js';
import { applyEscPreset } from './blheli/preset.js';

// Expose closeModal globally for modal HTML onclick handler
window.closeModal = closeModal;

// DOM Elements
const btnFlashFC       = document.getElementById('btnFlashFC');
const btnBackup        = document.getElementById('btnBackup');
const btnSkipToEsc     = document.getElementById('btnSkipToEsc');
const btnReadESC       = document.getElementById('btnReadESC');
const btnBackupESC     = document.getElementById('btnBackupESC');
const btnRestoreESC    = document.getElementById('btnRestoreESC');
const fileRestoreESC   = document.getElementById('fileRestoreESC');
const btnConfigureESC  = document.getElementById('btnConfigureESC');
const modalCloseBtn    = document.getElementById('modalCloseBtn');

// --- PORT MANAGEMENT ---
initSerialEvents(log, () => {
    resetAllStepStatuses();
    resetInfoPanel();
});

// --- STEP 1: BETAFLIGHT CLI PRESET FLASHER ---
if (btnFlashFC) btnFlashFC.addEventListener('click', flashBetaflightPreset);
if (btnSkipToEsc) btnSkipToEsc.addEventListener('click', skipToEsc);
if (btnBackup) btnBackup.addEventListener('click', backupBetaflightConfig);

// --- STEP 2: BLHELI_32 ESC OPERATIONS ---
if (btnReadESC) btnReadESC.addEventListener('click', readAllEscSettings);
if (btnBackupESC) btnBackupESC.addEventListener('click', backupAllEscs);
if (btnRestoreESC) btnRestoreESC.addEventListener('click', triggerRestoreFileSelect);
if (fileRestoreESC) fileRestoreESC.addEventListener('change', handleRestoreFileChange);
if (btnConfigureESC) btnConfigureESC.addEventListener('click', applyEscPreset);

// --- MODAL CONTROLS ---
if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeModal);
