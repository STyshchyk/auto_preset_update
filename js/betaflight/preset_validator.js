/**
 * Betaflight Preset Validator Module
 * Reads effective FC configuration using read-only CLI commands,
 * parses expected configuration from preset script, and performs strict parameter-level
 * comparison without modifying FC settings or applying presets.
 */

import { delay } from '../utils/bytes.js';
import { state } from '../core/state.js';
import { resolveSelectedPort, closeSerialSession } from '../core/serial.js';
import { readCliResponse, parseBoardName } from './cli.js';
import { errorManager, Category, Severity } from '../core/error_manager.js';

export const PRESET_VALIDATION_SCOPE = 'PRESET_VALIDATION';

/**
 * Normalizes parameter values for comparison (case-insensitive for keywords ON/OFF, trimmed).
 * @param {string} val
 * @returns {string}
 */
export function normalizeValue(val) {
    if (val === null || val === undefined) return '';
    const clean = String(val).trim();
    const upper = clean.toUpperCase();
    if (upper === 'ON' || upper === 'OFF' || upper === 'NONE' || upper === 'AUTO') {
        return upper;
    }
    return clean;
}

/**
 * Parses expected settings, features, beepers, resources, aux, and profile blocks from preset CLI script.
 * @param {string} scriptText
 * @returns {Object} Structured preset configuration
 */
