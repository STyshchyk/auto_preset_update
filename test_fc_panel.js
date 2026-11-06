import { updateFcInfoPanel, resetFcInfoPanel, getFcInfoPanelState, ComparisonStatus } from './js/ui/fc_panel.js';

let errors = [];

function assert(cond, msg) {
    if (!cond) {
        errors.push(msg);
        console.error('FAIL:', msg);
    } else {
        console.log('PASS:', msg);
    }
}

// Mock DOM elements
const mockElements = {
    fcPanelConnStatus: { textContent: '', className: '' },
    fcPanelBoardName: { textContent: '' },
    fcPanelStack: { textContent: '' },
    fcPanelVersion: { textContent: '' },
    fcPanelTarget: { textContent: '' },
    fcPanelMcu: { textContent: '' },
    fcPanelBuildDate: { textContent: '' },
    fcPanelPresetName: { textContent: '' },
    fcPanelCompStatus: { textContent: '', className: '', classList: { add(c) { mockElements.fcPanelCompStatus.className += ' ' + c; } } },
    fcPanelTotalParams: { textContent: '' },
    fcPanelMatchCount: { textContent: '' },
    fcPanelDiffCount: { textContent: '' },
    fcPanelUnverifiedCount: { textContent: '' }
};

globalThis.document = {
    getElementById(id) {
        return mockElements[id] || null;
    }
};

console.log('--- Testing FC Panel UI Data Model ---');

// 1. Initial Reset State
resetFcInfoPanel();
const initial = getFcInfoPanelState();
assert(initial.connected === false, 'Initial state should be disconnected');
assert(initial.boardName === 'N/A', 'Initial board name should be N/A');
assert(mockElements.fcPanelBoardName.textContent === 'N/A', 'DOM board name should be N/A');
assert(mockElements.fcPanelConnStatus.className.includes('disconnected'), 'Badge class should be disconnected');

// 2. Updating with Connected Telemetry
updateFcInfoPanel({
    connected: true,
    boardName: 'SPEDIXF722',
    firmwareStack: 'Betaflight',
    firmwareVersion: '4.5.1',
    firmwareTarget: 'SPEDIXF722',
    mcu: 'STM32F7X2',
    buildDate: 'Dec  2 2024'
});

assert(mockElements.fcPanelConnStatus.className.includes('connected'), 'Badge should show connected');
assert(mockElements.fcPanelBoardName.textContent === 'SPEDIXF722', 'Board name should be SPEDIXF722');
assert(mockElements.fcPanelMcu.textContent === 'STM32F7X2', 'MCU should be STM32F7X2');
assert(mockElements.fcPanelVersion.textContent === '4.5.1', 'Version should be 4.5.1');

// 3. Updating Preset Comparison Metrics
updateFcInfoPanel({
    presetName: 'T-System 13',
    comparisonStatus: ComparisonStatus.MATCH,
    totalParams: 42,
    matchCount: 42,
    diffCount: 0,
    unverifiedCount: 0
});

assert(mockElements.fcPanelPresetName.textContent === 'T-System 13', 'Preset name should be T-System 13');
assert(mockElements.fcPanelTotalParams.textContent === 42, 'Total params should be 42');
assert(mockElements.fcPanelMatchCount.textContent === 42, 'Match count should be 42');
assert(mockElements.fcPanelCompStatus.className.includes('match'), 'Comparison badge should have match class');

// 4. Updating Mismatch Status
updateFcInfoPanel({
    comparisonStatus: ComparisonStatus.MISMATCH,
    diffCount: 3
});

assert(mockElements.fcPanelCompStatus.className.includes('mismatch'), 'Comparison badge should have mismatch class');
assert(mockElements.fcPanelDiffCount.textContent === 3, 'Diff count should be 3');

console.log('--- Phase 12A.1: Lifecycle & stale-data ---');
const { mapFcDiagnosticsToPanel, NOT_AVAILABLE, UNKNOWN } = await import('./js/ui/fc_panel.js');

