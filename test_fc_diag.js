/**
 * Test Suite for Flight Controller (FC) Diagnostics (js/betaflight/fc_diag.js)
 */

import { parseFcTelemetry, FC_DIAG_SCOPE } from './js/betaflight/fc_diag.js';
import { CompatibilityChecker, CompatibilityStatus } from './js/core/compat_checker.js';
import { errorManager, Category, Severity } from './js/core/error_manager.js';

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

console.log('\n=== RUNNING FC DIAGNOSTICS TESTS ===\n');

// Sample real-world Betaflight 4.5.1 CLI responses
const sampleCliStatus = `
# version
# Betaflight / STM32F7X2 (S7X2) 4.5.1 Dec  2 2024 / 10:06:22 (77d01ba3b) MSP API: 1.46
# config rev: cb1d3ac

# status
MCU: STM32F7X2
MCU ID: 003c004c3335510b37373437
board_name SPEDIXF722
manufacturer_id SPDX
target: SPEDIXF722
name: T-System 13
Arming disable flags: RXLOSS CLI MSP
`;

// 1. Successful Telemetry Parsing
console.log('[1] Testing Telemetry Parsing...');
const t1 = parseFcTelemetry(sampleCliStatus);
assert(t1.firmwareName === 'Betaflight', 'Parses firmware name (Betaflight)');
assert(t1.firmwareVersion === '4.5.1', 'Parses firmware version (4.5.1)');
assert(t1.target === 'SPEDIXF722', 'Parses target identifier (SPEDIXF722)');
assert(t1.boardName === 'SPEDIXF722', 'Parses board name (SPEDIXF722)');
assert(t1.mcu === 'STM32F7X2', 'Parses MCU family (STM32F7X2)');
assert(t1.architecture !== null && t1.architecture.includes('Cortex-M7'), 'Infers Cortex-M7 architecture');
assert(t1.mcuId === '003c004c3335510b37373437', 'Parses MCU ID');
assert(t1.craftName === 'T-System 13', 'Parses Craft Name');

// 2. Missing Target / Incomplete Output
console.log('\n[2] Testing Incomplete CLI Outputs...');
const incompleteCli = `
# version
# Betaflight / 4.4.0
`;
const t2 = parseFcTelemetry(incompleteCli);
assert(t2.firmwareVersion === '4.4.0', 'Parses partial version');
assert(t2.target === null, 'Missing target is reported as null');
assert(t2.boardName === null, 'Missing board name is reported as null');

// 3. Compatibility Evaluation using CompatibilityChecker
console.log('\n[3] Testing FC Compatibility Evaluation...');
// Matching Target & MCU
const matchRes = CompatibilityChecker.checkFlightController(
    { boardName: t1.boardName, mcuType: t1.mcu, firmwareVersion: t1.firmwareVersion },
    { boardName: 'SPEDIXF722', mcuType: 'STM32F7X2', firmwareVersion: '4.5.1' }
);
assert(matchRes.overallStatus === CompatibilityStatus.COMPATIBLE, 'Matching FC evaluates to COMPATIBLE');
assert(matchRes.operationAllowed === true, 'Matching FC grants operation clearance');

// Target Mismatch
const mismatchTargetRes = CompatibilityChecker.checkFlightController(
    { boardName: t1.boardName, mcuType: t1.mcu },
    { boardName: 'IFLIGHT_BLITZ_F7' }
);
assert(mismatchTargetRes.overallStatus === CompatibilityStatus.INCOMPATIBLE, 'Target mismatch evaluates to INCOMPATIBLE');
assert(mismatchTargetRes.operationAllowed === false, 'Target mismatch denies clearance');

// MCU Mismatch
const mismatchMcuRes = CompatibilityChecker.checkFlightController(
    { boardName: 'SPEDIXF722', mcuType: 'STM32F405' },
    { boardName: 'SPEDIXF722', mcuType: 'STM32F722' }
);
assert(mismatchMcuRes.overallStatus === CompatibilityStatus.INCOMPATIBLE, 'MCU mismatch evaluates to INCOMPATIBLE');

// Version Drift Warning
const versionDriftRes = CompatibilityChecker.checkFlightController(
    { boardName: 'SPEDIXF722', mcuType: 'STM32F7X2', firmwareVersion: '4.4.2' },
    { boardName: 'SPEDIXF722', mcuType: 'STM32F7X2', firmwareVersion: '4.5.1' }
);
assert(versionDriftRes.overallStatus === CompatibilityStatus.WARNING, 'Firmware version drift evaluates to WARNING');
assert(versionDriftRes.operationAllowed === true, 'Version drift allows operation with warning');

// Preset Target Check
const presetMatchRes = CompatibilityChecker.checkFlightController(
    { boardName: 'SPEDIXF722' },
    { boardName: 'SPEDIXF722', presetText: 'board_name SPEDIXF722\r\nset vtx_power = 1' }
);
assert(presetMatchRes.overallStatus === CompatibilityStatus.COMPATIBLE, 'Compatible preset evaluates to COMPATIBLE');

const presetMismatchRes = CompatibilityChecker.checkFlightController(
    { boardName: 'SPEDIXF722' },
    { boardName: 'SPEDIXF722', presetText: 'board_name MAMBAF405\r\nset vtx_power = 1' }
);
assert(presetMismatchRes.overallStatus === CompatibilityStatus.INCOMPATIBLE, 'Incompatible preset evaluates to INCOMPATIBLE');

// 4. ErrorManager Scope Isolation
console.log('\n[4] Testing FC ErrorManager Scoping...');
errorManager.clear(FC_DIAG_SCOPE);
errorManager.error('FC_ERR_TEST', Category.PROTOCOL, 'FC_DIAG', 'Simulated disconnect', null, 'Reconnect', false, FC_DIAG_SCOPE);
assert(errorManager.isOperationAllowed({ scope: FC_DIAG_SCOPE }) === false, 'Blocks operations within FC_DIAG_SCOPE');
assert(errorManager.isOperationAllowed({ scope: 'OTHER_SCOPE' }) === true, 'Preserves other scopes');
errorManager.clear(FC_DIAG_SCOPE);
assert(errorManager.isOperationAllowed({ scope: FC_DIAG_SCOPE }) === true, 'Clearing FC_DIAG_SCOPE restores clearance');

console.log(`\n=== FC TESTS RESULT: ${passed} PASSED, ${failed} FAILED ===\n`);
if (failed > 0) process.exit(1);