export function parsePresetConfig(scriptText) {
    const lines = (scriptText || '').split(/\r?\n/);
    const targetBoard = (scriptText || '').match(/(?:board_name|#\s*target:?)\s+([A-Za-z0-9_-]+)/i)?.[1]?.toUpperCase() || null;

    const setParameters = new Map(); // key: "scope.param" (e.g. "master.vtx_band", "profile_0.i_pitch")
    const featuresEnabled = new Set();
    const featuresDisabled = new Set();
    const beeperRules = new Map();   // beeper element -> '+' or '-'
    const resources = new Map();     // "TYPE INDEX" -> "PIN"
    const auxChannels = new Map();   // index -> full args string
    const vtxTables = [];

    let currentSection = 'master'; // 'master' | 'profile_0'..'profile_3' | 'rateprofile_0'..'rateprofile_3'

    for (let rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;

        // Skip batch and defaults commands
        if (/^(defaults|batch\s+start|batch\s+end|save|exit)/i.test(line)) continue;

        // Profile switcher
        const profMatch = line.match(/^profile\s+([0-3])/i);
        if (profMatch) {
            currentSection = `profile_${profMatch[1]}`;
            continue;
        }

        // Rateprofile switcher
        const rateMatch = line.match(/^rateprofile\s+([0-3])/i);
        if (rateMatch) {
            currentSection = `rateprofile_${rateMatch[1]}`;
            continue;
        }

        // 'set parameter = value'
        const setMatch = line.match(/^set\s+([A-Za-z0-9_-]+)\s*=\s*(.+)$/i);
        if (setMatch) {
            const param = setMatch[1].toLowerCase();
            const val = setMatch[2].trim();
            const key = `${currentSection}.${param}`;
            setParameters.set(key, { section: currentSection, param, expectedValue: val });
            continue;
        }

        // 'feature FEATURE_NAME' or 'feature -FEATURE_NAME'
        const featMatch = line.match(/^feature\s+([+-]?)([A-Za-z0-9_-]+)/i);
        if (featMatch) {
            const sign = featMatch[1];
            const featName = featMatch[2].toUpperCase();
            if (sign === '-') {
                featuresDisabled.add(featName);
                featuresEnabled.delete(featName);
            } else {
                featuresEnabled.add(featName);
                featuresDisabled.delete(featName);
            }
            continue;
        }

        // 'beeper [-]FLAG'
        const beepMatch = line.match(/^beeper\s+([+-]?)([A-Za-z0-9_-]+)/i);
        if (beepMatch) {
            const sign = beepMatch[1] || '+';
            const flag = beepMatch[2].toUpperCase();
            beeperRules.set(flag, sign);
            continue;
        }

        // 'resource FUNCTION INDEX PIN'
        const resMatch = line.match(/^resource\s+([A-Za-z0-9_-]+)\s+([0-9]+)\s+([A-Za-z0-9_-]+)/i);
        if (resMatch) {
            const resKey = `${resMatch[1].toUpperCase()} ${resMatch[2]}`;
            resources.set(resKey, resMatch[3].toUpperCase());
            continue;
        }

        // 'aux INDEX FUNCTION CHANNEL START END ...'
        const auxMatch = line.match(/^aux\s+([0-9]+)\s+(.+)$/i);
        if (auxMatch) {
            auxChannels.set(auxMatch[1], auxMatch[2].trim());
            continue;
        }
    }

    return {
        targetBoard,
        setParameters,
        featuresEnabled,
        featuresDisabled,
        beeperRules,
        resources,
        auxChannels
    };
}

/**
 * Parses parameters from CLI 'diff all' or 'dump all' output.
 * @param {string} diffText
 * @returns {Object} Effective current FC state
 */
export function parseDiffOutput(diffText) {
    const lines = (diffText || '').split(/\r?\n/);
    const setParameters = new Map();
    const activeFeatures = new Set();
    const activeResources = new Map();
    const beeperState = new Map();
    const auxConfig = new Map();

    let currentSection = 'master';

    for (let rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;

        if (/^profile\s+([0-3])/i.test(line)) {
            currentSection = `profile_${line.match(/^profile\s+([0-3])/i)[1]}`;
            continue;
        }
        if (/^rateprofile\s+([0-3])/i.test(line)) {
            currentSection = `rateprofile_${line.match(/^rateprofile\s+([0-3])/i)[1]}`;
            continue;
        }

        const setMatch = line.match(/^set\s+([A-Za-z0-9_-]+)\s*=\s*(.+)$/i);
        if (setMatch) {
            const param = setMatch[1].toLowerCase();
            const val = setMatch[2].trim();
            setParameters.set(`${currentSection}.${param}`, val);
            continue;
        }

        const featMatch = line.match(/^feature\s+([+-]?)([A-Za-z0-9_-]+)/i);
        if (featMatch) {
            const sign = featMatch[1];
            const name = featMatch[2].toUpperCase();
            if (sign === '-') activeFeatures.delete(name);
            else activeFeatures.add(name);
            continue;
        }

        const resMatch = line.match(/^resource\s+([A-Za-z0-9_-]+)\s+([0-9]+)\s+([A-Za-z0-9_-]+)/i);
        if (resMatch) {
            activeResources.set(`${resMatch[1].toUpperCase()} ${resMatch[2]}`, resMatch[3].toUpperCase());
            continue;
        }

        const beepMatch = line.match(/^beeper\s+([+-]?)([A-Za-z0-9_-]+)/i);
        if (beepMatch) {
            beeperState.set(beepMatch[2].toUpperCase(), beepMatch[1] || '+');
            continue;
        }

        const auxMatch = line.match(/^aux\s+([0-9]+)\s+(.+)$/i);
        if (auxMatch) {
            auxConfig.set(auxMatch[1], auxMatch[2].trim());
            continue;
        }
    }

    return {
        setParameters,
        activeFeatures,
        activeResources,
        beeperState,
        auxConfig
    };
}

/**
 * Validates whether the connected FC already has the configuration required by the preset script.
 * Pure read-only operation: does not write, flash, or modify FC state.
 *
 * @param {Object} options
 * @param {string} options.presetScript
 * @param {Function} [options.log]
 * @returns {Promise<Object>} Structured Preset Validation Result
 */
export async function validateFcPreset(options = {}) {
    const logger = options.log || (() => {});
    const script = options.presetScript || '';

    errorManager.clear(PRESET_VALIDATION_SCOPE);

    if (!script.trim()) {
        const msg = 'Preset script is empty. Nothing to validate.';
        errorManager.warning('PRESET_EMPTY', Category.VALIDATION, 'PRESET_VALIDATOR', msg, null, 'Provide preset script', true, PRESET_VALIDATION_SCOPE);
        return {
            status: 'ERROR',
            summary: msg,
            matches: false,
            differences: [],
            unverified: []
        };
    }

    if (!('serial' in navigator)) {
        const msg = 'Web Serial API is not supported by this browser.';
        errorManager.critical('NO_SERIAL', Category.CONNECTION, 'PRESET_VALIDATOR', msg, null, 'Use Chrome or Edge', PRESET_VALIDATION_SCOPE);
        return {
            status: 'ERROR',
            summary: msg,
            matches: false,
            differences: [],
            unverified: []
        };
    }

    logger('\n========================================');
    logger('🔍 ВАЛІДАЦІЯ ПРЕСЕТУ ПОЛЬОТНОГО КОНТРОЛЕРА');
    logger('========================================');
    logger('[Валідація] Аналіз очікуваної конфігурації з пресету...');

    const expectedConfig = parsePresetConfig(script);
    logger(`[Валідація] Знайдено ${expectedConfig.setParameters.size} параметрів 'set', ${expectedConfig.featuresEnabled.size + expectedConfig.featuresDisabled.size} правил 'feature', ${expectedConfig.resources.size} призначень ресурсів.`);

    let reader = null, writer = null, textEncoder = null;
    let dumpAllOutput = '';
    let statusOutput = '';

    try {
        state.port = await resolveSelectedPort(logger);
        await state.port.open({ baudRate: 115200 });
        logger('[Валідація] COM-порт відкрито на 115200.');

        textEncoder = new TextEncoderStream();
        textEncoder.readable.pipeTo(state.port.writable);
        writer = textEncoder.writable.getWriter();

        const textDecoder = new TextDecoderStream();
        state.port.readable.pipeTo(textDecoder.writable);
        reader = textDecoder.readable.getReader();

        // 1. Enter CLI
        await writer.write('#\r\n');
        await delay(300);
        let echo = await readCliResponse(reader, 700);
        if (!echo.includes('#')) {
            await writer.write('\r\n#\r\n');
            await delay(300);
            echo += await readCliResponse(reader, 700);
        }

        // 2. Query status to verify target
        await writer.write('status\r\n');
        await delay(150);
        statusOutput = await readCliResponse(reader, 1200);

        const actualBoard = parseBoardName(echo + '\n' + statusOutput);
        if (expectedConfig.targetBoard && actualBoard) {
            const expNorm = expectedConfig.targetBoard.replace(/[^A-Z0-9]/g, '');
            const actNorm = actualBoard.replace(/[^A-Z0-9]/g, '');
            if (expNorm !== actNorm && !expNorm.includes(actNorm) && !actNorm.includes(expNorm)) {
                try { await writer.write('exit\r\n'); } catch (_) {}
                await closeSerialSession(state.port, reader, writer, textEncoder);
                state.port = null;

                const mismatchMsg = `Target mismatch: preset expects [${expectedConfig.targetBoard}], connected board is [${actualBoard}].`;
                logger(`❌ [ПОМИЛКА СУМІСНОСТІ]: ${mismatchMsg}`);
                errorManager.error('PRESET_TARGET_MISMATCH', Category.COMPATIBILITY, 'PRESET_VALIDATOR', mismatchMsg, null, 'Do not flash', false, PRESET_VALIDATION_SCOPE);
                return {
                    status: 'ERROR',
                    summary: mismatchMsg,
                    matches: false,
                    differences: [{ parameter: 'target_board', currentValue: actualBoard, expectedValue: expectedConfig.targetBoard }],
                    unverified: []
                };
            }
        }

        // 3. Read effective configuration via read-only 'dump all'
        // 'dump all' includes both default and customized settings across all profiles
        logger('[Валідація] Зчитування повної ефективної конфігурації FC (dump all)...');
        await writer.write('dump all\r\n');
        
        // Dump all can take several seconds; accumulate until prompt '#' is returned
        const startDump = Date.now();
        while (Date.now() - startDump < 14000) {
            const chunk = await readCliResponse(reader, 1500, false);
            if (chunk) {
                dumpAllOutput += chunk;
                if (dumpAllOutput.includes('\n# ') || dumpAllOutput.trim().endsWith('#')) {
                    break;
                }
            } else {
                break;
            }
        }

        logger(`[Валідація] Отримано конфігурацію FC (${dumpAllOutput.length} байт).`);

        // 4. Clean CLI exit
        try {
            await writer.write('exit\r\n');
            await delay(200);
        } catch (_) {}

        await closeSerialSession(state.port, reader, writer, textEncoder);
        state.port = null;
        logger('[Валідація] COM-порт закрито.');

    } catch (err) {
        logger(`❌ [Помилка зчитування CLI]: ${err.message}`);
        try { await closeSerialSession(state.port, reader, writer, textEncoder); } catch (_) {}
        state.port = null;

        errorManager.error('CLI_READ_ERR', Category.PROTOCOL, 'PRESET_VALIDATOR', err.message, err, 'Check connection', false, PRESET_VALIDATION_SCOPE);
        return {
            status: 'ERROR',
            summary: `Failed to read FC configuration: ${err.message}`,
            matches: false,
            differences: [],
            unverified: []
        };
    }

    // 5. Parse FC Configuration
    const fcConfig = parseDiffOutput(dumpAllOutput);
    const differences = [];
    const unverified = [];
    let matchCount = 0;

    // Compare 'set' parameters
    for (const [key, expectedObj] of expectedConfig.setParameters.entries()) {
        const { param, expectedValue } = expectedObj;
        const currentVal = fcConfig.setParameters.get(key);

        if (currentVal === undefined) {
            // Parameter was not found in dump all
            unverified.push({
                parameter: key,
                expectedValue,
                reason: 'Parameter not present in FC dump'
            });
            continue;
        }

        const normExpected = normalizeValue(expectedValue);
        const normCurrent = normalizeValue(currentVal);

        if (normExpected === normCurrent) {
            matchCount++;
        } else {
            differences.push({
                parameter: key,
                currentValue: currentVal,
                expectedValue
            });
        }
    }

    // Compare 'feature' flags
    for (const feat of expectedConfig.featuresEnabled) {
        const isPresent = fcConfig.activeFeatures.has(feat);
        if (isPresent) {
            matchCount++;
        } else {
            differences.push({
                parameter: `feature ${feat}`,
                currentValue: 'DISABLED',
                expectedValue: 'ENABLED'
            });
        }
    }

    for (const feat of expectedConfig.featuresDisabled) {
        const isPresent = fcConfig.activeFeatures.has(feat);
        if (!isPresent) {
            matchCount++;
        } else {
            differences.push({
                parameter: `feature ${feat}`,
                currentValue: 'ENABLED',
                expectedValue: 'DISABLED'
            });
        }
    }

    // Compare 'resource' allocations
    for (const [resKey, expPin] of expectedConfig.resources.entries()) {
        const curPin = fcConfig.activeResources.get(resKey);
        if (curPin === undefined) {
            unverified.push({
                parameter: `resource ${resKey}`,
                expectedValue: expPin,
                reason: 'Resource line not found in dump'
            });
            continue;
        }

        if (curPin.toUpperCase() === expPin.toUpperCase()) {
            matchCount++;
        } else {
            differences.push({
                parameter: `resource ${resKey}`,
                currentValue: curPin,
                expectedValue: expPin
            });
        }
    }

    // 6. Generate Verification Report
    logger('\n========================================');
    logger('📊 ЗВІТ ВАЛІДАЦІЇ ПРЕСЕТУ');
    logger('========================================');
    logger(`Параметрів перевірено: ${matchCount + differences.length}`);
    logger(`Співпадає: ${matchCount}`);

    if (unverified.length > 0) {
        logger(`Не верифіковано (відсутні в дампах): ${unverified.length}`);
        unverified.forEach(u => {
            logger(`  ℹ️ UNKNOWN / UNVERIFIED: ${u.parameter} (очікувалось: ${u.expectedValue}) [${u.reason}]`);
        });
    }

    if (differences.length === 0) {
        logger('\n✅ PASS — Configuration already matches the selected preset.');
        logger('Конфігурація польотного контролера вже повністю відповідає обраному пресету.');
        logger('Повторний запис пресету не потрібен.');
        logger('========================================\n');

        return {
            status: 'PASS',
            summary: 'PASS — Configuration already matches the selected preset',
            matches: true,
            matchCount,
            differences: [],
            unverified
        };
    } else {
        logger(`\n❌ ERROR — Configuration mismatch (${differences.length} differing parameter(s)):`);
        differences.forEach(d => {
            logger(`  • ${d.parameter}: поточне значення [${d.currentValue}] != очікуване [${d.expectedValue}]`);
        });
        logger('========================================\n');

        errorManager.warning(
            'PRESET_DIFF_DETECTED',
            Category.CONFIGURATION,
            'PRESET_VALIDATOR',
            `FC configuration differs from preset on ${differences.length} parameter(s).`,
            differences,
            'Flash preset to apply changes',
            true,
            PRESET_VALIDATION_SCOPE
        );

        return {
            status: 'ERROR',
            summary: 'ERROR — Configuration mismatch',
            matches: false,
            matchCount,
            differences,
            unverified
        };
    }
}
