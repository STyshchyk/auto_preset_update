# PROJECT STATUS — Drone Setup Station Refactoring

**Last Updated:** 2026-11-12  
**Active Entry Point:** `index.html`  
**Refactoring Progress:** Phases 1–19 Completed (Modular Architecture, Multi-Target Safety Guards, 3-State Firmware Recognition & Auto-Skip, Full 256-byte BLHeli_32 Golden EEPROM, COM Port Stabilization, Dual FC & ESC IndexedDB Backup/Restore Engine, Phase 17 Step 3 Motor Direction Testing, Phase 18 Simplified Mode Motor Gating, 5-Step Progression & "Finish Setup" Completion, Phase 19 Simplified Mode Popup Streamlining)  
**Sidebar Architecture:** Split into dedicated Step 1 (FC Telemetry, Verification Icons & Diff) and Step 2 (`#infoCardEsc`, ESC Telemetry & Verification Badges) cards  
**Verification & Safety Protocol:** Full documentation available at `docs/FLASHING_VERIFICATION_PROTOCOL.md`.

---

## 1. Current Implementation State

The application operates as a clean, fully modular single-page application (`index.html`) using browser-native ES Modules, IndexedDB persistence, and Web Serial API.

### Extracted & Active Modules
* **CSS Layer:**
  * `css/main.css`: Core design tokens (`:root`), base layout, two-column/three-column responsive flex container (`.app-layout`, `.sidebar-col`, `.main-col`, `.right-col`), and input styling.
  * `css/components.css`: Step cards, badges, status indicators, grouped toolbars (`.controls-toolbar`, `.controls-group`), buttons, console panel, modal overlays, `.info-card`, `.info-row`, `.info-val-wrap`, `.check-icon`, `.fc-state-pill` (`.state-already-flashed`, `.state-new-hardware`), `.fc-history-pill`, `.mismatch-box`, and `.mismatch-badge`.
* **Core Layer (`js/core/`):**
  * `version.js`: Application version and build date registry (`APP_VERSION`, `APP_BUILD_DATE`, `initVersionBadge`).
  * `state.js`: Centralized shared application state (`port`, `availablePorts`, `escSession`, `lastFcDetails`, `popupTimer`, `ignoreRebootEventsUntil`, `escChecksPassed`).
  * `serial.js`: Web Serial lifecycle with post-reboot port polling (`refreshPortList`, `initSerialEvents`, `resolveSelectedPort`, `closeSerialSession`).
  * `pipeline.js`: One-click automated drone setup conveyor (`runFullDroneSequence`) orchestrating FC flashing, reboot wait stabilization, and ESC configuration.
  * `db.js`: IndexedDB wrapper (Schema v4) managing operational logs (`operations`), FC preset dumps (`fc_preset_dumps`), and ESC preset backups (`esc_preset_dumps`).
* **UI Layer (`js/ui/`):**
  * `log.js`: DOM terminal logging with operation grouping, auto-scroll, and JSON export.
  * `status.js`: Step, FC flash sub-steps, ESC badges, FC state/history badges, and button lock/unlock managers (`setStepStatus`, `setFcSubStep`, `resetFcSubSteps`, `setFcStateBadge`, `setFcHistoryBadge`, `setEscBadge`, `resetAllStepStatuses`, `setAllEscButtons`).
  * `infoPanel.js`: Telemetry sidebar updater (`updateInfoPanel`, `updateEscInfoPanel`, `resetInfoPanel`, `setCheckStatus`) managing FC/ESC telemetry, verification check icons, and automatic flash button safety locking.
  * `modal.js`: Modal dialog management (`showPopup`, `closeModal`) with Simplified Mode popup filtering and single-time operator instruction safety acknowledgment (`ensureInstructionsAcknowledged`).
* **Utilities (`js/utils/`):**
  * `bytes.js`: Delay timer, byte/hex serialization, array comparison, timestamp generation, file download.
  * `crc.js`: CRC-16/CCITT (XMODEM) calculation (`0x1021`, init `0x0000`) and hex formatting.
  * `stats.js`: `localStorage`-backed daily and all-time flashed device counters and new-hardware MCU history registry (`recordDeviceSuccess`, `recordNewHardwareMcu`, `isNewHardwareMcuRecorded`).
