/**
 * Test Suite for ESC Diagnostics (js/blheli/esc_diag.js)
 */

import { identifyEscHardware, KNOWN_ESC_SIGNATURES, ESC_DIAG_SCOPE } from './js/blheli/esc_diag.js';
import { CompatibilityChecker, CompatibilityStatus } from './js/core/compat_checker.js';
import { errorManager, Category } from './js/core/error_manager.js';

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

console.log('\n=== RUNNING ESC DIAGNOSTICS TESTS ===\n');

// 1. Hardware Signature Identification
console.log('[1] Testing Signature Mapping...');
const g0 = identifyEscHardware('0x3402');
assert(g0.mcu === 'STM32G071' && g0.family === 'BLHeli_32', 'Maps 0x3402 to STM32G071 BLHeli_32');

const f4 = identifyEscHardware('0x3403');
assert(f4.mcu === 'AT32F421' && f4.family === 'BLHeli_32', 'Maps 0x3403 to AT32F421 BLHeli_32');

const unk = identifyEscHardware('0x9999');
assert(unk.mcu.includes('ARM 32-bit'), 'Unknown signature maps to generic ARM 32-bit without fabricating');

// 2. Multi-ESC Discovery Scenarios (Compatibility Evaluation)
console.log('\n[2] Testing Multi-ESC Discovery Scenarios...');

// Scenario A: Standard 4 responding ESCs (Uniform v32.9)
const escSet4 = [
    { index: 0, version: '32.9', signature: '0x3402' },
    { index: 1, version: '32.9', signature: '0x3402' },
    { index: 2, version: '32.9', signature: '0x3402' },
    { index: 3, version: '32.9', signature: '0x3402' }
];
const res4 = CompatibilityChecker.checkEscs({ expectedCount: 4, escs: escSet4 }, { firmwareVersion: '32.9' });
assert(res4.overallStatus === CompatibilityStatus.COMPATIBLE, '4 uniform ESCs evaluate to COMPATIBLE');
assert(res4.operationAllowed === true, '4 uniform ESCs grant operation clearance');

// Scenario B: Incomplete count (Only 2 responding out of 4)
const escSet2 = [
    { index: 0, version: '32.9', signature: '0x3402' },
    { index: 1, version: '32.9', signature: '0x3402' }
];
const res2 = CompatibilityChecker.checkEscs({ expectedCount: 4, escs: escSet2 }, { firmwareVersion: '32.9' });
assert(res2.overallStatus === CompatibilityStatus.WARNING, 'Partial ESC count evaluates to WARNING');
assert(res2.warnings.some(w => w.includes('detected 2 ESCs, expected 4')), 'Emits explicit count discrepancy warning');

// Scenario C: Non-uniform version on one ESC (ESC #3 on v32.7)
const escSetDiscrepancy = [
    { index: 0, version: '32.9', signature: '0x3402' },
    { index: 1, version: '32.9', signature: '0x3402' },
    { index: 2, version: '32.7', signature: '0x3402' }, // ESC #3
    { index: 3, version: '32.9', signature: '0x3402' }
];
const resDisc = CompatibilityChecker.checkEscs({ expectedCount: 4, escs: escSetDiscrepancy }, { firmwareVersion: '32.9' });
assert(resDisc.overallStatus === CompatibilityStatus.WARNING, 'Non-uniform ESC version returns WARNING');
assert(resDisc.checks.some(c => c.detail.includes('ESC #3')), 'Explicitly identifies ESC #3 as divergent channel');

// Scenario D: Mixed Hardware / Chip Signatures
const escSetMixedHw = [
    { index: 0, version: '32.9', signature: '0x3402' },
    { index: 1, version: '32.9', signature: '0x3402' },
    { index: 2, version: '32.9', signature: '0x3403' }, // Different chip (AT32F421)
    { index: 3, version: '32.9', signature: '0x3402' }
];
const resMixedHw = CompatibilityChecker.checkEscs({ expectedCount: 4, escs: escSetMixedHw }, { firmwareVersion: '32.9' });
assert(resMixedHw.overallStatus === CompatibilityStatus.WARNING, 'Mixed hardware signatures return WARNING');
assert(resMixedHw.warnings.some(w => w.includes('mixed ESC hardware')), 'Flags mixed hardware signatures warning');

// Scenario E: Zero responding ESCs
const resZero = CompatibilityChecker.checkEscs({ expectedCount: 4, escs: [] });
assert(resZero.overallStatus === CompatibilityStatus.INCOMPATIBLE, 'Zero responding ESCs evaluates to INCOMPATIBLE');
assert(resZero.operationAllowed === false, 'Zero responding ESCs denies clearance');

// Scenario F: 6 ESC hexacopter setup support
const escSet6 = [
    { index: 0, version: '32.9', signature: '0x3402' },
    { index: 1, version: '32.9', signature: '0x3402' },
    { index: 2, version: '32.9', signature: '0x3402' },
    { index: 3, version: '32.9', signature: '0x3402' },
    { index: 4, version: '32.9', signature: '0x3402' },
    { index: 5, version: '32.9', signature: '0x3402' }
];
const res6 = CompatibilityChecker.checkEscs({ expectedCount: 6, escs: escSet6 }, { firmwareVersion: '32.9' });
assert(res6.overallStatus === CompatibilityStatus.COMPATIBLE, '6 uniform ESCs evaluate to COMPATIBLE');

// 3. ErrorManager Scope Isolation for ESC Diagnostics
console.log('\n[3] Testing ESC ErrorManager Scoping...');
errorManager.clear(ESC_DIAG_SCOPE);
errorManager.error('ESC_ERR_TEST', Category.PROTOCOL, 'ESC_DIAG', '4-Way ACK failed', null, 'Retry', false, ESC_DIAG_SCOPE);
assert(errorManager.isOperationAllowed({ scope: ESC_DIAG_SCOPE }) === false, 'Blocks operations within ESC_DIAG_SCOPE');
assert(errorManager.isOperationAllowed({ scope: 'FC_DIAGNOSTICS' }) === true, 'Preserves FC_DIAGNOSTICS scope');
errorManager.clear(ESC_DIAG_SCOPE);
assert(errorManager.isOperationAllowed({ scope: ESC_DIAG_SCOPE }) === true, 'Clearing ESC_DIAG_SCOPE restores clearance');

console.log(`\n=== ESC TESTS RESULT: ${passed} PASSED, ${failed} FAILED ===\n`);
if (failed > 0) process.exit(1);
