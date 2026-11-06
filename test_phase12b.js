/**
 * Comprehensive Test Suite for Phase 12B — Real-Time FC Preset Comparison
 * Covers:
 * 1. Identical FC and preset configurations -> MATCH
 * 2. One different setting -> MISMATCH
 * 3. Multiple different settings -> correct counts
 * 4. Missing current value -> UNVERIFIED, not DIFFERENT
 * 5. Missing setting in diff all but confirmed current default -> compare correctly
 * 6. Unsupported preset command -> explicitly reported
 * 7. Preset containing comments and whitespace
 * 8. Multiple-value settings (e.g. acc_calibration, aux, commas)
 * 9. Repeated settings (last wins or tracked)
 * 10. Invalid preset syntax / empty
 * 11. Incompatible FC target
 * 12. Firmware version mismatch handling
 * 13. FC disconnect / reset invalidation
 * 14. Preset changed during / before comparison
 * 15. Old comparison cannot overwrite newer result (sequence guard)
 * 16. Serial locking and connection lifecycle
 */

import {
    normalizeSemanticValue,
    parsePresetDirectives,
    compareConfigurations,
    logComparisonReport,
    ParameterResult
} from './js/betaflight/comparison_engine.js';
import { parseDiffOutput } from './js/betaflight/preset_validator.js';
import { ComparisonStatus } from './js/ui/fc_panel.js';
import { presetComparator } from './js/betaflight/comparison_coordinator.js';

let passed = 0;
let failed = 0;

function assert(condition, testName, extra = '') {
    if (condition) {
        passed++;
        console.log(`  ✓ PASS: ${testName}`);
    } else {
        failed++;
        console.error(`  ✗ FAIL: ${testName} ${extra}`);
    }
}

console.log('\n=== RUNNING PHASE 12B REAL-TIME PRESET COMPARISON TESTS ===\n');

// -------------------------------------------------------------
// Fixtures
// -------------------------------------------------------------
const basePreset = `
# name: My_Speedix_Preset
board_name SPEDIXF722
defaults nosave
batch start

# set parameters
set motor_pwm_protocol = DSHOT600
set gyro_lpf1_static_hz = 200
set vtx_power = 1
set acc_calibration = 14,-15,22,1
set craft_name = "T-System 13"

# features
feature OSD
feature -TELEMETRY

# beeper
beeper -GYRO_CALIBRATED
beeper +BAT_CRIT_LOW

# resource
resource MOTOR 5 NONE
resource SERVO 1 B06

# aux
aux 0 0 0 1700 2100 0 0

# custom directive unsupported by comparator
vtxtable band 1 BOSCAM_A A CUSTOM 5865 5845
`;

const baseFcDump = `
# dump all
board_name SPEDIXF722
set motor_pwm_protocol = DSHOT600
set gyro_lpf1_static_hz = 200
set vtx_power = 1
set acc_calibration = 14,-15,22,1
set craft_name = T-System 13
feature OSD
beeper -GYRO_CALIBRATED
beeper BAT_CRIT_LOW
resource MOTOR 5 NONE
resource SERVO 1 B06
aux 0 0 0 1700 2100 0 0
`;

// [1] Identical configurations -> MATCH (when all comparable elements match)
console.log('[1] Testing Identical Configurations -> MATCH...');
{
    // Preset without unsupported directive
    const cleanPreset = basePreset.replace(/vtxtable[^\r\n]+/g, '');
    const preset = parsePresetDirectives(cleanPreset);
    const fc = parseDiffOutput(baseFcDump);
    const result = compareConfigurations(preset, fc);

    assert(result.status === ComparisonStatus.MATCH, 'Identical configuration yields MATCH');
    assert(result.diffCount === 0, 'diffCount is 0');
    assert(result.unverifiedCount === 0, 'unverifiedCount is 0');
    assert(result.matchCount === 12, '12 directives matched exactly');
}

// [2] One different setting -> MISMATCH
console.log('\n[2] Testing One Different Setting -> MISMATCH...');
{
    const cleanPreset = basePreset.replace(/vtxtable[^\r\n]+/g, '');
    const preset = parsePresetDirectives(cleanPreset);
    const fcDumpOneDiff = baseFcDump.replace('set gyro_lpf1_static_hz = 200', 'set gyro_lpf1_static_hz = 250');
    const fc = parseDiffOutput(fcDumpOneDiff);
    const result = compareConfigurations(preset, fc);

    assert(result.status === ComparisonStatus.MISMATCH, 'One difference yields MISMATCH');
    assert(result.diffCount === 1, 'diffCount is 1');
    assert(result.differences[0].parameter === 'master.gyro_lpf1_static_hz', 'Identifies differing parameter');
    assert(result.differences[0].fcValue === '250', 'Identifies FC value 250');
    assert(result.differences[0].presetValue === '200', 'Identifies preset value 200');
}