* **Betaflight Feature (`js/betaflight/`):**
  * `msp.js`: Dedicated MSPv1 protocol framer (`$M<`), motor PWM throttle control (`setMotorOutputs`), and DShot command passthrough (`sendDshotCommand`).
  * `cli.js`: CLI stream reader (`readCliResponse` with prompt detection) and board target parser (`parseBoardName`).
  * `info.js`: Telemetry parser (`parseFcDetails`), preset diff analyzer (`extractConfigVariables`, `calculateMismatch`), and 3-state firmware recognition engine (`detectFcState`).
  * `preset.js`: Flash preset execution (`flashBetaflightPreset`), clean factory flashing (`flashCleanFcPreset`), file restore (`restoreFcFromFile`), DB restore (`restoreFcDumpFromDb`), export (`exportNewHwDumpFromDb`), and expert 3-way preset comparison (`comparePresetWithFc`).
  * `backup.js`: Flight controller configuration backup (`backupBetaflightConfig`).
* **Motor Direction & Testing Feature (`js/motors/`):**
  * `test.js`: Step 3 interactive testing engine (`spinAllMotors`, `stopAllMotors`, `toggleMotorDirection`, `saveMotorDirections`, `initMotorControls`, live speed slider synchronization).
* **BLHeli_32 Feature (`js/blheli/`):**
  * `protocol.js`: MSPv1 framing (`sendMsp`), low-level 4-Way protocol (`read4WayRaw`, `send4WayCmd`), FC 4-Way mode setup (`init4WayInterface` with 400ms/500ms stabilization delays), and retry-resilient device connection (`connectEscDevice` with 3-attempt handshake + `CMD_DEVICE_RESET`, `disconnectEscDevice`).
  * `session.js`: Dedicated 4-Way session management (`connectEscSession`, `disconnectEscSession`, `isEscSessionActive`) with hardened disconnect state cleanup.
  * `eeprom.js`: Session lifecycle wrapper (`withEscSession`), 256-byte block reader with CRC retries (`readEscBlock`), and full 4-ESC settings readout handler (`readAllEscSettings`).
  * `preset.js`: Golden 256-byte reference EEPROM container (`BL32_GOLDEN_PRESET_256`, CRC16 `0xbc05`, MCU `0x4706`), Bluejay 8-bit safety abort, automatic pre-flash IndexedDB backup (`saveEscBackupToDb`), full 256-byte page overwriting (`0xF800`), and post-flash CRC-16 readback verification (`applyEscPreset`).
  * `backup.js`: Raw backup format serializer (`buildBackupObject`), JSON schema/checksum validator (`parseEscBackup`), file backup/restore (`backupAllEscs`, `triggerRestoreFileSelect`, `handleRestoreFileChange`), and IndexedDB export/restore (`exportEscBackupFromDb`, `restoreEscFromDb`).
* **Main Bootstrap Entry (`js/main.js`):**
  * Single application bootstrap wiring serial listeners, mode toggling, statistics, and DOM events across all Step 1, Step 2, Console, and Pipeline controls.
* **Hosting & Deployment Config:**
  * `netlify.toml`: Redirect rules serving `index.html`.
  * `vercel.json` & `.github/workflows/vercel-deploy.yml`: Vercel static deployment routing and automated GitHub Actions CI/CD workflows for `main` (production) and `develop` (preview).

---

## 2. Latest Updates (2026-11-12)

* **Application Version Indicator & Auto-Increment CI/CD Workflow (`js/core/version.js`, `index.html`, `css/components.css`, `js/main.js`, `.github/workflows/vercel-deploy.yml`)**:
  - Implemented centralized version tracking module `js/core/version.js` (`APP_VERSION`, `APP_BUILD_DATE`, `initVersionBadge()`).
  - Added `#appVersionBadge` inside `.top-bar` on the far left before the device selector, styled with `.version-badge` pill style and hover tooltip.
  - Configured GitHub Actions CI/CD step in `vercel-deploy.yml` on push/merge to `main` to automatically bump `v1.0.${{ github.run_number }}` with the current date, committing back to `main` with `[skip ci]` so that both Vercel and GitHub Pages are continuously synchronized.

* **Entry Point Consolidation & Deployment Configuration (`index.html`, `vercel.json`, `.github/workflows/vercel-deploy.yml`)**:
  - Renamed primary entry point from `index5.html` to standard `index.html` across codebase, `.gitignore`, `netlify.toml`, and project documentation.
  - Configured `vercel.json` clean URLs/rewrites and GitHub Actions Vercel deployment pipeline (`main` production, `develop` preview).

* **Target Betaflight Preset Calibration (`index.html`)**:
  - Updated embedded FC target preset (`#presetInput`, target `SPEDIXF722`):
    - Updated `mcu_id` (`0023003e3036510834323839`), `pilot_name = IF SEEN, NO BOOM`, and `aux 3 40 1 1700 2100 0 0`.
    - Updated battery protection thresholds: `vbat_min_cell_voltage = 260`, `vbat_warning_cell_voltage = 300`.
    - Updated OSD layout element coordinates and removed `beacon RX_LOST`.

