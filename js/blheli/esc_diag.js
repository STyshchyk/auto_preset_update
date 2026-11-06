/**
 * Electronic Speed Controller (ESC) Diagnostic Module
 * Connects non-destructively through Betaflight MSP 4-Way Passthrough,
 * dynamically discovers responding ESC channels, queries MCU bootloader signatures,
 * performs cross-ESC uniformity evaluation, and reports structured diagnostics.
 */

import { delay } from '../utils/bytes.js';
import { state } from '../core/state.js';
import { resolveSelectedPort, closeSerialSession } from '../core/serial.js';
import {
    CMD_INTERFACE_EXIT,
    CMD_DEVICE_READ,
    send4WayCmd,
    init4WayInterface,
    connectEscDevice,
    disconnectEscDevice
} from './protocol.js';
import { errorManager, Category, Severity } from '../core/error_manager.js';
import { CompatibilityChecker, CompatibilityStatus } from '../core/compat_checker.js';

export const ESC_DIAG_SCOPE = 'ESC_DIAGNOSTICS';
export const DEFAULT_MAX_ESC_PROBE = 4; // Default quadcopter, configurable up to 8

/**
 * Known ARM ESC MCU Signatures (ARM Cortex-M 4-Way protocol responses)
 */
export const KNOWN_ESC_SIGNATURES = Object.freeze({
    '0x3402': { mcu: 'STM32G071', arch: 'Cortex-M0+ (ARMv6-M)', family: 'BLHeli_32' },
    '0x3401': { mcu: 'STM32F051', arch: 'Cortex-M0 (ARMv6-M)', family: 'BLHeli_32' },
    '0x3403': { mcu: 'AT32F421', arch: 'Cortex-M4 (ARMv7E-M)', family: 'BLHeli_32' },
    '0x3404': { mcu: 'GD32E230', arch: 'Cortex-M23 (ARMv8-M)', family: 'BLHeli_32' }
});

/**
 * Maps chip signature hex string to MCU hardware details.
 * @param {string} sigHex (e.g. '0x3402')
 * @returns {Object}
 */
export function identifyEscHardware(sigHex) {
    if (!sigHex) return { mcu: 'UNKNOWN', arch: 'UNKNOWN', family: 'UNKNOWN' };
    const normalized = sigHex.toLowerCase();
    for (const [knownSig, info] of Object.entries(KNOWN_ESC_SIGNATURES)) {
        if (knownSig.toLowerCase() === normalized) {
            return { ...info };
        }
    }
    return { mcu: 'ARM 32-bit (Generic)', arch: 'Cortex-M', family: 'BLHeli_32 / AM32' };
}

/**
 * Runs Electronic Speed Controller (ESC) Diagnostics over MSP 4-Way Passthrough.
 * Probes channels dynamically, extracts bootloader signature and EEPROM metadata if responding.
 *
 * @param {Object} [options]
 * @param {Function} [options.log]
 * @param {number} [options.maxChannels=4]
 * @param {number} [options.expectedCount=4]
 * @param {Object} [options.expected]
 * @param {string} [options.expected.firmwareVersion]
 * @param {string} [options.expected.signature]
 * @returns {Promise<Object>} Structured ESC Diagnostic Result
 */
