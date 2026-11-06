/**
 * Lightweight Unit Test Suite for Phase 9 Core Modules:
 * - ErrorManager (js/core/error_manager.js)
 * - FirmwareValidator (js/core/firmware_validator.js)
 * - CompatibilityChecker (js/core/compat_checker.js)
 */

import { ErrorManager, Severity, Category } from './js/core/error_manager.js';
import { FirmwareValidator, FirmwareFormat, CompatibilityEvidence, parseIntelHex, validateArmVectorTable } from './js/core/firmware_validator.js';
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

console.log('\n=== RUNNING PHASE 9 CORE ENGINE TESTS ===\n');

// ==========================================
// 1. ERROR MANAGER TESTS
// ==========================================
console.log('[1] Testing ErrorManager...');
const em = new ErrorManager();

em.info('INF_01', Category.CONNECTION, 'SERIAL', 'Connected to port COM3');
assert(em.messages.length === 1, 'Records INFO message');
assert(em.isOperationAllowed() === true, 'Operation allowed after INFO');

em.warning('WARN_01', Category.HARDWARE, 'FC', 'LiPo voltage slightly low', { voltage: 14.8 });
assert(em.messages.length === 2, 'Records WARNING message');
assert(em.isOperationAllowed() === true, 'Operation allowed after WARNING');

em.error('ERR_01', Category.PROTOCOL, 'BLHELI', 'ACK timeout on ESC 2', null, 'Retry', false);
assert(em.messages.length === 3, 'Records ERROR message');
assert(em.isOperationAllowed() === false, 'Operation blocked after unrecoverable ERROR');

em.critical('CRIT_01', Category.FIRMWARE, 'VALIDATOR', 'Flash erase failure');
assert(em.messages.length === 4, 'Records CRITICAL message');
assert(em.isOperationAllowed() === false, 'Operation blocked after CRITICAL');

const filteredWarnings = em.filter({ severity: Severity.WARNING });
assert(filteredWarnings.length === 1 && filteredWarnings[0].code === 'WARN_01', 'Filters by severity');

const filteredBlheli = em.filter({ category: Category.PROTOCOL });
assert(filteredBlheli.length === 1 && filteredBlheli[0].code === 'ERR_01', 'Filters by category');

const summary = em.getSummary();
assert(summary.total === 4 && summary.counts[Severity.ERROR] === 1 && summary.hasBlockers === true, 'Summary counts accurate');

em.clear();
assert(em.messages.length === 0 && em.isOperationAllowed() === true, 'Clear resets state and unblocks operations');


// ==========================================
// 2. INTEL HEX VALIDATOR TESTS
// ==========================================
console.log('\n[2] Testing Intel HEX Validator...');

// Synthetic valid Intel HEX record with 4 bytes data + EOF
// :0400000001020304F2 (sum: 04+00+00+00+01+02+03+04 + F2 = 0x100 -> checksum 00)
// :00000001FF (EOF, sum: 00+00+00+01 + FF = 0x100 -> checksum 00)
const validHex = `:0400000001020304F2\r\n:00000001FF\r\n`;
const resValid = parseIntelHex(validHex);
assert(resValid.valid === true, 'Valid Intel HEX parses successfully');
assert(resValid.totalBytes === 4, 'Total data bytes parsed correctly');

// Invalid checksum (F2 changed to F3)
const badCrcHex = `:0400000001020304F3\r\n:00000001FF\r\n`;
const resBadCrc = parseIntelHex(badCrcHex);
assert(resBadCrc.valid === false, 'Invalid checksum correctly rejected');

// Missing EOF
const missingEofHex = `:0400000001020304F2\r\n`;
const resMissingEof = parseIntelHex(missingEofHex);
assert(resMissingEof.valid === false, 'Missing EOF record correctly rejected');

// Extended Linear Address record (:020000040800F2) -> address offset 0x08000000
const extAddrHex = `:020000040800F2\r\n:0400000001020304F2\r\n:00000001FF\r\n`;
const resExtAddr = parseIntelHex(extAddrHex);
assert(resExtAddr.valid === true, 'Extended linear address handled properly');
assert(resExtAddr.addressRange && resExtAddr.addressRange.min === 0x08000000, 'Calculates 32-bit extended address offset correctly');