* **Phase 16: Automated ESC IndexedDB Backup & Instant Restore Engine (`js/core/db.js`, `js/blheli/preset.js`, `js/blheli/backup.js`, `index.html`, `js/main.js`, `js/ui/status.js`)**:
  - Upgraded IndexedDB schema to version 4 with dedicated object store `esc_preset_dumps` keyed by FC `mcuId`.
  - Added automatic backup creation during `applyEscPreset()`: captures original 256-byte blocks of all 4 ESCs with CRC verification and writes to `esc_preset_dumps` under the FC's `mcuId` before applying any flash changes.
  - Implemented «📥 Експорт з БД» (`exportEscBackupFromDb()`): exports stored ESC backup directly from IndexedDB into a valid JSON file.
  - Implemented «🔄 Відновити з БД» (`restoreEscFromDb()`): flashes original ESC settings back from IndexedDB, preceded by a safety confirmation dialog displaying MCU ID, byte size, date, LiPo requirement, and propeller removal warnings.
  - Grouped Step 2 Expert controls into 4 structured toolbars (Сесія, Прошивка, База дампів, Файли) and integrated button state management in `comparePresetWithFc()` and `setAllEscButtons()`.

* **Phase 15: Pipeline COM Port Stabilization & ESC Bootloader Retry Engine (`js/core/pipeline.js`, `js/core/serial.js`, `js/blheli/protocol.js`)**:
  - Increased automated conveyor reboot wait time: 5.0 seconds after FC `save` and 2.5 seconds after `exit` (skip mode) ensuring complete USB/UART re-enumeration.
  - Implemented automatic retry polling (5 attempts x 400ms) in `resolveSelectedPort()` before prompting the user with `requestPort()`, preventing unwanted device selection dialogs when COM port temporarily drops during reboot.
  - Added robust 3-attempt handshake loop with 250ms spacing and `CMD_DEVICE_RESET` re-trigger in `connectEscDevice()` to eliminate transient `0x0F` (`ACK_D_GENERAL_ERROR`) failures on ESC #1.
  - Increased post-MSP 245 UART muxing delay to 400ms and post-`CMD_INTERFACE_SET_MODE` pause to 500ms before querying ESC channels.

* **Phase 14: BLHeli_32 Full 256-Byte Golden EEPROM Container & Strict Verification (`js/blheli/preset.js`, `js/blheli/eeprom.js`, `js/blheli/session.js`, `docs/FLASHING_VERIFICATION_PROTOCOL.md`)**:
  - Integrated `BL32_GOLDEN_PRESET_256` (512 hex characters / 256 bytes, CRC16 `0xbc05`, target MCU `0x4706`).
  - Switched `applyEscPreset()` from partial 24-byte patching to writing the full monolithic 256-byte cryptographic EEPROM container (`0xF800`) across all 4 ESCs (accounting for rolling encryption of page `0xF800` in MCU `0x4706`).
  - Fixed ASCII model name scanning: removed `|| str.includes('_')` in `preset.js` and `eeprom.js` to eliminate false positives from encrypted byte values (`0x5F`).
  - Phase 3 post-flash verification: full 256-byte readback per ESC verifying bootloader reboot responsiveness and CRC-16 integrity.
  - Hardened ESC session disconnect (`disconnectEscSession()`): sets `state.escSession.isConnected = false` immediately upon entering the `try` block before dispatching `CMD_INTERFACE_EXIT`, guaranteeing UI buttons `#btnConnectESC` / `#btnDisconnectESC` remain responsive.

* **FC 3-State Firmware Recognition & Dual Dump IndexedDB Store (`js/core/db.js`, `js/betaflight/info.js`, `js/betaflight/preset.js`, `index.html`, `css/components.css`)**:
  - Upgraded IndexedDB schema to version 3 with dedicated store `fc_preset_dumps` (`targetType: 'FLIGHT_CONTROLLER'`).
  - Implemented 3-state baseline recognition (`detectFcState`):
    1. **`ALREADY_FLASHED`**: 0% diff against preset. Displays `⚡ Вже прошитий`, skips redundant flash writes.
    2. **`CLEAN`**: Matches clean baseline dump (ignoring accelerometer calibration). Proceeds directly to standard flashing.
    3. **`NEW_HARDWARE`**: Neither clean nor flashed. Displays amber badge `⚠️ Нове обладнання`, triggers warning popup, tracks `NEW_HARDWARE` history (`#fcHistoryBadge`, `#statDailyNewHw`, `#statAllNewHw`), and automatically backs up both `diff all` and `dump all` to IndexedDB.
  - Added Step 1 Expert controls grouped into 3 toolbars (Прошивка, База дампів, Бекап): `#btnComparePreset`, `#btnFlashCleanFC`, `#btnExportNewHwDump`, `#btnRestoreDiffFromDb`, `#btnRestoreDumpFromDb`, `#btnRestoreFCFromFile`. Removed defunct `#btnSkipToEsc`.