// 5. Disconnect reset clears identity AND comparison results
resetFcInfoPanel();
let s = getFcInfoPanelState();
assert(s.connected === false && s.boardName === NOT_AVAILABLE && s.mcu === NOT_AVAILABLE && s.buildDate === NOT_AVAILABLE, 'Reset clears FC identity to N/A');
assert(s.comparisonStatus === ComparisonStatus.NOT_CHECKED && s.diffCount === 0 && s.matchCount === 0 && s.totalParams === 0, 'Reset clears comparison results');
assert(s.presetName === NOT_AVAILABLE, 'Reset clears preset name');
assert(mockElements.fcPanelCompStatus.className.includes('not-checked'), 'DOM comparison badge back to not-checked');

// 6. Repeated connect/disconnect cycles stay consistent
for (let i = 0; i < 5; i++) {
    updateFcInfoPanel(mapFcDiagnosticsToPanel({ connected: true, boardName: 'B' + i, firmwareName: 'Betaflight', firmwareVersion: '4.5.1', target: 'T', mcu: 'M', buildDate: 'D' }));
    updateFcInfoPanel({ comparisonStatus: ComparisonStatus.MISMATCH, diffCount: i + 1 });
    resetFcInfoPanel();
}
s = getFcInfoPanelState();
assert(s.boardName === NOT_AVAILABLE && s.diffCount === 0 && !s.connected, 'Consistent state after 5 connect/disconnect cycles');

// 7. Missing metadata -> UNKNOWN, no fabricated values
const m = mapFcDiagnosticsToPanel({ connected: true, boardName: 'SPEDIXF722', firmwareName: null, firmwareVersion: null, target: null, mcu: null });
assert(m.firmwareStack === UNKNOWN, 'Missing firmware stack is UNKNOWN (not fabricated "Betaflight")');
assert(m.buildDate === UNKNOWN && m.mcu === UNKNOWN && m.firmwareTarget === UNKNOWN, 'Missing fields are UNKNOWN');
const m2 = mapFcDiagnosticsToPanel({ connected: true, detectedMetadata: { buildDate: 'Dec  2 2024' } });
assert(m2.buildDate === 'Dec  2 2024', 'buildDate falls back to detectedMetadata');

// 8. Failed diagnostics overwrite stale identity
updateFcInfoPanel(mapFcDiagnosticsToPanel({ connected: true, boardName: 'OLDBOARD' }));
updateFcInfoPanel(mapFcDiagnosticsToPanel(null));
assert(getFcInfoPanelState().boardName === NOT_AVAILABLE && !getFcInfoPanelState().connected, 'Null diagnostics clear stale board');
updateFcInfoPanel(mapFcDiagnosticsToPanel({ connected: false, boardName: 'X' }));
assert(getFcInfoPanelState().boardName === NOT_AVAILABLE, 'connected:false result does not display board as current');

// 9. New comparison (CHECKING) zeroes old counts
updateFcInfoPanel({ comparisonStatus: ComparisonStatus.MISMATCH, totalParams: 10, matchCount: 5, diffCount: 3, unverifiedCount: 2 });
updateFcInfoPanel({ comparisonStatus: ComparisonStatus.CHECKING });
s = getFcInfoPanelState();
assert(s.totalParams === 0 && s.matchCount === 0 && s.diffCount === 0 && s.unverifiedCount === 0, 'CHECKING resets counts');
assert(mockElements.fcPanelCompStatus.className.includes('checking'), 'CHECKING badge rendered');

// 10. UNVERIFIED kept separate from mismatches
updateFcInfoPanel({ comparisonStatus: ComparisonStatus.UNVERIFIED, totalParams: 4, matchCount: 2, diffCount: 0, unverifiedCount: 2 });
s = getFcInfoPanelState();
assert(s.diffCount === 0 && s.unverifiedCount === 2, 'Unverified counted separately, not as mismatch');
assert(mockElements.fcPanelCompStatus.className.includes('unverified'), 'UNVERIFIED badge rendered');

if (errors.length === 0) {
    console.log('\n🎉 ALL FC PANEL UNIT TESTS PASSED!');
    process.exit(0);
} else {
    console.error(`\n❌ ${errors.length} test(s) failed.`);
    process.exit(1);
}
