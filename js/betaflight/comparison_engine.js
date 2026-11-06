/**
 * Preset Comparison Engine (Phase 12B)
 * Performs strict semantic comparison between expected preset configuration and current FC configuration.
 * Read-only: Never writes configuration, never flashes firmware, never executes save or defaults.
 */

import { normalizeValue } from './preset_validator.js';
import { ComparisonStatus } from '../ui/fc_panel.js';
import { errorManager, Category, Severity } from '../core/error_manager.js';

export const COMPARISON_SCOPE = 'PRESET_COMPARISON';

export const ParameterResult = Object.freeze({
    MATCH: 'MATCH',
    DIFFERENT: 'DIFFERENT',
    UNVERIFIED: 'UNVERIFIED',
    UNSUPPORTED: 'UNSUPPORTED'
});

/**
 * Normalizes values for comparison (case-insensitive for keywords ON/OFF/NONE/AUTO,
 * strips outer quotes, trims whitespace, standardizes array delimiters).
 * @param {string} val
 * @returns {string}
 */
export function normalizeSemanticValue(val) {
    if (val === null || val === undefined) return '';
    let clean = String(val).trim();

    // Strip wrapping double or single quotes if present (e.g. "T-System 13" -> T-System 13)
    if ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith("'") && clean.endsWith("'"))) {
        clean = clean.substring(1, clean.length - 1).trim();
    }

    const upper = clean.toUpperCase();
    if (upper === 'ON' || upper === 'OFF' || upper === 'NONE' || upper === 'AUTO') {
        return upper;
    }

    // Normalize comma/whitespace-separated numbers or arrays (e.g. "14, -15, 22, 1" -> "14,-15,22,1")
    if (clean.includes(',')) {
        return clean.split(',').map(s => s.trim()).join(',');
    }

    return clean;
}

/**
 * Parses a preset script into structured semantic directives.
 * Categorizes supported and unsupported commands explicitly.
 *
 * @param {string} scriptText
 * @returns {Object} Structured preset definition
 */
