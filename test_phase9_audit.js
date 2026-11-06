/**
 * Comprehensive Safety & Validation Test Suite for Phase 9.1 Audit
 * Verifies ARM MCU Profiles, Intel HEX safety, Evidence Confidence, ErrorManager lifecycle, and Compatibility policies.
 */

import { ErrorManager, Severity, Category } from './js/core/error_manager.js';
import {
    FirmwareValidator,
    FirmwareFormat,
    CompatibilityEvidence,
    parseIntelHex,
    validateArmVectorTable,
    resolveMcuProfile,
    MCU_PROFILES
} from './js/core/firmware_validator.js';
import { CompatibilityChecker, CompatibilityStatus } from './js/core/compat_checker.js';

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

console.log('\n=== RUNNING PHASE 9.1 AUDIT TEST SUITE ===\n');

// ==========================================
// 1. ERROR MANAGER LIFECYCLE & SCOPING
// ==========================================
console.log('[1] Testing ErrorManager Lifecycle & Scoping...');
const em = new ErrorManager();

// Scoped logging
em.info('OP1_INF', Category.CONNECTION, 'SERIAL', 'Port COM1 opened', null, '', 'OP_FLASH');
em.error('OP1_ERR', Category.FLASHING, 'FLASHER', 'Flash write timeout', null, 'Retry', false, 'OP_FLASH');
em.info('OP2_INF', Category.CONNECTION, 'SERIAL', 'Port COM2 opened', null, '', 'OP_READ');

assert(em.messages.length === 3, 'Records messages across multiple scopes');
assert(em.isOperationAllowed({ scope: 'OP_FLASH' }) === false, 'Blocks OP_FLASH due to error');
assert(em.isOperationAllowed({ scope: 'OP_READ' }) === true, 'Allows OP_READ independently of OP_FLASH error');

// Scoped clearing
em.clear('OP_FLASH');
assert(em.filter({ scope: 'OP_FLASH' }).length === 0, 'Clears only specified scope');
assert(em.filter({ scope: 'OP_READ' }).length === 1, 'Preserves other scopes');
assert(em.isOperationAllowed({ scope: 'OP_FLASH' }) === true, 'Unblocks OP_FLASH after clear');

// Recoverable vs Unrecoverable errors
em.clear();
em.error('REC_ERR', Category.VALIDATION, 'VALIDATOR', 'CRC retryable error', null, 'Retry', true);
assert(em.isOperationAllowed({ allowRecoverableErrors: false }) === false, 'Disallows recoverable error by default');
assert(em.isOperationAllowed({ allowRecoverableErrors: true }) === true, 'Allows recoverable error with explicit policy');

em.critical('CRIT_ERR', Category.HARDWARE, 'MCU', 'Hardware fault');
assert(em.isOperationAllowed({ allowRecoverableErrors: true }) === false, 'CRITICAL always blocks even with allowRecoverableErrors=true');


// ==========================================
// 2. MCU DESCRIPTORS & ARCHITECTURE VALIDATION
// ==========================================
console.log('\n[2] Testing Explicit MCU Descriptors & Vector Checks...');

// Supported MCU Profile Resolution
const f7Profile = resolveMcuProfile('STM32F722RE');
assert(f7Profile !== null && f7Profile.core === 'Cortex-M7', 'Resolves verified STM32F722 profile');

const g0Profile = resolveMcuProfile('STM32G071KB');
assert(g0Profile !== null && g0Profile.core === 'Cortex-M0+' && g0Profile.arch === 'ARMv6-M', 'Resolves verified STM32G071 profile as Cortex-M0+ / ARMv6-M');

// Unknown MCU identification must return null (no guessing)
const unknownMcu = resolveMcuProfile('UNKNOWN_MCU_123');
assert(unknownMcu === null, 'Unknown MCU returns null without guessing');

// Vector checks with exact profile
const testBin = new Uint8Array(64);
const dv = new DataView(testBin.buffer);

// Set SP to 0x20005000 (valid for G0 36KB RAM) and Reset to 0x08000201 (Thumb bit set)
dv.setUint32(0, 0x20005000, true);
dv.setUint32(4, 0x08000201, true);

const g0Valid = validateArmVectorTable(testBin, g0Profile);
assert(g0Valid.plausible === true, 'Vector table within G071 boundaries validated');

// SP outside G071 RAM (e.g. 0x20010000 - 64KB, which G071 does not have)
dv.setUint32(0, 0x20010000, true);
const g0Overflow = validateArmVectorTable(testBin, g0Profile);
assert(g0Overflow.plausible === false, 'Rejects SP exceeding specific MCU RAM boundary');

// Unaligned SP (must be 4-byte aligned)
dv.setUint32(0, 0x20005002, true); // 2-byte aligned, not 4-byte
const unalignedSp = validateArmVectorTable(testBin, g0Profile);
assert(unalignedSp.plausible === false, 'Rejects unaligned Initial Stack Pointer');


// ==========================================
// 3. INTEL HEX AUDIT: CORRUPTION, OVERLAPS, EOF
// ==========================================
console.log('\n[3] Testing Intel HEX Parser Audit...');

// Overlapping conflicting records
const overlapHex =
    `:020000001122CB\r\n` +
    `:02000100334486\r\n` + // Overlaps address 0x0001 with different byte (33 vs 22)
    `:00000001FF\r\n`;
