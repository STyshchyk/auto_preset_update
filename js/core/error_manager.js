/**
 * Error Manager Module
 * Unified diagnostic, error, and warning management for Flight Controller and ESC operations.
 */

export const Severity = Object.freeze({
    INFO: 'INFO',
    SUCCESS: 'SUCCESS',
    WARNING: 'WARNING',
    ERROR: 'ERROR',
    CRITICAL: 'CRITICAL'
});

export const Category = Object.freeze({
    CONNECTION: 'CONNECTION',
    HARDWARE: 'HARDWARE',
    FIRMWARE: 'FIRMWARE',
    COMPATIBILITY: 'COMPATIBILITY',
    PROTOCOL: 'PROTOCOL',
    VALIDATION: 'VALIDATION',
    FLASHING: 'FLASHING',
    CONFIGURATION: 'CONFIGURATION',
    INTERNAL: 'INTERNAL'
});

export class DiagnosticMessage {
    /**
     * @param {Object} params
     * @param {string} params.code
     * @param {string} params.category
     * @param {string} params.severity
     * @param {string} params.source
     * @param {string} params.message
     * @param {any} [params.details]
     * @param {string} [params.recommendedAction]
     * @param {boolean} [params.recoverable]
     * @param {string} [params.timestamp]
     * @param {string} [params.scope]
     */
    constructor({
        code,
        category,
        severity,
        source,
        message,
        details = null,
        recommendedAction = '',
        recoverable = true,
        timestamp = null,
        scope = 'GLOBAL'
    }) {
        this.code = code || 'GENERIC_MESSAGE';
        this.category = Object.values(Category).includes(category) ? category : Category.INTERNAL;
        this.severity = Object.values(Severity).includes(severity) ? severity : Severity.INFO;
        this.source = source || 'SYSTEM';
        this.message = message || '';
        this.details = details;
        this.recommendedAction = recommendedAction;
        this.recoverable = Boolean(recoverable);
        this.timestamp = timestamp || new Date().toISOString();
        this.scope = scope || 'GLOBAL';
    }
}

export class ErrorManager {
    constructor() {
        /** @type {DiagnosticMessage[]} */
        this.messages = [];
    }

    /**
     * Create and record a diagnostic message.
     * @param {Object} params
     * @returns {DiagnosticMessage}
     */
    record(params) {
        let entry;
        if (params instanceof DiagnosticMessage) {
            entry = params;
        } else {
            entry = new DiagnosticMessage(params);
        }
        this.messages.push(entry);
        return entry;
    }

    /**
     * Shortcut helpers
     */
    info(code, category, source, message, details = null, recommendedAction = '', scope = 'GLOBAL') {
        return this.record({ code, category, severity: Severity.INFO, source, message, details, recommendedAction, recoverable: true, scope });
    }

    success(code, category, source, message, details = null, scope = 'GLOBAL') {
        return this.record({ code, category, severity: Severity.SUCCESS, source, message, details, recoverable: true, scope });
    }

    warning(code, category, source, message, details = null, recommendedAction = '', recoverable = true, scope = 'GLOBAL') {
        return this.record({ code, category, severity: Severity.WARNING, source, message, details, recommendedAction, recoverable, scope });
    }

    error(code, category, source, message, details = null, recommendedAction = '', recoverable = false, scope = 'GLOBAL') {
        return this.record({ code, category, severity: Severity.ERROR, source, message, details, recommendedAction, recoverable, scope });
    }

    critical(code, category, source, message, details = null, recommendedAction = '', scope = 'GLOBAL') {
        return this.record({ code, category, severity: Severity.CRITICAL, source, message, details, recommendedAction, recoverable: false, scope });
    }

    /**
     * Clear messages. If a scope is specified, only messages in that scope are cleared.
     * @param {string} [scope]
     */
    clear(scope = null) {
        if (scope) {
            this.messages = this.messages.filter(m => m.scope !== scope);
        } else {
            this.messages = [];
        }
    }

    /**
     * Retrieve all messages.
     * @returns {DiagnosticMessage[]}
     */
    getAll() {
        return [...this.messages];
    }

    /**
     * Filter messages by severity, category, source, or scope.
     * @param {Object} [filter]
     * @param {string|string[]} [filter.severity]
     * @param {string|string[]} [filter.category]
     * @param {string} [filter.source]
     * @param {string} [filter.scope]
     * @returns {DiagnosticMessage[]}
     */
    filter(filter = {}) {
        return this.messages.filter(msg => {
            if (filter.severity) {
                const sevs = Array.isArray(filter.severity) ? filter.severity : [filter.severity];
                if (!sevs.includes(msg.severity)) return false;
            }
            if (filter.category) {
                const cats = Array.isArray(filter.category) ? filter.category : [filter.category];
                if (!cats.includes(msg.category)) return false;
            }
            if (filter.source && msg.source !== filter.source) {
                return false;
            }
            if (filter.scope && msg.scope !== filter.scope) {
                return false;
            }
            return true;
        });
    }

    /**
     * Check if an operation is allowed to continue.
     * Operations are blocked if any CRITICAL or unrecoverable ERROR messages exist in the relevant scope.
     * @param {Object} [options]
     * @param {boolean} [options.allowRecoverableErrors=false]
     * @param {string} [options.scope]
     * @returns {boolean}
     */
    isOperationAllowed(options = {}) {
        const { allowRecoverableErrors = false, scope = null } = options;
        const targetMessages = scope ? this.messages.filter(m => m.scope === scope) : this.messages;

        const hasCritical = targetMessages.some(m => m.severity === Severity.CRITICAL);
        if (hasCritical) return false;

        const errors = targetMessages.filter(m => m.severity === Severity.ERROR);
        if (errors.length === 0) return true;

        if (allowRecoverableErrors) {
            return errors.every(m => m.recoverable);
        }
        return false;
    }

    /**
     * Generate structured diagnostic summary.
     * @param {string} [scope]
     * @returns {Object}
     */
    getSummary(scope = null) {
        const targetMessages = scope ? this.messages.filter(m => m.scope === scope) : this.messages;
        const total = targetMessages.length;
        const counts = {
            [Severity.INFO]: 0,
            [Severity.SUCCESS]: 0,
            [Severity.WARNING]: 0,
            [Severity.ERROR]: 0,
            [Severity.CRITICAL]: 0
        };

        for (const m of targetMessages) {
            if (counts[m.severity] !== undefined) {
                counts[m.severity]++;
            }
        }

        const operationAllowed = this.isOperationAllowed({ scope });
        const hasBlockers = counts[Severity.CRITICAL] > 0 || (counts[Severity.ERROR] > 0 && !operationAllowed);

        return {
            scope: scope || 'ALL',
            total,
            counts,
            operationAllowed,
            hasBlockers,
            latestMessage: total > 0 ? targetMessages[total - 1] : null
        };
    }
}

// Global default instance for shared usage across modules
export const errorManager = new ErrorManager();