export function parsePresetDirectives(scriptText) {
    const lines = (scriptText || '').split(/\r?\n/);

    const nameMatch = (scriptText || '').match(/#\s*(?:preset\s+)?name:\s*([^\r\n#]+)/i);
    const presetName = nameMatch ? nameMatch[1].trim() : null;

    const targetMatch = (scriptText || '').match(/(?:board_name|#\s*target:?)\s+([A-Za-z0-9_-]+)/i);
    const targetBoard = targetMatch ? targetMatch[1].toUpperCase() : null;

    // Supported directives
    const setParameters = new Map(); // key: "scope.param" -> { section, param, rawValue, normalizedValue, lineNum }
    const featuresEnabled = new Set();
    const featuresDisabled = new Set();
    const beeperRules = new Map();   // flag -> '+' | '-'
    const resources = new Map();     // "FUNCTION INDEX" -> PIN
    const auxChannels = new Map();   // index -> raw string

    // Unsupported or uncompared directives (kept for explicit reporting)
    const unsupportedDirectives = [];
    const ignoredDirectives = [];

    let currentSection = 'master'; // 'master' | 'profile_0'..'profile_3' | 'rateprofile_0'..'rateprofile_3'

    for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        const line = rawLine.trim();
        const lineNum = i + 1;

        if (!line || line.startsWith('#')) continue;

        // Harmless script control directives ignored by comparison
        if (/^(defaults|batch\s+start|batch\s+end|save|exit)/i.test(line)) {
            ignoredDirectives.push({ line, lineNum, reason: 'Control statement' });
            continue;
        }

        // Section switches
        const profMatch = line.match(/^profile\s+([0-3])/i);
        if (profMatch) {
            currentSection = `profile_${profMatch[1]}`;
            continue;
        }

        const rateMatch = line.match(/^rateprofile\s+([0-3])/i);
        if (rateMatch) {
            currentSection = `rateprofile_${rateMatch[1]}`;
            continue;
        }

        // Board metadata statements in script
        if (/^(board_name|manufacturer_id|mcu_id|signature)/i.test(line)) {
            ignoredDirectives.push({ line, lineNum, reason: 'Board identification header' });
            continue;
        }

        // 'set param = value'
        const setMatch = line.match(/^set\s+([A-Za-z0-9_-]+)\s*=\s*(.+)$/i);
        if (setMatch) {
            const param = setMatch[1].toLowerCase();
            const rawVal = setMatch[2].trim();
            const key = `${currentSection}.${param}`;
            setParameters.set(key, {
                section: currentSection,
                param,
                rawValue: rawVal,
                normalizedValue: normalizeSemanticValue(rawVal),
                lineNum
            });
            continue;
        }

        // 'feature [+-]NAME'
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

        // 'beeper [+-]NAME'
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

        // Any directive that is not set, feature, beeper, resource, aux, or section switch
        // (e.g. vtxtable, servo, adjrange, color, display_name, custom motor mixers)
        unsupportedDirectives.push({
            line,
            lineNum,
            command: line.split(/\s+/)[0],
            reason: 'Directive type not supported by comparator'
        });
    }

    return {
        presetName,
        targetBoard,
        setParameters,
        featuresEnabled,
        featuresDisabled,
        beeperRules,
        resources,
        auxChannels,
        unsupportedDirectives,
        ignoredDirectives
    };
}

/**
 * Compares parsed preset directives against parsed FC dump output.
 * Pure in-memory semantic comparison logic.
 *
 * @param {Object} preset Directives parsed via parsePresetDirectives
 * @param {Object} fc Parsed FC dump via parseDiffOutput
 * @param {Object} [meta] Metadata for context { fcBoard, fcVersion, fcTarget }
 * @returns {Object} Structured comparison evaluation
 */
export function compareConfigurations(preset, fc, meta = {}) {
    const details = []; // array of { parameter, section, fcValue, presetValue, result, reason }
    let matchCount = 0;
    let diffCount = 0;
    let unverifiedCount = 0;
    let unsupportedCount = 0;

    // 1. Compare 'set' parameters
    for (const [key, exp] of preset.setParameters.entries()) {
        const fcRaw = fc.setParameters.get(key);

        if (fcRaw === undefined) {
            // Parameter was missing in dump all
            unverifiedCount++;
            details.push({
                parameter: key,
                section: exp.section,
                fcValue: 'UNKNOWN',
                presetValue: exp.rawValue,
                result: ParameterResult.UNVERIFIED,
                reason: 'Parameter not present in FC configuration dump'
            });
            continue;
        }

        const fcNorm = normalizeSemanticValue(fcRaw);
        const expNorm = exp.normalizedValue;

        if (fcNorm === expNorm) {
            matchCount++;
            details.push({
                parameter: key,
                section: exp.section,
                fcValue: fcRaw,
                presetValue: exp.rawValue,
                result: ParameterResult.MATCH
            });
        } else {
            diffCount++;
            details.push({
                parameter: key,
                section: exp.section,
                fcValue: fcRaw,
                presetValue: exp.rawValue,
                result: ParameterResult.DIFFERENT
            });
        }
    }

    // 2. Compare 'feature' directives
    for (const feat of preset.featuresEnabled) {
        const isPresent = fc.activeFeatures.has(feat);
        if (isPresent) {
            matchCount++;
            details.push({
                parameter: `feature ${feat}`,
                section: 'master',
                fcValue: 'ENABLED',
                presetValue: 'ENABLED',
                result: ParameterResult.MATCH
            });
        } else {
            diffCount++;
            details.push({
                parameter: `feature ${feat}`,
                section: 'master',
                fcValue: 'DISABLED',
                presetValue: 'ENABLED',
                result: ParameterResult.DIFFERENT
            });
        }
    }

    for (const feat of preset.featuresDisabled) {
        const isPresent = fc.activeFeatures.has(feat);
        if (!isPresent) {
            matchCount++;
            details.push({
                parameter: `feature ${feat}`,
                section: 'master',
                fcValue: 'DISABLED',
                presetValue: 'DISABLED',
                result: ParameterResult.MATCH
            });
        } else {
            diffCount++;
            details.push({
                parameter: `feature ${feat}`,
                section: 'master',
                fcValue: 'ENABLED',
                presetValue: 'DISABLED',
                result: ParameterResult.DIFFERENT
            });
        }
    }

    // 3. Compare 'resource' directives
    for (const [resKey, expPin] of preset.resources.entries()) {
        const curPin = fc.activeResources.get(resKey);
        if (curPin === undefined) {
            unverifiedCount++;
            details.push({
                parameter: `resource ${resKey}`,
                section: 'master',
                fcValue: 'UNKNOWN',
                presetValue: expPin,
                result: ParameterResult.UNVERIFIED,
                reason: 'Resource definition absent from FC dump'
            });
            continue;
        }

        if (curPin.toUpperCase() === expPin.toUpperCase()) {
            matchCount++;
            details.push({
                parameter: `resource ${resKey}`,
                section: 'master',
                fcValue: curPin,
                presetValue: expPin,
                result: ParameterResult.MATCH
            });
        } else {
            diffCount++;
            details.push({
                parameter: `resource ${resKey}`,
                section: 'master',
                fcValue: curPin,
                presetValue: expPin,
                result: ParameterResult.DIFFERENT
            });
        }
    }

    // 4. Compare 'beeper' rules
    for (const [flag, expSign] of preset.beeperRules.entries()) {
        const curSign = fc.beeperState?.get(flag);
        if (curSign === undefined) {
            unverifiedCount++;
            details.push({
                parameter: `beeper ${flag}`,
                section: 'master',
                fcValue: 'UNKNOWN',
                presetValue: `${expSign}${flag}`,
                result: ParameterResult.UNVERIFIED,
                reason: 'Beeper flag absent from FC dump'
            });
            continue;
        }

        if (curSign === expSign) {
            matchCount++;
            details.push({
                parameter: `beeper ${flag}`,
                section: 'master',
                fcValue: `${curSign}${flag}`,
                presetValue: `${expSign}${flag}`,
                result: ParameterResult.MATCH
            });
        } else {
            diffCount++;
            details.push({
                parameter: `beeper ${flag}`,
                section: 'master',
                fcValue: `${curSign}${flag}`,
                presetValue: `${expSign}${flag}`,
                result: ParameterResult.DIFFERENT
            });
        }
    }

    // 5. Compare 'aux' configurations
    for (const [idx, expArgs] of preset.auxChannels.entries()) {
        const curArgs = fc.auxConfig?.get(idx);
        if (curArgs === undefined) {
            unverifiedCount++;
            details.push({
                parameter: `aux ${idx}`,
                section: 'master',
                fcValue: 'UNKNOWN',
                presetValue: expArgs,
                result: ParameterResult.UNVERIFIED,
                reason: 'Aux channel entry absent from FC dump'
            });
            continue;
        }

        const normCur = curArgs.split(/\s+/).join(' ');
        const normExp = expArgs.split(/\s+/).join(' ');
        if (normCur === normExp) {
            matchCount++;
            details.push({
                parameter: `aux ${idx}`,
                section: 'master',
                fcValue: curArgs,
                presetValue: expArgs,
                result: ParameterResult.MATCH
            });
        } else {
            diffCount++;
            details.push({
                parameter: `aux ${idx}`,
                section: 'master',
                fcValue: curArgs,
                presetValue: expArgs,
                result: ParameterResult.DIFFERENT
            });
        }
    }

    // 6. Explicitly report unsupported directives
    for (const unsupp of preset.unsupportedDirectives) {
        unsupportedCount++;
        unverifiedCount++;
        details.push({
            parameter: unsupp.line,
            section: 'unsupported',
            fcValue: 'UNSUPPORTED',
            presetValue: unsupp.line,
            result: ParameterResult.UNSUPPORTED,
            reason: unsupp.reason
        });
    }

    const totalComparableParams = matchCount + diffCount + unverifiedCount;

    // Determine Overall Status
    let status = ComparisonStatus.NOT_CHECKED;
    if (diffCount > 0) {
        status = ComparisonStatus.MISMATCH;
    } else if (unverifiedCount > 0) {
        status = ComparisonStatus.UNVERIFIED;
    } else if (totalComparableParams > 0) {
        status = ComparisonStatus.MATCH;
    }

    return {
        status,
        presetName: preset.presetName || meta.presetName || 'Unnamed Preset',
        targetBoard: preset.targetBoard || meta.fcTarget || null,
        totalParams: totalComparableParams,
        matchCount,
        diffCount,
        unverifiedCount,
        unsupportedCount,
        details,
        differences: details.filter(d => d.result === ParameterResult.DIFFERENT),
        unverified: details.filter(d => d.result === ParameterResult.UNVERIFIED || d.result === ParameterResult.UNSUPPORTED),
        matches: details.filter(d => d.result === ParameterResult.MATCH)
    };
}

/**
 * Formats and outputs the comparison result into the log stream following Section 6 specifications.
 * @param {Object} result Comparison result from compareConfigurations
 * @param {Object} meta Metadata { fcBoard, fcVersion }
 * @param {Function} logger
 */
export function logComparisonReport(result, meta = {}, logger = console.log) {
    logger('\n========================================');
    logger(`PRESET COMPARISON: ${result.status}`);
    logger('========================================');
    if (meta.fcBoard) logger(`Flight Controller: ${meta.fcBoard}`);
    if (meta.fcVersion) logger(`Firmware:          ${meta.fcVersion}`);
    logger(`Selected preset:   ${result.presetName}`);
    logger('----------------------------------------');

    if (result.status === ComparisonStatus.MATCH) {
        logger('Current FC configuration matches the selected preset.');
        logger('No differences detected.');
    } else {
        // Output differences
        for (const diff of result.differences) {
            logger(`\n${diff.parameter}:`);
            logger(`  FC:      ${diff.fcValue}`);
            logger(`  PRESET:  ${diff.presetValue}`);
            logger(`  RESULT:  DIFFERENT`);
        }

        // Output unverified or unsupported
        for (const unver of result.unverified) {
            logger(`\n${unver.parameter}:`);
            logger(`  FC:      ${unver.fcValue}`);
            logger(`  PRESET:  ${unver.presetValue}`);
            logger(`  RESULT:  ${unver.result} (${unver.reason || 'unverified'})`);
        }
    }

    logger('\nSUMMARY:');
    logger(`  MATCH:        ${result.matchCount}`);
    logger(`  DIFFERENT:    ${result.diffCount}`);
    logger(`  UNVERIFIED:   ${result.unverifiedCount}`);
    if (result.unsupportedCount > 0) {
        logger(`  UNSUPPORTED:  ${result.unsupportedCount}`);
    }
    logger('========================================\n');
}