* **Phase 20: Simplified Mode 1-Viewport & Low-Strain UI Refinement (`index.html`, `css/components.css`, `js/main.js`)**:
  - Removed `125%` global font scaling in `body.simplified-mode` and tightened layout/card spacing with calm high-contrast slate surfaces (`#161a22`, `#252c3a`) so the entire 3-column workflow fits within a single desktop viewport.
  - Streamlined Step 1 & Step 2 into compact status bars (hiding `CLI Engine`, `MSP 4-Way Interface`, `#fcFlashProgress`, and `#escFlowPipeline` in Simplified Mode while keeping `#fcStateBadge`, `#fcHistoryBadge`, `#badgeEscAlreadyFlashed`, `#stepStatus1..3`, and inline `#badgeEsc0..3` pills visible).
  - Made Step 3 (Motors) the largest centerpiece with cleaner QuadX motor pods, larger `Реверс` buttons, and a unified 3-button action bar (`▶ Пуск усіх моторів`, `⏹ Зупинити всі`, `🏁 Завершити налаштування`).
  - Slimmed Left Sidebar FC/ESC info cards (4 critical rows each) and moved the verbose `.faq-card` behind an on-demand `? Допомога` button (`#btnOpenFaq`) and modal (`#faqModal`) in `.top-bar`.
  - Streamlined Right Sidebar Progression timeline (hiding `.step-subtitle` in Simplified Mode, compacting `#progBanner` and `.stats-card`).
  - Expert Mode left untouched for debugging.

* **Phase 19: Simplified Mode Popup Streamlining (`js/ui/modal.js`, `js/motors/test.js`)**:
  - Implemented automatic popup suppression in `showPopup()` whenever `.simplified-mode` is active on `document.body`.
  - All intermediate notifications during Step 1 (FC pre-checks, auto-skip, new hardware warning, flash success) and Step 2 (ESC connections, preset application, and status popups) are cleanly suppressed so the one-click conveyor runs seamlessly.
  - Suppressed popup callbacks are executed immediately to preserve state flow and logging.
  - Granted `{ allowInSimplified: true }` solely to the final «🏁 Завершити налаштування» button in `saveMotorDirections()`, configured with a 1-second auto-close timer (`autoCloseTimeMs = 1000`) in Simplified Mode for quick, unobtrusive completion feedback.
  - In Expert Mode, all modal popups and intermediate step notifications remain fully functional with manual closure.

* **Phase 18: Simplified Mode Motor Workflow, 5-Point Progression & "Finish Setup" Completion (`index.html`, `css/components.css`, `js/motors/test.js`, `js/core/pipeline.js`, `js/ui/progression.js`, `js/main.js`)**:
  - **Propeller Interlock Streamlining**: In Simplified Mode, `.safety-box` is hidden via CSS (`display: none !important`), and propeller removal is permanently treated as confirmed (`motorState.propellersRemovedConfirmed = true`). In Expert Mode, the safety box and checkbox remain active as an explicit operator interlock.
  - **Step 3 Buttons Gating**: Motor action buttons (`#btnSpinAllMotors`, `#btnStopAllMotors`, `#btnRevMotor1..4`, `#btnSaveMotorDirections`, `#throttleSlider`) are disabled in Simplified Mode until Step 2 (ESC setup) completes.
  - **5-Point Progression Timeline**: Added 5th stage (`#progStep5`: `5. Налаштування моторів`). After ESC flashing completes, Stage 4 marks `success` and Stage 5 activates as `working` (`⚙️ Налаштування моторів...`).
  - **"Finish Setup" Run Completion**: Renamed `#btnSaveMotorDirections` to `🏁 Завершити налаштування`. Clicking this button saves motor directions into ESC EEPROM, cleanly disconnects the port and drone, resets Step 3 buttons to inactive, marks Step 5 as `success`, updates the overall progression banner, and registers the completed run in daily/all-time device statistics (`recordDeviceResult`).
  - **Auto-Start Motors at Step 3**: In the automated conveyor pipeline, once Step 2 finishes, motors start automatically on safe idle throttle without requiring manual clicking.
  - **Operator FAQ & Instructions**: Updated Section 2 («Під час прошивки») and Section 3 («Після прошивки») describing the 5-point setup and the auto-start motor verification step.
