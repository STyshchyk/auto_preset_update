/**
 * Betaflight Info & Diff Analyzer
 */

/**
 * Extracts FC hardware and firmware details from Betaflight CLI 'version' and 'status' output.
 * @param {string} versionText Output of 'version' CLI command
 * @param {string} statusText Output of 'status' CLI command
 * @returns {object} Parsed details
 */
export function parseFcDetails(versionText = '', statusText = '') {
    const combined = `${versionText}\n${statusText}`;

    // Target / Board Name
    let board = null;
    const boardMatch = combined.match(/(?:board_name|name:)\s+([A-Za-z0-9_-]+)/i) ||
                       combined.match(/Board:\s*([A-Za-z0-9_-]+)/i) ||
                       combined.match(/#\s*target:?\s*([A-Za-z0-9_-]+)/i);
    if (boardMatch) {
        board = boardMatch[1].toUpperCase();
    } else if (combined.toUpperCase().includes('SPEDIXF722')) {
        board = 'SPEDIXF722';
    }

    // Firmware version
    let firmware = null;
    const fwMatch = combined.match(/Betaflight\s*\/\s*.*?\b([0-9]+\.[0-9]+\.[0-9]+)\b/i) ||
                    combined.match(/Betaflight\s+.*?\b([0-9]+\.[0-9]+\.[0-9]+)\b/i);
    if (fwMatch) {
        firmware = fwMatch[1];
    }

    // Build Date & Time
    let buildDate = null;
    const dateMatch = combined.match(/([A-Z][a-z]{2}\s+\d{1,2}\s+\d{4}\s*\/\s*\d{2}:\d{2}:\d{2})/);
    if (dateMatch) {
        buildDate = dateMatch[1].trim();
    }

    // MCU Type
    let mcu = null;
    const mcuMatch = combined.match(/MCU:\s*([A-Za-z0-9_-]+)/i) ||
                     combined.match(/Betaflight\s*\/\s*([A-Za-z0-9_]+)/i);
    if (mcuMatch) {
        mcu = mcuMatch[1].toUpperCase();
    }

    // Unique Device ID (MCU UID or mcu_id)
    let deviceId = null;
    const uidMatch = combined.match(/(?:MCU\s*UID|mcu_id|unique\s*id):\s*(0x[0-9a-fA-F]+|[0-9a-fA-F]{16,32})/i) ||
                     combined.match(/mcu_id\s+([0-9a-fA-F]{16,32})/i);
    if (uidMatch) {
        let rawId = uidMatch[1].trim();
        if (!rawId.toLowerCase().startsWith('0x')) {
            rawId = '0x' + rawId;
        }
        deviceId = rawId.toLowerCase();
    }

    // Battery / Voltage Status from Betaflight 'status' output
    // e.g. "Voltage: 3251 * 0.01V (8S battery - OK)" or "Voltage: 291 * 0.01V (0S battery - NOT PRESENT)"
    let batteryPresent = true; // default optimistic
    let batteryInfo = '—';
    const voltMatch = combined.match(/Voltage:\s*([0-9]+)\s*\*\s*0\.01V\s*\(([^)]+)\)/i);
    if (voltMatch) {
        const rawVolts = (parseInt(voltMatch[1], 10) / 100).toFixed(2);
        const desc = voltMatch[2].trim();
        batteryInfo = `${rawVolts}V (${desc})`;
        if (desc.toUpperCase().includes('NOT PRESENT') || desc.toUpperCase().includes('0S') || parseFloat(rawVolts) < 5.0) {
            batteryPresent = false;
        }
    }

    return {
        board: board || 'НЕВІДОМО',
        firmware: firmware || '—',
        buildDate: buildDate || '—',
        mcu: mcu || '—',
        deviceId: deviceId || '—',
        batteryPresent,
        batteryInfo
    };
}

/**
 * Extracts configuration variables (e.g. 'set param = value') into a Map.
 * Ignores comments, batch, save, defaults, etc.
 * @param {string} text Configuration or preset script text
 * @returns {Map<string, string>} Map of variable_name -> value
 */
export function extractConfigVariables(text = '') {
    const vars = new Map();
    const lines = text.split(/\r?\n/);

    for (let rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;

        // Match: set variable_name = value
        const setMatch = line.match(/^set\s+([a-zA-Z0-9_]+)\s*=\s*(.*)$/i);
        if (setMatch) {
            const key = setMatch[1].trim().toLowerCase();
            const val = setMatch[2].trim().toLowerCase();
            vars.set(key, val);
        }
    }

    return vars;
}