// Truncated record line
const truncatedHex = `:040000000102\r\n:00000001FF\r\n`;
const resTrunc = parseIntelHex(truncatedHex);
assert(resTrunc.valid === false, 'Truncated record line correctly rejected');


// ==========================================
// 3. RAW BINARY & VECTOR TABLE TESTS
// ==========================================
console.log('\n[3] Testing RAW Binary & ARM Vector Table Validator...');

// Empty binary
const emptyRes = FirmwareValidator.validate({ data: new Uint8Array(0), targetDomain: 'FC' });
assert(emptyRes.valid === false && emptyRes.errors.length > 0, 'Empty binary correctly rejected');

// Synthetic valid Cortex-M vector table:
// SP = 0x20010000 (RAM), Reset Handler = 0x08000101 (Flash Thumb bit set)
const validVectorBin = new Uint8Array(64);
const dv = new DataView(validVectorBin.buffer);
dv.setUint32(0, 0x20010000, true); // Little endian SP
dv.setUint32(4, 0x08000101, true); // Little endian Reset handler

const vecRes = validateArmVectorTable(validVectorBin, {
    flashBase: 0x08000000,
    flashLimit: 0x08080000,
    ramBase: 0x20000000,
    ramLimit: 0x20040000
});
assert(vecRes.plausible === true, 'Plausible ARM vector table confirmed');

// Invalid reset handler without Thumb bit (even address)
dv.setUint32(4, 0x08000100, true);
const vecResNoThumb = validateArmVectorTable(validVectorBin, null);
assert(vecResNoThumb.plausible === false, 'Reset vector without Thumb bit rejected');

// Invalid Stack pointer (outside RAM)
dv.setUint32(0, 0x10000000, true); // Invalid RAM
dv.setUint32(4, 0x08000101, true);
const vecResBadRam = validateArmVectorTable(validVectorBin, {
    flashBase: 0x08000000,
    flashLimit: 0x08080000,
    ramBase: 0x20000000,
    ramLimit: 0x20040000
});
assert(vecResBadRam.plausible === false, 'Stack pointer outside RAM limits rejected');

// Binary with embedded target descriptor string
const taggedBin = new Uint8Array(256);
const tagStr = 'board_name SPEDIXF722\nBetaflight 4.5.1';
for (let i = 0; i < tagStr.length; i++) taggedBin[32 + i] = tagStr.charCodeAt(i);
// Put back valid vectors
const dv2 = new DataView(taggedBin.buffer);
dv2.setUint32(0, 0x20010000, true);
dv2.setUint32(4, 0x08000101, true);

const taggedRes = FirmwareValidator.validate({
    data: taggedBin,
    targetDomain: 'FC',
    expected: { boardName: 'SPEDIXF722', mcuType: 'STM32F722' }
});
assert(taggedRes.valid === true, 'Tagged binary validated');
assert(taggedRes.compatibilityEvidence === CompatibilityEvidence.CONFIRMED, 'Confirmed compatibility when target matches');

// Target mismatch test
const mismatchRes = FirmwareValidator.validate({
    data: taggedBin,
    targetDomain: 'FC',
    expected: { boardName: 'MATEKF405' }
});
assert(mismatchRes.valid === false, 'Rejects binary when expected target does not match');
assert(mismatchRes.compatibilityEvidence === CompatibilityEvidence.INCOMPATIBLE, 'Flags incompatibility evidence');


// ==========================================
// 4. COMPATIBILITY CHECKER TESTS
// ==========================================
console.log('\n[4] Testing Compatibility Checker...');

// Matching FC
const fcMatch = CompatibilityChecker.checkFlightController(
    { boardName: 'SPEDIXF722', mcuType: 'STM32F722', firmwareVersion: '4.5.1' },
    { boardName: 'SPEDIXF722', mcuType: 'STM32F722', firmwareVersion: '4.5.1' }
);
assert(fcMatch.overallStatus === CompatibilityStatus.COMPATIBLE, 'Matching FC reports COMPATIBLE');
assert(fcMatch.operationAllowed === true, 'Operation allowed on matching FC');

