/**
 * Test Suite for Diagnostic Orchestration (js/core/diag_orchestrator.js)
 */

import { DiagnosticOrchestrator, ORCHESTRATION_SCOPE } from './js/core/diag_orchestrator.js';
import { CompatibilityStatus } from './js/core/compat_checker.js';
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

console.log('\n=== RUNNING DIAGNOSTIC ORCHESTRATOR TESTS ===\n');

const orchestrator = new DiagnosticOrchestrator();

// 1. Aggregation Rules: Both FC & ESC Compatible
console.log('[1] Testing Conservative Summary Aggregation...');

const fcComp = {
    connected: true,
    target: 'SPEDIXF722',
    boardName: 'SPEDIXF722',
    mcu: 'STM32F7X2',
    firmwareVersion: '4.5.1',
    overallStatus: CompatibilityStatus.COMPATIBLE,
    operationAllowed: true,
    warnings: [],
    errors: []
};

const escComp = {
    detectedCount: 4,
    expectedCount: 4,
    uniformity: 'UNIFORM',
    respondingEscs: [{ motor: 1 }, { motor: 2 }, { motor: 3 }, { motor: 4 }],
    overallStatus: CompatibilityStatus.COMPATIBLE,
    operationAllowed: true,
    warnings: [],
    errors: []
};

const s1 = orchestrator.aggregateSummary(fcComp, escComp);
assert(s1.overallStatus === CompatibilityStatus.COMPATIBLE, 'Both compatible -> COMPATIBLE');
assert(s1.operationAllowed === true, 'Both cleared -> operationAllowed=true');

// 2. Incompatible FC, Compatible ESC
const fcIncomp = {
    ...fcComp,
    overallStatus: CompatibilityStatus.INCOMPATIBLE,
    operationAllowed: false,
    errors: ['Target mismatch']
};
const s2 = orchestrator.aggregateSummary(fcIncomp, escComp);
assert(s2.overallStatus === CompatibilityStatus.INCOMPATIBLE, 'Incompatible FC -> overall INCOMPATIBLE');
assert(s2.operationAllowed === false, 'Incompatible FC blocks operation clearance');

// 3. Compatible FC, Incompatible ESC (Zero ESCs)
const escIncomp = {
    ...escComp,
    detectedCount: 0,
    overallStatus: CompatibilityStatus.INCOMPATIBLE,
    operationAllowed: false,
    errors: ['No ESCs detected']
};
const s3 = orchestrator.aggregateSummary(fcComp, escIncomp);
assert(s3.overallStatus === CompatibilityStatus.INCOMPATIBLE, 'Compatible FC cannot hide incompatible ESC -> INCOMPATIBLE');
assert(s3.operationAllowed === false, 'Incompatible ESC blocks operation clearance');

// 4. Unknown Hardware Target -> UNKNOWN
const fcUnknown = {
    ...fcComp,
    overallStatus: CompatibilityStatus.UNKNOWN,
    operationAllowed: false
};
const s4 = orchestrator.aggregateSummary(fcUnknown, escComp);
assert(s4.overallStatus === CompatibilityStatus.UNKNOWN, 'Unknown FC target -> overall UNKNOWN');
assert(s4.operationAllowed === false, 'UNKNOWN target strictly blocks operation clearance');

// 5. Warning Discrepancy (Version Drift or Missing 1 ESC)
const escWarn = {
    ...escComp,
    detectedCount: 3,
    overallStatus: CompatibilityStatus.WARNING,
    operationAllowed: true,
    warnings: ['Found 3 of 4 ESCs']
};
const s5 = orchestrator.aggregateSummary(fcComp, escWarn);
assert(s5.overallStatus === CompatibilityStatus.WARNING, 'Warning in ESC -> overall WARNING');
assert(s5.operationAllowed === true, 'Non-critical warning permits operation');

// 6. Concurrency Guard Test
console.log('\n[2] Testing Concurrency Guard...');
orchestrator.isRunning = true;
// Attempt running full diagnostics while isRunning=true
let concurrentWarningRecorded = false;
orchestrator.runFullDiagnostics().then(result => {
    assert(result.operationAllowed === false, 'Concurrent invocation denied');
    assert(errorManager.filter({ source: 'ORCHESTRATOR' }).length > 0, 'Records warning for concurrent run');
    orchestrator.isRunning = false;

    console.log(`\n=== ORCHESTRATOR TESTS RESULT: ${passed} PASSED, ${failed} FAILED ===\n`);
    if (failed > 0) process.exit(1);
});
