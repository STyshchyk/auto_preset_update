# NEXT STEPS — Drone Setup Station Implementation Plan

**Current Milestone:** Phase 10 Completed (Automatic Hardware Diagnostics for FC + ESC)  
**Upcoming Milestone:** Phase 11 — UI/UX Redesign & Hardware Representation

---

## Completed in Phase 10
1. **Flight Controller Diagnostic Engine (`js/betaflight/fc_diag.js`):**
   - Implemented `parseFcTelemetry()` parsing firmware name, firmware version, build date, target identifier, physical board name, MCU family/ID, architecture, and craft name.
   - Implemented `runFcDiagnostics()` with serial lock checking, safe CLI lifecycle (`#` -> `version` -> `status` -> `exit`), compatibility evaluation, and error scoping (`FC_DIAG_SCOPE`).
2. **ESC Diagnostic Engine (`js/blheli/esc_diag.js`):**
   - Implemented `KNOWN_ESC_SIGNATURES` mapping bootloader chip signatures (`0x3402`, `0x3401`, `0x3403`, `0x3404`) to MCU models (`STM32G071`, `STM32F051`, `AT32F421`, `GD32E230`).
   - Implemented dynamic channel discovery probing up to configurable channel count (supports quad 4-channel or hex 6-channel setups).
   - Implemented individual per-channel diagnostic result and cross-ESC uniformity evaluation.
3. **Diagnostic Orchestrator (`js/core/diag_orchestrator.js`):**
   - Coordinates end-to-end diagnostics (FC -> ESC) with concurrency protection (`isRunning` guard) and conservative overall summary aggregation.
4. **Integration & Manual Trigger:**
   - Integrated `#btnRunDiagnostics` into `index5.html` and wired event handler in `js/main.js` to trigger non-destructive diagnostics on demand.
5. **Comprehensive Test Suite:**
   - Created `test_fc_diag.js` (23 passing tests), `test_esc_diag.js` (17 passing tests), and `test_orchestrator.js` (12 passing tests). All 121 tests pass across the test suites.

---

## Immediate Next Action: Phase 11 — UI/UX Redesign & Diagnostic Visualizer (EPIC 3)

With hardware diagnostics and compatibility engines fully functional, the next development phase will focus on the UI/UX redesign:

### Task 1: Grey Informational Fields & Hierarchy (`UI-01`, `UI-02`)
* Refine `css/main.css` and `css/components.css` with grey informational panels (`--info-bg: #1c2027`) for passive diagnostic telemetry to distinguish from active controls.
* Introduce high-contrast, large-scale typography for board names, version indicators, and hardware status.

### Task 2: 2D Drone & ESC Hardware Visualizer (`UI-04`)
* Create `js/ui/drone_visualizer.js` to render an interactive 2D quadcopter schematic showing FC at center and ESCs on 4 motor arms with motor rotation indicators and live status badges.

### Task 3: Expected vs Actual Firmware Comparison Table (`UI-05`)
* Create `js/ui/diag_view.js` rendering a side-by-side diagnostic table comparing detected hardware vs expected target, MCU family, and firmware revisions.

### Task 4: Dual Progress Indicators (`UI-06`)
* Implement dual progress bars for high-level workflow steps and low-level byte/block transfers.

---

## Verification Plan for Phase 11
* Visual verification in modern Chromium browser.
* Regression test suite execution (`node test_phase9.js; node test_phase9_audit.js; node test_fc_diag.js; node test_esc_diag.js; node test_orchestrator.js`).
* DOM ID parity check.
