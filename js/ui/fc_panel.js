/**
 * FC Info & Preset Comparison Panel UI Component
 * Renders and updates the compact Flight Controller telemetry and preset comparison view.
 * Display-only: never opens serial connections or performs comparisons itself.
 */

export const ComparisonStatus = {
    NOT_CHECKED: 'NOT CHECKED',
    CHECKING: 'CHECKING',
    MATCH: 'MATCH',
    MISMATCH: 'MISMATCH',
    UNVERIFIED: 'UNVERIFIED'
};

/** Shown when no FC is connected / no data has been collected. */
export const NOT_AVAILABLE = 'N/A';
/** Shown when an FC responded but a specific field could not be determined. */
export const UNKNOWN = 'UNKNOWN';

const COUNT_KEYS = ['totalParams', 'matchCount', 'diffCount', 'unverifiedCount'];

const DEFAULT_FC_DATA = Object.freeze({
    connected: false,
    boardName: NOT_AVAILABLE,
    firmwareStack: NOT_AVAILABLE,
    firmwareVersion: NOT_AVAILABLE,
    firmwareTarget: NOT_AVAILABLE,
    mcu: NOT_AVAILABLE,
    buildDate: NOT_AVAILABLE,
    presetName: NOT_AVAILABLE,
    comparisonStatus: ComparisonStatus.NOT_CHECKED,
    totalParams: 0,
    matchCount: 0,
    diffCount: 0,
    unverifiedCount: 0
});

let currentPanelState = { ...DEFAULT_FC_DATA };

/**
 * Maps an FC diagnostic summary (diag_orchestrator `summary.fc`) to panel fields.
 * Missing values become UNKNOWN when connected, N/A otherwise. No values are invented.
 * @param {Object|null} fc
 * @returns {Object}
 */
export function mapFcDiagnosticsToPanel(fc) {
    if (!fc || !fc.connected) {
        return {
            connected: false,
            boardName: NOT_AVAILABLE,
            firmwareStack: NOT_AVAILABLE,
            firmwareVersion: NOT_AVAILABLE,
            firmwareTarget: NOT_AVAILABLE,
            mcu: NOT_AVAILABLE,
            buildDate: NOT_AVAILABLE
        };
    }
    const v = (x) => (x === null || x === undefined || x === '' ? UNKNOWN : String(x));
    return {
        connected: true,
        boardName: v(fc.boardName),
        firmwareStack: v(fc.firmwareName),
        firmwareVersion: v(fc.firmwareVersion),
        firmwareTarget: v(fc.target),
        mcu: v(fc.mcu),
        buildDate: v(fc.buildDate ?? fc.detectedMetadata?.buildDate)
    };
}

/**
 * Updates the FC Information & Preset Comparison Panel DOM elements.
 * Transitioning to CHECKING or NOT_CHECKED zeroes any counts not supplied in the same update,
 * so a new comparison never shows stale counts.
 * @param {Partial<typeof DEFAULT_FC_DATA>} data
 */
export function updateFcInfoPanel(data = {}) {
    const next = { ...currentPanelState, ...data };
    if (data.comparisonStatus === ComparisonStatus.CHECKING || data.comparisonStatus === ComparisonStatus.NOT_CHECKED) {
        for (const k of COUNT_KEYS) {
            if (!(k in data)) next[k] = 0;
        }
    }
    currentPanelState = next;

    // Section 1: FC Details
    const fcConnBadge = document.getElementById('fcPanelConnStatus');
    const setText = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val ?? NOT_AVAILABLE;
    };

    if (fcConnBadge) {
        if (currentPanelState.connected) {
            fcConnBadge.textContent = '● Підключено';
            fcConnBadge.className = 'fc-conn-badge connected';
        } else {
            fcConnBadge.textContent = '○ Відключено';
            fcConnBadge.className = 'fc-conn-badge disconnected';
        }
    }

    setText('fcPanelBoardName', currentPanelState.boardName);
    setText('fcPanelStack', currentPanelState.firmwareStack);
    setText('fcPanelVersion', currentPanelState.firmwareVersion);
    setText('fcPanelTarget', currentPanelState.firmwareTarget);
    setText('fcPanelMcu', currentPanelState.mcu);
    setText('fcPanelBuildDate', currentPanelState.buildDate);

    // Section 2: Preset Comparison
    setText('fcPanelPresetName', currentPanelState.presetName);
    setText('fcPanelTotalParams', currentPanelState.totalParams ?? 0);
    setText('fcPanelMatchCount', currentPanelState.matchCount ?? 0);
    setText('fcPanelDiffCount', currentPanelState.diffCount ?? 0);
    setText('fcPanelUnverifiedCount', currentPanelState.unverifiedCount ?? 0);

    const compStatusBadge = document.getElementById('fcPanelCompStatus');
    if (compStatusBadge) {
        compStatusBadge.className = 'status-pill';
        switch (currentPanelState.comparisonStatus) {
            case ComparisonStatus.CHECKING:
                compStatusBadge.textContent = '⏳ Перевірка...';
                compStatusBadge.classList.add('checking');
                break;
            case ComparisonStatus.MATCH:
                compStatusBadge.textContent = '✅ Збігається (MATCH)';
                compStatusBadge.classList.add('match');
                break;
            case ComparisonStatus.MISMATCH:
                compStatusBadge.textContent = '❌ Не збігається (MISMATCH)';
                compStatusBadge.classList.add('mismatch');
                break;
            case ComparisonStatus.UNVERIFIED:
                compStatusBadge.textContent = '⚠️ Не перевірено (UNVERIFIED)';
                compStatusBadge.classList.add('unverified');
                break;
            case ComparisonStatus.NOT_CHECKED:
            default:
                compStatusBadge.textContent = 'Не перевірено';
                compStatusBadge.classList.add('not-checked');
                break;
        }
    }
}

/**
 * Resets the FC Information Panel back to initial empty state
 * (clears FC identity AND preset comparison results).
 */
export function resetFcInfoPanel() {
    currentPanelState = { ...DEFAULT_FC_DATA };
    updateFcInfoPanel({});
}

/**
 * Returns current snapshot of panel state.
 */
export function getFcInfoPanelState() {
    return { ...currentPanelState };
}