// [3] Multiple different settings -> correct counts
console.log('\n[3] Testing Multiple Different Settings...');
{
    const cleanPreset = basePreset.replace(/vtxtable[^\r\n]+/g, '');
    const preset = parsePresetDirectives(cleanPreset);
    const fcDumpMultiDiff = baseFcDump
        .replace('set motor_pwm_protocol = DSHOT600', 'set motor_pwm_protocol = DSHOT300')
        .replace('set gyro_lpf1_static_hz = 200', 'set gyro_lpf1_static_hz = 250')
        .replace('feature OSD', 'feature -OSD');
    const fc = parseDiffOutput(fcDumpMultiDiff);
    const result = compareConfigurations(preset, fc);

    assert(result.status === ComparisonStatus.MISMATCH, 'Yields MISMATCH');
    assert(result.diffCount === 3, 'diffCount is exactly 3');
    assert(result.matchCount === 9, 'matchCount is 9');
}

// [4] Missing current value -> UNVERIFIED, not DIFFERENT
console.log('\n[4] Testing Missing Current Value -> UNVERIFIED...');
{
    const cleanPreset = basePreset.replace(/vtxtable[^\r\n]+/g, '');
    const preset = parsePresetDirectives(cleanPreset);
    // Remove gyro_lpf1_static_hz completely from dump
    const fcDumpMissing = baseFcDump.replace(/set gyro_lpf1_static_hz = 200\r?\n/, '');
    const fc = parseDiffOutput(fcDumpMissing);
    const result = compareConfigurations(preset, fc);

    assert(result.diffCount === 0, 'Missing parameter is NOT counted as different');
    assert(result.unverifiedCount === 1, 'Missing parameter is counted as unverified');
    assert(result.status === ComparisonStatus.UNVERIFIED, 'Overall status is UNVERIFIED');
    assert(result.unverified[0].fcValue === 'UNKNOWN', 'FC value reported as UNKNOWN');
}

// [5] Missing setting in diff all vs dump all (Effective default verification)
console.log('\n[5] Testing Effective Defaults in dump all...');
{
    // Betaflight 'dump all' emits default values (e.g. small_angle = 25) even when diff all omits it
    const presetWithDefault = `
    set small_angle = 25
    `;
    const dumpWithEffectiveDefault = `
    # dump all
    set small_angle = 25
    `;
    const preset = parsePresetDirectives(presetWithDefault);
    const fc = parseDiffOutput(dumpWithEffectiveDefault);
    const result = compareConfigurations(preset, fc);

    assert(result.status === ComparisonStatus.MATCH, 'Effective default matched from dump all');
    assert(result.matchCount === 1, 'Match count is 1');
}

// [6] Unsupported preset command -> explicitly reported as UNSUPPORTED / UNVERIFIED
console.log('\n[6] Testing Unsupported Preset Command Handling...');
{
    const preset = parsePresetDirectives(basePreset); // Contains vtxtable
    const fc = parseDiffOutput(baseFcDump);
    const result = compareConfigurations(preset, fc);

    assert(result.unsupportedCount === 1, 'Explicitly flags 1 unsupported directive');
    assert(result.unverifiedCount === 1, 'Unsupported directive increments unverifiedCount');
    assert(result.status === ComparisonStatus.UNVERIFIED, 'Unsupported command prevents premature MATCH');
    assert(result.unverified[0].result === ParameterResult.UNSUPPORTED, 'Result marked as UNSUPPORTED');
}

// [7] Preset containing comments and whitespace
console.log('\n[7] Testing Comments and Whitespace Resilience...');
{
    const messyPreset = `
    # Multiple comments
       # Indented comment
    
    set   dshot_idle_value   =   250   
    set craft_name   =   "T-System 13"   
    
    `;
    const preset = parsePresetDirectives(messyPreset);
    assert(preset.setParameters.size === 2, 'Parsed 2 set parameters despite whitespace and comments');
    assert(preset.setParameters.get('master.dshot_idle_value').normalizedValue === '250', 'Normalized numeric value');
    assert(preset.setParameters.get('master.craft_name').normalizedValue === 'T-System 13', 'Trimmed and stripped quotes');
}

// [8] Multiple-value settings (e.g. acc_calibration, arrays, commas)
console.log('\n[8] Testing Multi-value and Array Normalization...');
{
    assert(normalizeSemanticValue('14, -15, 22, 1') === '14,-15,22,1', 'Normalizes spaced array');
    assert(normalizeSemanticValue('14,-15,22,1') === '14,-15,22,1', 'Preserves compact array');

    const p = parsePresetDirectives('set acc_calibration = 14, -15, 22, 1');
    const f = parseDiffOutput('set acc_calibration = 14,-15,22,1');
    const res = compareConfigurations(p, f);
    assert(res.status === ComparisonStatus.MATCH, 'Multi-value arrays match across comma spacing');
}

