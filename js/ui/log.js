/**
 * UI Logger & Structured Operation Batching Engine
 * Outputs real-time messages to the DOM console and groups step/operation logs
 * with timestamp, duration, device UID, and detailed stream output into IndexedDB.
 */

import { saveOperationLog, getAllOperationLogs, clearAllOperationLogs } from '../core/db.js';
import { downloadTextFile, timestampStr } from '../utils/bytes.js';

let activeDeviceId = null;
let currentStepSession = null;

/**
 * Updates the active session device UID (e.g. once identified from FC or ESC).
 * @param {string} deviceId
 */
export function setLogDeviceId(deviceId) {
    if (deviceId && deviceId !== '—' && deviceId !== '-') {
        activeDeviceId = deviceId.trim().toLowerCase();
        if (currentStepSession) {
            currentStepSession.deviceId = activeDeviceId;
        }
    }
}

/**
 * Gets the current active device UID.
 * @returns {string|null}
 */
export function getLogDeviceId() {
    return activeDeviceId;
}

/**
 * Basic terminal log function. Preserves backwards compatibility.
 * Streams output to #log and collects details into the active step session.
 * @param {string} msg
 */
export function log(msg) {
    const logDiv = document.getElementById('log');
    if (logDiv) {
        logDiv.textContent += msg + '\n';
        logDiv.scrollTop = logDiv.scrollHeight;
    }

    if (currentStepSession) {
        currentStepSession.lines.push(msg);
    }
}

/**
 * Starts a new grouped step operation.
 * Prints a clean header block with timestamp and device ID.
 * @param {string} stepName - e.g. "FC_FLASH_PRESET" or "ESC_CONFIG"
 * @param {string} [displayName] - User-friendly title for terminal
 * @param {string|null} [deviceId] - Optional explicit device ID
 */
export function startOperationStep(stepName, displayName = null, deviceId = null) {
    // If a previous step wasn't explicitly closed, end it gracefully
    if (currentStepSession) {
        endOperationStep('UNKNOWN', 'Автоматичне завершення перед новим кроком');
    }

    if (deviceId) {
        setLogDeviceId(deviceId);
    }

    const title = displayName || stepName;
    const now = new Date();
    const startTimeIso = now.toISOString();
    const timeDisplay = now.toTimeString().split(' ')[0]; // HH:mm:ss

    currentStepSession = {
        step: stepName,
        title,
        deviceId: activeDeviceId || 'UNKNOWN',
        startTimeIso,
        startTimestamp: performance.now(),
        lines: []
    };

    const devLabel = activeDeviceId ? `Device: ${activeDeviceId}` : 'Device: Pending';
    log(`\n=======================================================`);
    log(`▶ [${timeDisplay}] [${title}] ${devLabel}`);
    log(`=======================================================`);
}

/**
 * Ends the active grouped step operation, calculates duration, prints summary footer,
 * and saves the full record to IndexedDB.
 * @param {'SUCCESS' | 'FAILED' | 'WARNING' | string} status
 * @param {string} summary - Short one-line summary
 * @param {Object} [extraData] - Any extra key/value data (e.g. targetBoard, mismatchPercent)
 * @returns {Promise<number|null>}
 */
export async function endOperationStep(status = 'SUCCESS', summary = '', extraData = {}) {
    if (!currentStepSession) return null;

    const session = currentStepSession;
    currentStepSession = null;

    const durationSeconds = Math.max(0.1, ((performance.now() - session.startTimestamp) / 1000)).toFixed(2);
    const now = new Date();
    const timeDisplay = now.toTimeString().split(' ')[0];

    const icon = status === 'SUCCESS' ? '✔' : '✖';
    log(`-------------------------------------------------------`);
    log(`${icon} [${timeDisplay}] [${session.title} ${status}] Тривалість: ${durationSeconds}s`);
    if (summary) log(`  ${summary}`);
    log(`=======================================================\n`);

    // Filter out artificial header/footer banner lines from the details array
    const cleanLines = session.lines.filter(l => {
        const trimmed = (l || '').trim();
        return trimmed && !trimmed.startsWith('====') && !trimmed.startsWith('----') && !trimmed.startsWith('▶ [');
    });

    const finalDeviceId = (session.deviceId && session.deviceId !== 'UNKNOWN')
        ? session.deviceId
        : (activeDeviceId || 'UNKNOWN');

    const entry = {
        timestamp: session.startTimeIso,
        deviceId: finalDeviceId,
        step: session.step,
        title: session.title,
        status: status.toUpperCase(),
        duration_s: parseFloat(durationSeconds),
        summary: summary || status,
        details: cleanLines,
        ...extraData
    };

    return await saveOperationLog(entry);
}

/**
 * Exports all operation logs stored in IndexedDB as a formatted JSON file.
 * Only available / triggered in Expert Mode.
 */
export async function exportLogsToJson() {
    try {
        const logs = await getAllOperationLogs();

        if (!logs || logs.length === 0) {
            alert('Журнал порожній. Немає збережених операцій для експорту.');
            return;
        }

        const jsonContent = JSON.stringify(logs, null, 2);
        const filename = `drone_station_logs_${timestampStr()}.json`;

        downloadTextFile(filename, jsonContent);
        log(`[Експорт] Успішно експортовано ${logs.length} операцій у JSON-файл ${filename}`);
    } catch (err) {
        console.error('Помилка експорту JSON:', err);
        alert(`Помилка під час формування JSON: ${err.message}`);
    }
}

/**
 * Clears DOM terminal and IndexedDB operations.
 */
export async function clearTerminalAndDbLogs() {
    const logDiv = document.getElementById('log');
    if (logDiv) logDiv.textContent = '';
    await clearAllOperationLogs();
    log('Журнал терміналу та бази даних очищено.');
}