export async function runEscDiagnostics(options = {}) {
    const logger = options.log || (() => {});
    const maxChannels = options.maxChannels || DEFAULT_MAX_ESC_PROBE;
    const expectedCount = options.expectedCount || DEFAULT_MAX_ESC_PROBE;
    const expected = options.expected || {};

    // Clear previous ESC diagnostic messages in its scope
    errorManager.clear(ESC_DIAG_SCOPE);

    // Concurrency check: verify port is not currently locked by another operation
    if (state.port && (state.port.readable?.locked || state.port.writable?.locked)) {
        const errMsg = 'Serial port is currently in use by another active operation.';
        errorManager.error('ESC_PORT_BUSY', Category.CONNECTION, 'ESC_DIAG', errMsg, null, 'Wait for current task to finish', false, ESC_DIAG_SCOPE);
        return {
            deviceType: 'ESC_SUBSYSTEM',
            connectionStatus: 'PORT_BUSY',
            detectedCount: 0,
            expectedCount,
            channels: [],
            respondingEscs: [],
            nonRespondingChannels: [],
            uniformity: 'UNKNOWN',
            warnings: [],
            errors: [errMsg],
            overallStatus: CompatibilityStatus.INCOMPATIBLE,
            operationAllowed: false
        };
    }

    if (!('serial' in navigator)) {
        const errMsg = 'Web Serial API is not supported by this browser.';
        errorManager.critical('ESC_NO_SERIAL', Category.CONNECTION, 'ESC_DIAG', errMsg, null, 'Use Chrome or Edge', ESC_DIAG_SCOPE);
        return {
            deviceType: 'ESC_SUBSYSTEM',
            connectionStatus: 'NO_SERIAL',
            detectedCount: 0,
            expectedCount,
            channels: [],
            respondingEscs: [],
            nonRespondingChannels: [],
            uniformity: 'UNKNOWN',
            warnings: [],
            errors: [errMsg],
            overallStatus: CompatibilityStatus.INCOMPATIBLE,
            operationAllowed: false
        };
    }

    let reader = null, writer = null;
    const channels = [];
    const respondingEscs = [];
    const nonRespondingChannels = [];

    try {
        state.port = await resolveSelectedPort(logger);
        await state.port.open({ baudRate: 115200 });
        logger('\n[ESC Діагностика] Порт відкрито на 115200. Вхід у режим 4-Way...');

        writer = state.port.writable.getWriter();
        reader = state.port.readable.getReader();

        // 1. Initialize MSP 4-Way Passthrough Mode
        await init4WayInterface(writer, reader);

        // 2. Dynamically probe ESC channels (0 to maxChannels - 1)
        for (let escIndex = 0; escIndex < maxChannels; escIndex++) {
            const motorNumber = escIndex + 1;
            logger(`[ESC Діагностика] Опитування ESC #${motorNumber} (Канал ${escIndex})...`);

            // Attempt bootloader connection
            const conn = await connectEscDevice(writer, reader, escIndex);

            if (!conn.ok) {
                // Channel did not respond
                channels.push({
                    channel: escIndex,
                    motor: motorNumber,
                    responding: false,
                    status: 'NO_RESPONSE',
                    signature: null,
                    hardware: null,
                    firmwareVersion: null,
                    error: conn.msg
                });
                nonRespondingChannels.push(motorNumber);
                logger(`ESC #${motorNumber}: немає відповіді (${conn.msg})`);
                continue;
            }

            // Extract chip signature (e.g. "0x3402")
            const sigMatch = conn.chipInfo.match(/0x[0-9A-F]+/i);
            const signature = sigMatch ? sigMatch[0].toLowerCase() : null;
            const hwInfo = identifyEscHardware(signature);

            // Probe EEPROM header to extract firmware layout / revision if possible
            let firmwareVersion = null;
            let firmwareFamily = hwInfo.family || 'BLHeli_32';

            const readRes = await send4WayCmd(writer, reader, CMD_DEVICE_READ, 0xF800, [0x00], 1500);
            if (readRes.ok && readRes.data.length >= 32) {
                // If readable, try parsing text/version string from EEPROM header area
                const headerAscii = new TextDecoder('ascii', { fatal: false }).decode(readRes.data);
                const verMatch = headerAscii.match(/(?:BLHeli_32|v)\s*([0-9]+\.[0-9]+)/i);
                if (verMatch) {
                    firmwareVersion = verMatch[1];
                } else {
                    firmwareVersion = '32.x (RAW)';
                }
            } else {
                firmwareVersion = 'UNKNOWN';
            }

            const escRecord = {
                channel: escIndex,
                motor: motorNumber,
                responding: true,
                status: 'OK',
                signature: signature || 'UNKNOWN',
                hardware: hwInfo,
                firmwareFamily,
                firmwareVersion,
                chipInfo: conn.chipInfo
            };

            channels.push(escRecord);
            respondingEscs.push(escRecord);
            logger(`ESC #${motorNumber}: знайдено [${hwInfo.mcu}, ${conn.chipInfo}]`);

            // Clean disconnect before advancing
            await disconnectEscDevice(writer, reader, escIndex);
        }

        // 3. Exit 4-Way Mode cleanly
        try {
            await send4WayCmd(writer, reader, CMD_INTERFACE_EXIT, 0, [], 300);
        } catch (_) {}

        await closeSerialSession(state.port, reader, writer, null);
        state.port = null;
        logger('[ESC Діагностика] Опитування завершено. COM-порт звільнено.');

    } catch (err) {
        errorManager.error('ESC_COMM_ERROR', Category.PROTOCOL, 'ESC_DIAG', err.message, err, 'Check LiPo connection and signal wiring', false, ESC_DIAG_SCOPE);
        try {
            if (writer && reader) {
                try { await send4WayCmd(writer, reader, CMD_INTERFACE_EXIT, 0, [], 200); } catch (_) {}
            }
            await closeSerialSession(state.port, reader, writer, null);
        } catch (_) {}
        state.port = null;

        return {
            deviceType: 'ESC_SUBSYSTEM',
            connectionStatus: 'ERROR',
            detectedCount: respondingEscs.length,
            expectedCount,
            channels,
            respondingEscs,
            nonRespondingChannels,
            uniformity: 'UNKNOWN',
            warnings: [],
            errors: [err.message],
            overallStatus: CompatibilityStatus.INCOMPATIBLE,
            operationAllowed: false
        };
    }

    // 4. Uniformity & Compatibility Evaluation
    const compatResult = CompatibilityChecker.checkEscs(
        {
            expectedCount,
            escs: respondingEscs.map(e => ({
                index: e.channel,
                signature: e.signature,
                version: e.firmwareVersion,
                ok: true
            }))
        },
        expected
    );

    // Record warnings and errors into ErrorManager
    compatResult.warnings.forEach(w => errorManager.warning('ESC_UNIFORMITY_WARN', Category.COMPATIBILITY, 'ESC_DIAG', w, null, '', true, ESC_DIAG_SCOPE));
    compatResult.errors.forEach(e => errorManager.error('ESC_DISCOVERY_ERR', Category.HARDWARE, 'ESC_DIAG', e, null, '', false, ESC_DIAG_SCOPE));

    // Determine overall uniformity label
    let uniformity = 'UNIFORM';
    if (compatResult.warnings.some(w => w.includes('not uniform') || w.includes('mixed'))) {
        uniformity = 'NON_UNIFORM';
    } else if (respondingEscs.length === 0) {
        uniformity = 'UNKNOWN';
    }

    return {
        deviceType: 'ESC_SUBSYSTEM',
        connectionStatus: 'SUCCESS',
        detectedCount: respondingEscs.length,
        expectedCount,
        channels,
        respondingEscs,
        nonRespondingChannels,
        uniformity,
        warnings: compatResult.warnings,
        errors: compatResult.errors,
        overallStatus: compatResult.overallStatus,
        operationAllowed: compatResult.operationAllowed && errorManager.isOperationAllowed({ scope: ESC_DIAG_SCOPE })
    };
}