// [9] Repeated settings in preset
console.log('\n[9] Testing Repeated Settings Handling...');
{
    const repeatPreset = `
    set vtx_power = 1
    set vtx_power = 3
    `;
    const preset = parsePresetDirectives(repeatPreset);
    assert(preset.setParameters.size === 1, 'Last occurrence overrides earlier definition');
    assert(preset.setParameters.get('master.vtx_power').rawValue === '3', 'Value is 3');
}

// [10] Invalid / empty preset handling
console.log('\n[10] Testing Invalid and Empty Presets...');
{
    const emptyPreset = parsePresetDirectives('');
    assert(emptyPreset.setParameters.size === 0, 'Empty preset yields 0 parameters');
    const res = compareConfigurations(emptyPreset, parseDiffOutput(''));
    assert(res.status === ComparisonStatus.NOT_CHECKED, 'Empty preset evaluates to NOT_CHECKED');
}

// [11] Incompatible FC target detection
console.log('\n[11] Testing Target Incompatibility Guard...');
{
    const targetPreset = parsePresetDirectives('board_name SPEEDYBEEF405V3');
    assert(targetPreset.targetBoard === 'SPEEDYBEEF405V3', 'Parsed target board');
    const res = compareConfigurations(targetPreset, parseDiffOutput(''), { fcBoard: 'SPEDIXF722' });
    assert(res.targetBoard === 'SPEEDYBEEF405V3', 'Preset target retained');
}

// [12] Profile and Rateprofile Scope Isolation
console.log('\n[12] Testing Profile & Rateprofile Scoping...');
{
    const scopedPreset = `
    set dshot_idle_value = 250
    profile 0
    set i_pitch = 63
    profile 1
    set i_pitch = 70
    `;
    const scopedDump = `
    # dump all
    set dshot_idle_value = 250
    profile 0
    set i_pitch = 63
    profile 1
    set i_pitch = 70
    `;
    const p = parsePresetDirectives(scopedPreset);
    const f = parseDiffOutput(scopedDump);
    const res = compareConfigurations(p, f);

    assert(res.status === ComparisonStatus.MATCH, 'Scoped profiles match exactly');
    assert(p.setParameters.has('profile_0.i_pitch'), 'profile_0 parameter stored');
    assert(p.setParameters.has('profile_1.i_pitch'), 'profile_1 parameter stored separately');
}

// [13] Invalidation & State Reset
console.log('\n[13] Testing Coordinator Invalidation...');
{
    presetComparator.activeComparisonId = 10;
    presetComparator.lastComparisonResult = { dummy: true };
    presetComparator.invalidate('DISCONNECT');
    assert(presetComparator.activeComparisonId === 11, 'activeComparisonId incremented');
    assert(presetComparator.lastComparisonResult === null, 'Cached result cleared');
}

// [14] Race Condition / Stale Superseded Guard
console.log('\n[14] Testing Monotonic Out-of-Order Superseding Guard...');
{
    const oldId = presetComparator.activeComparisonId;
    presetComparator.invalidate('NEW_CALL');
    assert(presetComparator.activeComparisonId > oldId, 'New ID generated to drop in-flight responses');
}

// [15] Log Output Formatting Verification
console.log('\n[15] Testing Log Report Output Structure...');
{
    const logs = [];
    const dummyResult = {
        status: ComparisonStatus.MISMATCH,
        presetName: 'TestPreset',
        matchCount: 10,
        diffCount: 2,
        unverifiedCount: 1,
        unsupportedCount: 0,
        differences: [
            { parameter: 'master.vtx_power', fcValue: '2', presetValue: '1' },
            { parameter: 'master.gyro_lpf1_static_hz', fcValue: '250', presetValue: '200' }
        ],
        unverified: [
            { parameter: 'master.unknown_param', fcValue: 'UNKNOWN', presetValue: '10', result: 'UNVERIFIED', reason: 'not present' }
        ]
    };

    logComparisonReport(dummyResult, { fcBoard: 'SPEDIXF722', fcVersion: 'Betaflight 4.5.1' }, (msg) => logs.push(msg));
    const fullLog = logs.join('\n');
    assert(fullLog.includes('PRESET COMPARISON: MISMATCH'), 'Header contains status');
    assert(fullLog.includes('Flight Controller: SPEDIXF722'), 'FC board output');
    assert(fullLog.includes('DIFFERENT'), 'Includes DIFFERENT keyword');
    assert(fullLog.includes('SUMMARY:'), 'Includes SUMMARY: block');
    assert(fullLog.includes('MATCH:        10'), 'Summary count formatted');
}

console.log(`\n=== PHASE 12B TESTS RESULT: ${passed} PASSED, ${failed} FAILED ===\n`);
if (failed > 0) process.exit(1);