const resOverlap = parseIntelHex(overlapHex);
assert(resOverlap.valid === false && resOverlap.errors.some(e => e.includes('Conflicting data overlap')), 'Detects conflicting overlapping records');

// Records after EOF record must be rejected
const postEofHex =
    `:020000001122CB\r\n` +
    `:00000001FF\r\n` +
    `:02000200334485\r\n`;
const resPostEof = parseIntelHex(postEofHex);
assert(resPostEof.valid === false && resPostEof.errors.some(e => e.includes('Illegal record found after EOF')), 'Rejects records appearing after EOF');

// Unsupported record type (e.g. type 0x09)
const badTypeHex = `:020000091122C2\r\n:00000001FF\r\n`;
const resBadType = parseIntelHex(badTypeHex);
assert(resBadType.valid === false && resBadType.errors.some(e => e.includes('Unsupported Intel HEX record type')), 'Rejects unsupported record types');

// EOF with non-zero byte count (:0100000100FE -> count=01, addr=0000, type=01, data=00, sum: 01+00+00+01+00+FE = 0x100 -> checksum OK)
const badEofLen = `:0100000100FE\r\n`;
const resBadEofLen = parseIntelHex(badEofLen);
assert(resBadEofLen.valid === false && resBadEofLen.errors.some(e => e.includes('EOF record must have byte count 0')), 'Rejects EOF with non-zero byte count');


// ==========================================
// 4. FIRMWARE METADATA CONFIDENCE & EVIDENCE
// ==========================================
console.log('\n[4] Testing Firmware Metadata Confidence...');

// Construct valid binary with embedded string tag
const taggedBin = new Uint8Array(256);
const dvTag = new DataView(taggedBin.buffer);
dvTag.setUint32(0, 0x20010000, true);
dvTag.setUint32(4, 0x08000101, true);
const tagStr = 'board_name SPEDIXF722\nBetaflight';
for (let i = 0; i < tagStr.length; i++) taggedBin[32 + i] = tagStr.charCodeAt(i);

// 1. Target mismatch MUST be INCOMPATIBLE
const resTargetMismatch = FirmwareValidator.validate({
    data: taggedBin,
    targetDomain: 'FC',
    expected: { boardName: 'MATEKF405' }
});
assert(resTargetMismatch.valid === false, 'Target mismatch marked invalid');
assert(resTargetMismatch.compatibilityEvidence === CompatibilityEvidence.INCOMPATIBLE, 'Target mismatch assigned INCOMPATIBLE evidence');

// 2. String match without exact MCU Profile or with requireAuthoritativeEvidence -> PLAUSIBLE (not confirmed)
const resPlausibleOnly = FirmwareValidator.validate({
    data: taggedBin,
    targetDomain: 'FC',
    expected: { boardName: 'SPEDIXF722', requireAuthoritativeEvidence: true }
});
assert(resPlausibleOnly.compatibilityEvidence === CompatibilityEvidence.PLAUSIBLE, 'ASCII string match alone does NOT establish CONFIRMED when authoritative proof required');

// 3. Binary with vector table but NO target metadata
const untaggedBin = new Uint8Array(256);
const dvUntag = new DataView(untaggedBin.buffer);
dvUntag.setUint32(0, 0x20010000, true);
dvUntag.setUint32(4, 0x08000101, true);

const resUntagged = FirmwareValidator.validate({
    data: untaggedBin,
    targetDomain: 'FC',
    expected: { boardName: 'SPEDIXF722' }
});
assert(resUntagged.compatibilityEvidence === CompatibilityEvidence.PLAUSIBLE, 'Plausible architecture without metadata assigned PLAUSIBLE');


// ==========================================
// 5. COMPATIBILITY CHECKER AUDIT
// ==========================================
console.log('\n[5] Testing CompatibilityChecker Policy & Unknown Handling...');

// Missing FC Target produces UNKNOWN and blocks operation
const fcUnknown = CompatibilityChecker.checkFlightController(
    { mcuType: 'STM32F722' },
    { boardName: 'SPEDIXF722' }
);
assert(fcUnknown.overallStatus === CompatibilityStatus.UNKNOWN, 'Missing hardware board target returns UNKNOWN');
assert(fcUnknown.operationAllowed === false, 'UNKNOWN target blocks operation clearance');

// Missing ESC responses never confused for uniform ESC set
const escsEmpty = CompatibilityChecker.checkEscs({ escs: [] });
assert(escsEmpty.overallStatus === CompatibilityStatus.INCOMPATIBLE, 'Empty ESC set returns INCOMPATIBLE');
assert(escsEmpty.operationAllowed === false, 'Empty ESC set blocks operation');

// ESC non-uniformity identification by channel
const escsNonUniform = CompatibilityChecker.checkEscs({
    escs: [
        { index: 0, version: '32.9' },
        { index: 1, version: '32.9' },
        { index: 2, version: '32.7' },
        { index: 3, version: '32.9' }
    ]
});
assert(escsNonUniform.overallStatus === CompatibilityStatus.WARNING, 'Non-uniform ESCs report WARNING');
assert(escsNonUniform.checks.some(c => c.detail.includes('ESC #3')), 'Detailed check explicitly identifies divergent ESC channel (ESC #3)');

console.log(`\n=== AUDIT RESULTS: ${passed} PASSED, ${failed} FAILED ===\n`);
if (failed > 0) process.exit(1);