/**
 * Calculates mismatch percentage between preset and current FC diff.
 * Rules:
 * - Only checks variables defined in the preset.
 * - If a variable is in the preset but missing on FC => mismatch.
 * - If a variable has a different value on FC => mismatch.
 * @param {string} presetText The preset text
 * @param {string} fcDiffText The output of 'diff' from the FC
 * @returns {object} Mismatch statistics
 */
export function calculateMismatch(presetText = '', fcDiffText = '') {
    const presetVars = extractConfigVariables(presetText);
    const fcVars = extractConfigVariables(fcDiffText);

    const totalPresetVars = presetVars.size;
    if (totalPresetVars === 0) {
        return {
            mismatchPercent: 0,
            mismatchCount: 0,
            totalPresetVars: 0,
            mismatchedKeys: []
        };
    }

    let mismatchCount = 0;
    const mismatchedKeys = [];

    for (const [key, presetVal] of presetVars.entries()) {
        if (!fcVars.has(key)) {
            mismatchCount++;
            mismatchedKeys.push({ key, reason: 'missing_on_fc', expected: presetVal, actual: null });
        } else {
            const actualVal = fcVars.get(key);
            if (actualVal !== presetVal) {
                mismatchCount++;
                mismatchedKeys.push({ key, reason: 'value_diff', expected: presetVal, actual: actualVal });
            }
        }
    }

    const mismatchPercent = Math.round((mismatchCount / totalPresetVars) * 100);

    return {
        mismatchPercent,
        mismatchCount,
        totalPresetVars,
        mismatchedKeys
    };
}

/**
 * Evaluates the 3-state firmware recognition for the Flight Controller:
 * 1. 'ALREADY_FLASHED': matches target flashed preset with 0 mismatches.
 * 2. 'CLEAN': matches clean baseline preset (ignoring hardware-specific acc_calibration).
 * 3. 'NEW_HARDWARE': does not match either target or clean baseline.
 *
 * @param {string} fcDiffText The diff output from the FC
 * @param {string} targetPresetText The desired flashed preset
 * @param {string} cleanPresetText The expected clean baseline preset
 * @returns {object} { state: 'ALREADY_FLASHED' | 'CLEAN' | 'NEW_HARDWARE', targetMismatch, cleanMismatch }
 */
export function detectFcState(fcDiffText = '', targetPresetText = '', cleanPresetText = '') {
    const targetMismatch = calculateMismatch(targetPresetText, fcDiffText);

    // Filter out acc_calibration or dynamic hardware offsets when checking clean preset if needed
    const cleanVars = extractConfigVariables(cleanPresetText);
    const fcVars = extractConfigVariables(fcDiffText);

    let cleanMismatchCount = 0;
    const cleanMismatchedKeys = [];
    let cleanComparedVars = 0;

    for (const [key, cleanVal] of cleanVars.entries()) {
        // Skip hardware-specific calibration values from strict mismatch check
        if (key === 'acc_calibration' || key === 'acc_trim_pitch' || key === 'acc_trim_roll') {
            continue;
        }
        cleanComparedVars++;
        if (!fcVars.has(key)) {
            cleanMismatchCount++;
            cleanMismatchedKeys.push({ key, reason: 'missing_on_fc', expected: cleanVal, actual: null });
        } else {
            const actualVal = fcVars.get(key);
            if (actualVal !== cleanVal) {
                cleanMismatchCount++;
                cleanMismatchedKeys.push({ key, reason: 'value_diff', expected: cleanVal, actual: actualVal });
            }
        }
    }

    const cleanMismatchPercent = cleanComparedVars > 0 
        ? Math.round((cleanMismatchCount / cleanComparedVars) * 100) 
        : 0;

    const cleanMismatch = {
        mismatchPercent: cleanMismatchPercent,
        mismatchCount: cleanMismatchCount,
        totalPresetVars: cleanComparedVars,
        mismatchedKeys: cleanMismatchedKeys
    };

    let state = 'NEW_HARDWARE';

    if (targetMismatch.mismatchCount === 0 && targetMismatch.totalPresetVars > 0) {
        state = 'ALREADY_FLASHED';
    } else if (cleanMismatchCount === 0) {
        state = 'CLEAN';
    } else {
        state = 'NEW_HARDWARE';
    }

    return {
        state,
        targetMismatch,
        cleanMismatch
    };
}

