import { initSerialEvents } from './core/serial.js';
import { log } from './ui/log.js';
import { resetAllStepStatuses, setStepStatus } from './ui/status.js';
import { closeModal, showPopup } from './ui/modal.js';
import { flashBetaflightPreset, skipToEsc } from './betaflight/preset.js';
import { backupBetaflightConfig } from './betaflight/backup.js';
import { readAllEscSettings } from './blheli/eeprom.js';
import { backupAllEscs, triggerRestoreFileSelect, handleRestoreFileChange } from './blheli/backup.js';
import { applyEscPreset } from './blheli/preset.js';
import { diagnosticOrchestrator } from './core/diag_orchestrator.js';
import { updateFcInfoPanel, resetFcInfoPanel, mapFcDiagnosticsToPanel, UNKNOWN, ComparisonStatus } from './ui/fc_panel.js';
import { presetComparator } from './betaflight/comparison_coordinator.js';

// Expose closeModal globally for HTML onclick if needed
window.closeModal = closeModal;

// DOM Elements
const btnFlashFC = document.getElementById('btnFlashFC');
const btnBackup = document.getElementById('btnBackup');
const btnSkipToEsc = document.getElementById('btnSkipToEsc');
const btnReadESC = document.getElementById('btnReadESC');
const btnBackupESC = document.getElementById('btnBackupESC');
const btnRestoreESC = document.getElementById('btnRestoreESC');
const fileRestoreESC = document.getElementById('fileRestoreESC');
const btnConfigureESC = document.getElementById('btnConfigureESC');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const btnRunDiagnostics = document.getElementById('btnRunDiagnostics');
const boardTargetBadge = document.getElementById('boardTargetBadge');

// Handler: Run manual or automated diagnostics
async function handleRunDiagnostics() {
    if (btnRunDiagnostics) btnRunDiagnostics.disabled = true;
    // Clear previous FC identity/comparison so stale data is never shown as current
    resetFcInfoPanel();
    try {
        const script = document.getElementById('presetInput')?.value || '';
        const summary = await diagnosticOrchestrator.runFullDiagnostics({
            log,
            expectedFc: {
                presetText: script
            },
            expectedEsc: {
                expectedCount: 4,
                firmwareVersion: '32.9'
            }
        });

        if (summary.fc?.boardName && boardTargetBadge) {
            boardTargetBadge.textContent = `Target: ${summary.fc.boardName}`;
        }

        // Update FC Info Panel strictly from diagnostic fields (no fabricated fallbacks)
        updateFcInfoPanel(mapFcDiagnosticsToPanel(summary.fc));
        const presetNameMatch = script.match(/#\s*name:\s*([^\r\n]+)/i);
        updateFcInfoPanel({ presetName: presetNameMatch ? presetNameMatch[1].trim() : UNKNOWN });

        if (summary.overallStatus === 'COMPATIBLE') {
            log('✅ Усі компоненти успішно ідентифіковано та перевірено на сумісність.');
        } else if (summary.overallStatus === 'WARNING') {
            log('⚠️ Діагностику завершено з попередженнями. Перегляньте журнал вище.');
        } else {
            log('❌ Виявлено проблеми сумісності або збій звʼязку.');
        }

        // If FC is detected and compatible/warning, run preset comparison
        if (summary.fc && (summary.fc.boardName || summary.fc.target)) {
            await presetComparator.runComparison({
                presetScript: script,
                log,
                fcTelemetry: summary.fc
            });
        }
    } catch (err) {
        log(`[Помилка діагностики]: ${err.message}`);
        resetFcInfoPanel();
    } finally {
        if (btnRunDiagnostics) btnRunDiagnostics.disabled = false;
    }
}

// Initialize Serial Port Management & FC Panel
initSerialEvents(log, () => {
    resetAllStepStatuses();
    resetFcInfoPanel();
    presetComparator.invalidate('SERIAL_DISCONNECT');
});
resetFcInfoPanel();

// Preset Input Change Detection: invalidate comparison and update preset name
const presetInput = document.getElementById('presetInput');
if (presetInput) {
    presetInput.addEventListener('input', () => {
        presetComparator.invalidate('PRESET_TEXT_EDIT');
        const script = presetInput.value.trim();
        const presetNameMatch = script.match(/#\s*(?:preset\s+)?name:\s*([^\r\n#]+)/i);
        updateFcInfoPanel({
            presetName: presetNameMatch ? presetNameMatch[1].trim() : (script ? 'Custom Preset' : '—'),
            comparisonStatus: ComparisonStatus.NOT_CHECKED,
            totalParams: 0,
            matchCount: 0,
            diffCount: 0,
            unverifiedCount: 0
        });
    });
}

// Bind Diagnostic Trigger
if (btnRunDiagnostics) btnRunDiagnostics.addEventListener('click', handleRunDiagnostics);

// Bind Step 1 (Flight Controller) Event Listeners
if (btnFlashFC) btnFlashFC.addEventListener('click', flashBetaflightPreset);
if (btnSkipToEsc) btnSkipToEsc.addEventListener('click', skipToEsc);
if (btnBackup) btnBackup.addEventListener('click', backupBetaflightConfig);

// Bind Step 2 (BLHeli_32 ESC) Event Listeners
if (btnReadESC) btnReadESC.addEventListener('click', readAllEscSettings);
if (btnBackupESC) btnBackupESC.addEventListener('click', backupAllEscs);
if (btnRestoreESC) btnRestoreESC.addEventListener('click', triggerRestoreFileSelect);
if (fileRestoreESC) fileRestoreESC.addEventListener('change', handleRestoreFileChange);
if (btnConfigureESC) btnConfigureESC.addEventListener('click', applyEscPreset);

// Bind Modal Close Listener
if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeModal);
