# PROJECT STATUS — Drone Setup Station Refactoring & Firmware Station

**Last Updated:** 2026-11-06  
**Active Entry Point:** `index5.html`  
**Refactoring Progress:** Phases 1–8 Completed  
**Core Validation Progress:** Phases 9 & 9.1 Completed  
**Hardware Diagnostics Progress:** Phase 10 Completed  
**Pre-flash Preset Validation:** Completed  
**FC Info Panel UI:** Phase 12A Completed  
**FC Preset Comparison Engine:** Phase 12B Completed  
**Upcoming Milestone:** Phase 13 — Simplified Mode / Expert Mode Toggle

---

## 1. Current Implementation State

The application is completely modularized with native ES Modules, zero inline scripts in `index5.html`, a hardened validation engine, and full automatic hardware diagnostics for both Flight Controller and ESCs:

### Core Layer (`js/core/`)
* `state.js`: Centralized shared application state (`port`, `availablePorts`, `popupTimer`, `ignoreRebootEventsUntil`).
* `serial.js`: Web Serial lifecycle (`refreshPortList`, `initSerialEvents`, `resolveSelectedPort`, `closeSerialSession`).
* `error_manager.js`: Unified diagnostic reporting with severity levels, category taxonomy, operation clearance checks, and scoped message management.
* `firmware_validator.js`: Universal Intel HEX and raw binary parser with explicit ARM MCU profiles (`STM32F405RG`, `STM32F722RE`, `STM32H743VI`, `STM32G071KB`, `AT32F421K8`), vector table alignment/Thumb checking, and multi-tier evidence classification.
* `compat_checker.js`: Compares detected FC/ESC hardware against expected targets and presets, flagging non-uniform ESC channels by name and enforcing conservative clearance.
* `diag_orchestrator.js`: Coordinates non-destructive hardware diagnostics across FC and ESCs. Enforces concurrency protection (`isRunning` guard), reader/writer cleanup, isolated error scoping (`ORCHESTRATION_SCOPE`), and conservative summary aggregation.

### Features & Protocol Layers
* **Betaflight Feature (`js/betaflight/`):**
  * `cli.js`: CLI stream reader (`readCliResponse` with prompt detection) and board target parser (`parseBoardName` prioritizing `board_name` and negative lookahead for `manufacturer_id`).
  * `fc_diag.js`: Non-destructive FC diagnostic scanner. Parses running firmware name, version, build date, target identifier, physical board name, MCU family/ID, architecture (e.g. `Cortex-M7 (ARMv7E-M)`), and craft name from `version` and `status` outputs.
  * **`preset_validator.js` (Pre-flash Preset Validation):** Read-only configuration comparator. Reads current effective configuration (`dump all`), parses expected preset settings (`set`, `feature`, `resource`, `aux`), compares values, reports `PASS — Configuration already matches the selected preset` (preventing unnecessary flashing) or `ERROR — Configuration mismatch` (listing differing parameters with current vs expected values), and marks unverified parameters as `UNKNOWN / UNVERIFIED` without false errors.
  * `preset.js`: Pre-flash preset validation check integrated into `#btnFlashFC`; bypasses write if configuration already matches.
  * `backup.js`: Flight controller configuration backup (`backupBetaflightConfig`).
* **BLHeli_32 Feature (`js/blheli/`):**
  * `protocol.js`: MSPv1 framing, low-level 4-Way protocol, FC 4-Way mode setup, and device connection/disconnection.
  * `esc_diag.js`: Non-destructive dynamic ESC diagnostic scanner probing channels 0..3 (or up to 8), mapping signatures to MCU models, and running cross-ESC uniformity checks.
  * `eeprom.js`: High-level EEPROM session management (`withEscSession`), 256-byte reading with 3 retry attempts (`readEscBlock`), and read handler (`readAllEscSettings`).
  * `backup.js`: Raw JSON backup generation, schema and checksum parsing, and safe two-phase restore workflow with pre-restore backup and post-write verification.
  * `preset.js`: Motor direction detection, dummy preset binary blocks, and binary preset patching, preserving 232 calibration bytes.

---

## 2. Verification Performed

* **Automated Test Suites (149 passing assertions):**
  - `test_phase9.js`: 40 unit test assertions (100% pass rate).
  - `test_phase9_audit.js`: 29 safety audit assertions (100% pass rate).
  - `test_fc_diag.js`: 23 FC diagnostic & telemetry assertions (100% pass rate).
  - `test_esc_diag.js`: 17 ESC diagnostic & multi-channel assertions (100% pass rate).
  - `test_orchestrator.js`: 12 orchestration & aggregation assertions (100% pass rate).
  - `test_preset_validator.js`: 28 preset parsing, diff comparison, and unverified parameter assertions (100% pass rate).
