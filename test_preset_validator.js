/**
 * Unit Test Suite for Pre-flash Preset Validation (js/betaflight/preset_validator.js)
 */

import { parsePresetConfig, parseDiffOutput, normalizeValue } from './js/betaflight/preset_validator.js';

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

console.log('\n=== RUNNING PRESET VALIDATOR TESTS ===\n');

// 1. Value Normalization
console.log('[1] Testing normalizeValue...');
assert(normalizeValue('ON') === 'ON', 'Preserves ON');
assert(normalizeValue('on') === 'ON', 'Normalizes on to ON');
assert(normalizeValue(' OFF ') === 'OFF', 'Normalizes whitespace and lowercase off');
assert(normalizeValue('none') === 'NONE', 'Normalizes none to NONE');
assert(normalizeValue('1280') === '1280', 'Preserves numeric string 1280');

// 2. Preset Config Parsing
console.log('\n[2] Testing parsePresetConfig...');
const presetSample = `
defaults nosave
batch start
board_name SPEDIXF722

resource MOTOR 5 NONE
resource SERVO 1 B06

feature SERVO_TILT
feature OSD
feature -TELEMETRY

set dshot_idle_value = 250
set yaw_motors_reversed = ON
set vtx_power = 1
set craft_name = T-System 13

profile 0
set i_pitch = 63
set d_pitch = 50

rateprofile 0
set roll_srate = 35

save
`;

const parsedPreset = parsePresetConfig(presetSample);
assert(parsedPreset.targetBoard === 'SPEDIXF722', 'Parses target board (SPEDIXF722)');
assert(parsedPreset.setParameters.has('master.dshot_idle_value'), 'Parses master.dshot_idle_value');
assert(parsedPreset.setParameters.get('master.dshot_idle_value').expectedValue === '250', 'dshot_idle_value is 250');
assert(parsedPreset.setParameters.has('profile_0.i_pitch'), 'Parses profile_0.i_pitch');
assert(parsedPreset.setParameters.get('profile_0.i_pitch').expectedValue === '63', 'i_pitch is 63');
assert(parsedPreset.setParameters.has('rateprofile_0.roll_srate'), 'Parses rateprofile_0.roll_srate');
assert(parsedPreset.featuresEnabled.has('OSD'), 'Feature OSD is marked ENABLED');
assert(parsedPreset.featuresEnabled.has('SERVO_TILT'), 'Feature SERVO_TILT is marked ENABLED');
assert(parsedPreset.featuresDisabled.has('TELEMETRY'), 'Feature TELEMETRY is marked DISABLED');
assert(parsedPreset.resources.get('MOTOR 5') === 'NONE', 'Resource MOTOR 5 is NONE');
assert(parsedPreset.resources.get('SERVO 1') === 'B06', 'Resource SERVO 1 is B06');

// 3. Dump / Diff Output Parsing
console.log('\n[3] Testing parseDiffOutput...');
const dumpSample = `
# dump all
board_name SPEDIXF722
resource MOTOR 5 NONE
resource SERVO 1 B06

feature SERVO_TILT
feature OSD

set dshot_idle_value = 250
set yaw_motors_reversed = ON
set vtx_power = 1
set craft_name = T-System 13

profile 0
set i_pitch = 63
set d_pitch = 50

rateprofile 0
set roll_srate = 35
`;

const parsedDump = parseDiffOutput(dumpSample);
assert(parsedDump.setParameters.get('master.dshot_idle_value') === '250', 'Parses dump dshot_idle_value');
assert(parsedDump.setParameters.get('profile_0.i_pitch') === '63', 'Parses dump profile_0.i_pitch');
assert(parsedDump.activeFeatures.has('OSD'), 'Active feature OSD detected');
assert(!parsedDump.activeFeatures.has('TELEMETRY'), 'TELEMETRY correctly absent from active features');

// 4. Comparison Logic: Full Match -> PASS
console.log('\n[4] Testing Comparison Logic (Identical Match)...');
const differences = [];
const unverified = [];
let matchCount = 0;

