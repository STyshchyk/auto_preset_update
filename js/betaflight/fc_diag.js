/**
 * Flight Controller (FC) Diagnostic Module
 * Connects non-destructively to Betaflight CLI, extracts detailed hardware telemetry,
 * and performs compatibility evaluation using CompatibilityChecker and ErrorManager.
 */

import { delay } from '../utils/bytes.js';
import { state } from '../core/state.js';
import { resolveSelectedPort, closeSerialSession } from '../core/serial.js';
import { readCliResponse, parseBoardName } from './cli.js';
import { errorManager, Category, Severity } from '../core/error_manager.js';
import { CompatibilityChecker, CompatibilityStatus } from '../core/compat_checker.js';
import { resolveMcuProfile } from '../core/firmware_validator.js';

export const FC_DIAG_SCOPE = 'FC_DIAGNOSTICS';

/**
 * Parses detailed FC telemetry from CLI version, status, and dump headers.
 * @param {string} text
 * @returns {Object}
 */
export function parseFcTelemetry(text) {
    if (!text || typeof text !== 'string') {
        return {
            firmwareName: null,
            firmwareVersion: null,
            buildDate: null,
            target: null,
            boardName: null,
            mcu: null,
            architecture: null,
            mcuId: null,
            craftName: null
        };
    }

    // 1. Firmware Name & Version (e.g. "Betaflight / STM32F7X2 (S7X2) 4.5.1 Dec  2 2024 / 10:06:22")
    let firmwareName = null;
    let firmwareVersion = null;
    let buildDate = null;
    let mcuFamily = null;

    const versionMatch = text.match(/(Betaflight|INAV|Cleanflight)\s*\/\s*([A-Za-z0-9_-]+)\s*(?:\([^)]*\))?\s*([0-9]+\.[0-9]+\.[0-9]+[A-Za-z0-9_-]*)\s*([A-Za-z]{3}\s+[0-9]+\s+[0-9]{4})?/i);
    if (versionMatch) {
        firmwareName = versionMatch[1];
        mcuFamily = versionMatch[2].toUpperCase();
        firmwareVersion = versionMatch[3];
        if (versionMatch[4]) buildDate = versionMatch[4].trim();
    } else {
        const simpleVer = text.match(/(?:version|v|Betaflight\s*\/)\s*([0-9]+\.[0-9]+\.[0-9]+)/i);
        if (simpleVer) firmwareVersion = simpleVer[1];
        if (/Betaflight/i.test(text)) firmwareName = 'Betaflight';
        else if (/INAV/i.test(text)) firmwareName = 'INAV';
    }

    // 2. Target Identifier (from "target: ...", "Target: ...", or status output)
    let target = null;
    const targetMatch = text.match(/target:\s*([A-Za-z0-9_-]+)/i) ||
                        text.match(/Target:\s*([A-Za-z0-9_-]+)/i);
    if (targetMatch) {
        const val = targetMatch[1].toUpperCase();
        if (val !== 'MANUFACTURER_ID') target = val;
    }

    // 3. Board Name (from "board_name ...", "name: ...", "Board: ...")
    const boardName = parseBoardName(text) || target;

    // 4. MCU Model & Architecture
    let mcu = null;
    let architecture = null;

    const mcuMatch = text.match(/MCU:\s*([A-Za-z0-9_-]+)/i) ||
                     text.match(/mcu_type\s+([A-Za-z0-9_-]+)/i);
    if (mcuMatch) {
        mcu = mcuMatch[1].toUpperCase();
    } else if (mcuFamily) {
        mcu = mcuFamily;
    }

    // Resolve architecture from verified MCU profile if available
    const profile = resolveMcuProfile(mcu || boardName);
    if (profile) {
        architecture = `${profile.core} (${profile.arch})`;
    } else if (mcu) {
        if (/F7/i.test(mcu)) architecture = 'Cortex-M7 (ARMv7E-M)';
        else if (/F4/i.test(mcu)) architecture = 'Cortex-M4 (ARMv7E-M)';
        else if (/H7/i.test(mcu)) architecture = 'Cortex-M7 (ARMv7E-M)';
        else if (/G0/i.test(mcu)) architecture = 'Cortex-M0+ (ARMv6-M)';
    }

    // 5. Hardware Identifiers
    let mcuId = null;
    const mcuIdMatch = text.match(/mcu_id\s+([0-9a-f]+)/i) || text.match(/MCU ID:\s*([0-9a-f]+)/i);
    if (mcuIdMatch) mcuId = mcuIdMatch[1];

    let craftName = null;
    const craftMatch = text.match(/(?:craft_name|name:)\s*([^\r\n#]+)/i);
    if (craftMatch && !craftMatch[1].toUpperCase().includes('SPEDIX')) {
        craftName = craftMatch[1].trim();
    }

    return {
        firmwareName,
        firmwareVersion,
        buildDate,
        target,
        boardName,
        mcu,
        architecture,
        mcuId,
        craftName
    };
}

/**
 * Runs Flight Controller Diagnostics over Web Serial.
 * @param {Object} [options]
 * @param {Function} [options.log]
 * @param {Object} [options.expected]
 * @param {string} [options.expected.boardName]
 * @param {string} [options.expected.mcuType]
 * @param {string} [options.expected.firmwareVersion]
 * @param {string} [options.expected.presetText]
 * @returns {Promise<Object>} Structured FC Diagnostic Result
 */
export async function runFcDiagnostics(options = {}) {
    const logger = options.log || (() => {});
    const expected = options.expected || {};

    // Clear previous FC diagnostic messages in its scope
    errorManager.clear(FC_DIAG_SCOPE);

    // Concurrency check: verify port is not currently locked by another operation
    if (state.port && (state.port.readable?.locked || state.port.writable?.locked)) {
        const errMsg = 'Serial port is currently in use by another active operation.';
        errorManager.error('FC_PORT_BUSY', Category.CONNECTION, 'FC_DIAG', errMsg, null, 'Wait for current task to finish', false, FC_DIAG_SCOPE);
        return {
            deviceType: 'FLIGHT_CONTROLLER',
            connected: false,
            firmwareName: null,
            firmwareVersion: null,
            target: null,
            boardName: null,
            mcu: null,
            architecture: null,
            identificationConfidence: 'NONE',
            detectedMetadata: {},
            warnings: [],
            errors: [errMsg],
            overallStatus: CompatibilityStatus.INCOMPATIBLE,
            operationAllowed: false
        };
    }

    if (!('serial' in navigator)) {
        const errMsg = 'Web Serial API is not supported by this browser.';
        errorManager.critical('FC_NO_SERIAL', Category.CONNECTION, 'FC_DIAG', errMsg, null, 'Use Chrome or Edge', FC_DIAG_SCOPE);
        return {
            deviceType: 'FLIGHT_CONTROLLER',
            connected: false,
            firmwareName: null,
            firmwareVersion: null,
            target: null,
            boardName: null,
            mcu: null,
            architecture: null,
            identificationConfidence: 'NONE',
            detectedMetadata: {},
            warnings: [],
            errors: [errMsg],
            overallStatus: CompatibilityStatus.INCOMPATIBLE,
            operationAllowed: false
        };
    }

    let reader = null, writer = null, textEncoder = null;
    let rawOutput = '';

    try {
        state.port = await resolveSelectedPort(logger);
        await state.port.open({ baudRate: 115200 });
        logger('[FC Діагностика] Порт відкрито на 115200.');

        textEncoder = new TextEncoderStream();
        textEncoder.readable.pipeTo(state.port.writable);
        writer = textEncoder.writable.getWriter();

        const textDecoder = new TextDecoderStream();
        state.port.readable.pipeTo(textDecoder.writable);
        reader = textDecoder.readable.getReader();

        // 1. Enter CLI mode
        logger('[FC Діагностика] Вхід у Betaflight CLI (#)...');
        await writer.write('#\r\n');
        await delay(300);
        let echo = await readCliResponse(reader, 700);
        if (!echo.includes('#')) {
            await writer.write('\r\n#\r\n');
            await delay(300);
            echo += await readCliResponse(reader, 700);
        }
        rawOutput += echo + '\n';

        if (!rawOutput.includes('#')) {
            throw new Error('FC did not respond with CLI prompt (#). Device may not be in CLI mode or baud rate mismatched.');
        }

        // 2. Query 'version'
        logger('[FC Діагностика] Запит версії (version)...');
        await writer.write('version\r\n');
        await delay(150);
        const verText = await readCliResponse(reader, 1000);
        rawOutput += verText + '\n';

        // 3. Query 'status'
        logger('[FC Діагностика] Запит статусу плати (status)...');
        await writer.write('status\r\n');
        await delay(150);
        const statusText = await readCliResponse(reader, 1200);
        rawOutput += statusText + '\n';

        // 4. Clean exit from CLI
        try {
            await writer.write('exit\r\n');
            await delay(200);
        } catch (_) {}

        await closeSerialSession(state.port, reader, writer, textEncoder);
        state.port = null;
        logger('[FC Діагностика] Зчитування завершено. COM-порт звільнено.');

    } catch (err) {
        errorManager.error('FC_COMM_ERROR', Category.PROTOCOL, 'FC_DIAG', err.message, err, 'Check USB cable and FC power', false, FC_DIAG_SCOPE);
        try { await closeSerialSession(state.port, reader, writer, textEncoder); } catch (_) {}
        state.port = null;

        return {
            deviceType: 'FLIGHT_CONTROLLER',
            connected: false,
            firmwareName: null,
            firmwareVersion: null,
            target: null,
            boardName: null,
            mcu: null,
            architecture: null,
            identificationConfidence: 'NONE',
            detectedMetadata: {},
            warnings: [],
            errors: [err.message],
            overallStatus: CompatibilityStatus.INCOMPATIBLE,
            operationAllowed: false
        };
    }

    // 5. Parse Telemetry
    const telemetry = parseFcTelemetry(rawOutput);

    // Determine Identification Confidence
    let identificationConfidence = 'HIGH';
    if (!telemetry.boardName && !telemetry.target) {
        identificationConfidence = 'NONE';
        errorManager.warning('FC_ID_NONE', Category.HARDWARE, 'FC_DIAG', 'Could not identify FC target or board name.', null, 'Query CLI manually', true, FC_DIAG_SCOPE);
    } else if (!telemetry.mcu || !telemetry.firmwareVersion) {
        identificationConfidence = 'PARTIAL';
        errorManager.info('FC_ID_PARTIAL', Category.HARDWARE, 'FC_DIAG', 'FC target identified but MCU/version details incomplete.', null, '', FC_DIAG_SCOPE);
    } else {
        errorManager.success('FC_ID_HIGH', Category.HARDWARE, 'FC_DIAG', `FC identified: ${telemetry.boardName || telemetry.target} (${telemetry.firmwareVersion})`);
    }

    // 6. Compatibility Evaluation
    const compatResult = CompatibilityChecker.checkFlightController(
        {
            boardName: telemetry.boardName || telemetry.target,
            mcuType: telemetry.mcu,
            firmwareVersion: telemetry.firmwareVersion,
            craftName: telemetry.craftName
        },
        expected
    );

    // Record compatibility warnings and errors into ErrorManager
    compatResult.warnings.forEach(w => errorManager.warning('FC_COMPAT_WARN', Category.COMPATIBILITY, 'FC_DIAG', w, null, '', true, FC_DIAG_SCOPE));
    compatResult.errors.forEach(e => errorManager.error('FC_COMPAT_ERR', Category.COMPATIBILITY, 'FC_DIAG', e, null, '', false, FC_DIAG_SCOPE));

    return {
        deviceType: 'FLIGHT_CONTROLLER',
        connected: true,
        firmwareName: telemetry.firmwareName,
        firmwareVersion: telemetry.firmwareVersion,
        target: telemetry.target,
        boardName: telemetry.boardName,
        mcu: telemetry.mcu,
        architecture: telemetry.architecture,
        identificationConfidence,
        detectedMetadata: telemetry,
        warnings: compatResult.warnings,
        errors: compatResult.errors,
        overallStatus: compatResult.overallStatus,
        operationAllowed: compatResult.operationAllowed && errorManager.isOperationAllowed({ scope: FC_DIAG_SCOPE })
    };
}