// Target board mismatch
const fcMismatch = CompatibilityChecker.checkFlightController(
    { boardName: 'SPEDIXF722' },
    { boardName: 'GEPRC_F722' }
);
assert(fcMismatch.overallStatus === CompatibilityStatus.INCOMPATIBLE, 'Wrong FC target reports INCOMPATIBLE');
assert(fcMismatch.operationAllowed === false, 'Operation blocked on FC target mismatch');

// MCU architecture mismatch
const mcuMismatch = CompatibilityChecker.checkFlightController(
    { boardName: 'SPEDIXF722', mcuType: 'STM32F405' },
    { boardName: 'SPEDIXF722', mcuType: 'STM32F722' }
);
assert(mcuMismatch.overallStatus === CompatibilityStatus.INCOMPATIBLE, 'MCU mismatch reports INCOMPATIBLE');

// Firmware version difference (Warning)
const verWarn = CompatibilityChecker.checkFlightController(
    { boardName: 'SPEDIXF722', firmwareVersion: '4.4.2' },
    { boardName: 'SPEDIXF722', firmwareVersion: '4.5.1' }
);
assert(verWarn.overallStatus === CompatibilityStatus.WARNING, 'Firmware version difference returns WARNING');
assert(verWarn.operationAllowed === true, 'Operation allowed with WARNING for version drift');

// Preset target compatibility
const presetMatch = CompatibilityChecker.checkFlightController(
    { boardName: 'SPEDIXF722' },
    { boardName: 'SPEDIXF722', presetText: 'defaults nosave\r\nboard_name SPEDIXF722\r\n' }
);
assert(presetMatch.overallStatus === CompatibilityStatus.COMPATIBLE, 'Matching preset target reports COMPATIBLE');

const presetMismatch = CompatibilityChecker.checkFlightController(
    { boardName: 'SPEDIXF722' },
    { boardName: 'SPEDIXF722', presetText: 'defaults nosave\r\nboard_name BETAFPV_F405\r\n' }
);
assert(presetMismatch.overallStatus === CompatibilityStatus.INCOMPATIBLE, 'Incompatible preset target reports INCOMPATIBLE');

// ESC Uniformity check: all 4 identical
const escsUniform = CompatibilityChecker.checkEscs(
    {
        expectedCount: 4,
        escs: [
            { index: 0, version: '32.9', signature: '0x3402' },
            { index: 1, version: '32.9', signature: '0x3402' },
            { index: 2, version: '32.9', signature: '0x3402' },
            { index: 3, version: '32.9', signature: '0x3402' }
        ]
    },
    { firmwareVersion: '32.9' }
);
assert(escsUniform.overallStatus === CompatibilityStatus.COMPATIBLE, 'Uniform ESC versions report COMPATIBLE');

// ESC Discrepancy: ESC #3 has different firmware
const escsDiscrepancy = CompatibilityChecker.checkEscs(
    {
        expectedCount: 4,
        escs: [
            { index: 0, version: '32.9', signature: '0x3402' },
            { index: 1, version: '32.9', signature: '0x3402' },
            { index: 2, version: '32.7', signature: '0x3402' },
            { index: 3, version: '32.9', signature: '0x3402' }
        ]
    },
    { firmwareVersion: '32.9' }
);
assert(escsDiscrepancy.overallStatus === CompatibilityStatus.WARNING, 'Non-uniform ESC versions report WARNING');

// Missing ESCs (only 2 responding out of 4)
const escsMissing = CompatibilityChecker.checkEscs(
    {
        expectedCount: 4,
        escs: [
            { index: 0, version: '32.9', signature: '0x3402' },
            { index: 1, version: '32.9', signature: '0x3402' }
        ]
    }
);
assert(escsMissing.overallStatus === CompatibilityStatus.WARNING, 'Incomplete ESC count reports WARNING');

// Zero ESCs responding
const escsZero = CompatibilityChecker.checkEscs(
    {
        expectedCount: 4,
        escs: []
    }
);
assert(escsZero.overallStatus === CompatibilityStatus.INCOMPATIBLE, 'Zero responding ESCs reports INCOMPATIBLE');

console.log(`\n=== TEST RESULTS: ${passed} PASSED, ${failed} FAILED ===\n`);
if (failed > 0) process.exit(1);