for (const [key, exp] of parsedPreset.setParameters.entries()) {
    const cur = parsedDump.setParameters.get(key);
    if (cur === undefined) {
        unverified.push(key);
    } else if (normalizeValue(cur) === normalizeValue(exp.expectedValue)) {
        matchCount++;
    } else {
        differences.push({ key, cur, exp: exp.expectedValue });
    }
}

for (const feat of parsedPreset.featuresEnabled) {
    if (parsedDump.activeFeatures.has(feat)) matchCount++;
    else differences.push({ key: `feature ${feat}`, cur: 'DISABLED', exp: 'ENABLED' });
}
for (const feat of parsedPreset.featuresDisabled) {
    if (!parsedDump.activeFeatures.has(feat)) matchCount++;
    else differences.push({ key: `feature ${feat}`, cur: 'ENABLED', exp: 'DISABLED' });
}

for (const [resKey, expPin] of parsedPreset.resources.entries()) {
    const curPin = parsedDump.activeResources.get(resKey);
    if (curPin === undefined) unverified.push(`resource ${resKey}`);
    else if (curPin.toUpperCase() === expPin.toUpperCase()) matchCount++;
    else differences.push({ key: `resource ${resKey}`, cur: curPin, exp: expPin });
}

assert(differences.length === 0, 'No differences detected when configuration matches 100%');
assert(matchCount === 12, 'All 12 expected settings/features/resources matched');

// 5. Comparison Logic: Mismatch -> ERROR listing parameters
console.log('\n[5] Testing Comparison Logic (Mismatch Detection)...');
const modifiedDump = dumpSample
    .replace('set vtx_power = 1', 'set vtx_power = 2')
    .replace('set i_pitch = 63', 'set i_pitch = 55')
    .replace('feature SERVO_TILT', 'feature -SERVO_TILT');

const parsedModDump = parseDiffOutput(modifiedDump);
const diffs = [];

for (const [key, exp] of parsedPreset.setParameters.entries()) {
    const cur = parsedModDump.setParameters.get(key);
    if (cur !== undefined && normalizeValue(cur) !== normalizeValue(exp.expectedValue)) {
        diffs.push({ parameter: key, currentValue: cur, expectedValue: exp.expectedValue });
    }
}
for (const feat of parsedPreset.featuresEnabled) {
    if (!parsedModDump.activeFeatures.has(feat)) {
        diffs.push({ parameter: `feature ${feat}`, currentValue: 'DISABLED', expectedValue: 'ENABLED' });
    }
}

assert(diffs.length === 3, 'Exactly 3 mismatches detected');
assert(diffs.some(d => d.parameter === 'master.vtx_power' && d.currentValue === '2' && d.expectedValue === '1'), 'Identifies master.vtx_power mismatch');
assert(diffs.some(d => d.parameter === 'profile_0.i_pitch' && d.currentValue === '55' && d.expectedValue === '63'), 'Identifies profile_0.i_pitch mismatch');
assert(diffs.some(d => d.parameter === 'feature SERVO_TILT' && d.currentValue === 'DISABLED' && d.expectedValue === 'ENABLED'), 'Identifies feature SERVO_TILT mismatch');

// 6. Omitted / Unverified Parameter Handling
console.log('\n[6] Testing Unverified / Omitted Parameter Handling...');
const minimalDump = `
# dump all
board_name SPEDIXF722
set craft_name = T-System 13
`;
const parsedMinDump = parseDiffOutput(minimalDump);
const unverList = [];
for (const [key, exp] of parsedPreset.setParameters.entries()) {
    if (!parsedMinDump.setParameters.has(key)) {
        unverList.push(key);
    }
}
assert(unverList.length > 0, 'Omitted settings correctly categorized as UNVERIFIED rather than false difference');
assert(unverList.includes('master.vtx_power'), 'master.vtx_power listed in unverified');

console.log(`\n=== PRESET VALIDATOR TESTS RESULT: ${passed} PASSED, ${failed} FAILED ===\n`);
if (failed > 0) process.exit(1);
