/**
 * Diagnostic Orchestrator Module
 * Coordinates end-to-end non-destructive hardware diagnostics across Flight Controller and ESCs.
 * Ensures strict concurrency safety, reader/writer cleanup, isolated error scoping, and conservative summary aggregation.
 */

import { state } from './state.js';
import { runFcDiagnostics, FC_DIAG_SCOPE } from '../betaflight/fc_diag.js';
import { runEscDiagnostics, ESC_DIAG_SCOPE } from '../blheli/esc_diag.js';
import { errorManager, Category, Severity } from './error_manager.js';
import { CompatibilityStatus } from './compat_checker.js';

export const ORCHESTRATION_SCOPE = 'SYSTEM_DIAGNOSTICS';

/**
 * Diagnostic Orchestrator
 */
export class DiagnosticOrchestrator {
    constructor() {
        this.isRunning = false;
        this.lastSummary = null;
    }

    /**
     * Executes full hardware diagnostics suite (FC + ESCs).
     * @param {Object} [options]
     * @param {Function} [options.log]
     * @param {Object} [options.expectedFc]
     * @param {Object} [options.expectedEsc]
     * @param {number} [options.maxEscChannels=4]
     * @param {boolean} [options.includeEscs=true]
     * @returns {Promise<Object>} Combined Diagnostic Summary
     */
    async runFullDiagnostics(options = {}) {
        const logger = options.log || (() => {});
        const includeEscs = options.includeEscs !== false;

        // Concurrency Guard: Prevent double invocation
        if (this.isRunning) {
            const warnMsg = 'Diagnostics are already running. Concurrent execution prevented.';
            errorManager.warning('DIAG_ALREADY_RUNNING', Category.INTERNAL, 'ORCHESTRATOR', warnMsg, null, 'Wait for active scan to finish', true, ORCHESTRATION_SCOPE);
            return this.lastSummary || {
                overallStatus: CompatibilityStatus.UNKNOWN,
                operationAllowed: false,
                warnings: [warnMsg],
                errors: []
            };
        }

        this.isRunning = true;
        errorManager.clear(ORCHESTRATION_SCOPE);
        logger('\n========================================');
        logger('🔍 ПОЧАТОК ПОВНОЇ АВТОМАТИЧНОЇ ДІАГНОСТИКИ');
        logger('========================================');

        let fcResult = null;
        let escResult = null;

        try {
            // 1. Flight Controller Diagnostics
            logger('\n--- [1/2] Діагностика польотного контролера (FC) ---');
            fcResult = await runFcDiagnostics({
                log: logger,
                expected: options.expectedFc || {}
            });

            // 2. Electronic Speed Controller (ESC) Diagnostics (if FC successfully closed its session)
            if (includeEscs) {
                logger('\n--- [2/2] Діагностика регуляторів обертів (ESC 4-Way) ---');
                escResult = await runEscDiagnostics({
                    log: logger,
                    expected: options.expectedEsc || {},
                    maxChannels: options.maxEscChannels || 4,
                    expectedCount: options.expectedEsc?.expectedCount || 4
                });
            }

            // 3. Aggregate Combined Diagnostic Summary
            this.lastSummary = this.aggregateSummary(fcResult, escResult);

            logger('\n========================================');
            logger(`📋 РЕЗУЛЬТАТ ДІАГНОСТИКИ: [${this.lastSummary.overallStatus}]`);
            logger(`Дозвіл на прошивку: ${this.lastSummary.operationAllowed ? '✅ ДОЗВОЛЕНО' : '❌ ЗАБЛОКОВАНО'}`);
            logger('========================================\n');

            return this.lastSummary;

        } catch (err) {
            errorManager.critical('DIAG_UNCAUGHT_ERR', Category.INTERNAL, 'ORCHESTRATOR', err.message, err, 'Inspect browser serial permissions', ORCHESTRATION_SCOPE);
            this.lastSummary = {
                fc: fcResult,
                esc: escResult,
                overallStatus: CompatibilityStatus.INCOMPATIBLE,
                operationAllowed: false,
                warnings: [],
                errors: [err.message]
            };
            return this.lastSummary;
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Aggregates FC and ESC diagnostic results into a single conservative summary.
     * Rule: Incompatibility in either component sets overall status to INCOMPATIBLE.
     * Rule: Missing critical identification sets overall status to UNKNOWN.
     * Rule: Operation is allowed only when both components are cleared.
     * @param {Object} fc
     * @param {Object|null} esc
     * @returns {Object}
     */
    aggregateSummary(fc, esc = null) {
        const warnings = [];
        const errors = [];

        if (fc) {
            warnings.push(...(fc.warnings || []));
            errors.push(...(fc.errors || []));
        }
        if (esc) {
            warnings.push(...(esc.warnings || []));
            errors.push(...(esc.errors || []));
        }

        let overallStatus = CompatibilityStatus.COMPATIBLE;

        // 1. INCOMPATIBLE Check (Hard blockers)
        if (
            (fc && fc.overallStatus === CompatibilityStatus.INCOMPATIBLE) ||
            (esc && esc.overallStatus === CompatibilityStatus.INCOMPATIBLE) ||
            errors.length > 0
        ) {
            overallStatus = CompatibilityStatus.INCOMPATIBLE;
        }
        // 2. UNKNOWN Check (Missing critical evidence)
        else if (
            (fc && fc.overallStatus === CompatibilityStatus.UNKNOWN) ||
            (esc && esc.overallStatus === CompatibilityStatus.UNKNOWN)
        ) {
            overallStatus = CompatibilityStatus.UNKNOWN;
        }
        // 3. WARNING Check (Non-critical discrepancies)
        else if (
            (fc && fc.overallStatus === CompatibilityStatus.WARNING) ||
            (esc && esc.overallStatus === CompatibilityStatus.WARNING) ||
            warnings.length > 0
        ) {
            overallStatus = CompatibilityStatus.WARNING;
        }

        // Conservative Clearance: Never allow operation if status is INCOMPATIBLE or UNKNOWN
        const fcAllowed = fc ? fc.operationAllowed : true;
        const escAllowed = esc ? esc.operationAllowed : true;
        const operationAllowed = (overallStatus === CompatibilityStatus.COMPATIBLE || overallStatus === CompatibilityStatus.WARNING) && fcAllowed && escAllowed;

        return {
            timestamp: new Date().toISOString(),
            overallStatus,
            operationAllowed,
            fc: fc ? {
                connected: fc.connected,
                target: fc.target,
                boardName: fc.boardName,
                mcu: fc.mcu,
                architecture: fc.architecture,
                firmwareName: fc.firmwareName ?? null,
                firmwareVersion: fc.firmwareVersion,
                buildDate: fc.detectedMetadata?.buildDate ?? null,
                status: fc.overallStatus
            } : null,
            esc: esc ? {
                detectedCount: esc.detectedCount,
                expectedCount: esc.expectedCount,
                uniformity: esc.uniformity,
                respondingMotors: esc.respondingEscs.map(e => e.motor),
                status: esc.overallStatus
            } : null,
            warnings,
            errors,
            criticalBlockers: errorManager.filter({ severity: Severity.CRITICAL })
        };
    }
}

export const diagnosticOrchestrator = new DiagnosticOrchestrator();
