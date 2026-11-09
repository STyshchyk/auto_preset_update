# PROJECT STATUS — Drone Setup Station Refactoring

**Last Updated:** 2026-11-09  
**Active Entry Point:** `index5.html`  
**Refactoring Progress:** Phases 1–10 Completed (100% Modular ES Architecture, Zero Inline JavaScript)  
**Sidebar Architecture:** Split into dedicated Step 1 (FC Telemetry, Unique Device ID & Diff) and Step 2 (`#infoCardEsc`, BLHeli_32 Live Status) cards  
**Simplified Mode & Progression Engine:** Unified one-click master action button, 125% font scaling, timeline progression report, FAQ, and daily/all-time device statistics by unique hardware UID.

---

## 1. Current Implementation State

The application operates as a clean, fully modular single-page application (`index5.html`) using browser-native ES Modules and Web Serial API.

### Extracted & Active Modules
* **CSS Layer:**
  * `css/main.css`: Core design tokens (`:root`), base layout, two-column flex container (`.app-layout`, `.sidebar-col`, `.main-col`), responsive breakpoints, and input styling.
  * `css/components.css`: Step cards, badges, status indicators, buttons, console panel, modal overlays, `.info-card`, `.info-row`, `.mismatch-box`, and `.mismatch-badge` with adaptive color states.
* **Core Layer (`js/core/`):**
  * `state.js`: Centralized shared application state (`port`, `availablePorts`, `popupTimer`, `ignoreRebootEventsUntil`).
  * `serial.js`: Web Serial lifecycle (`refreshPortList`, `initSerialEvents`, `resolveSelectedPort`, `closeSerialSession`).
* **UI Layer (`js/ui/`):**
  * `log.js`: DOM terminal logging with automatic auto-scroll.
  * `status.js`: Step and ESC badge visual updates (`setStepStatus`, `setEscBadge`, `resetAllStepStatuses`, `setAllEscButtons`).
  * `infoPanel.js`: Telemetry sidebar updater (`updateInfoPanel`, `resetInfoPanel`) managing FC board telemetry and mismatch indicators.
  * `modal.js`: Modal dialog management with auto-close and callback execution (`showPopup`, `closeModal`).
* **Utilities (`js/utils/`):**
  * `bytes.js`: Delay timer, byte/hex serialization, array comparison, timestamp generation, file download.
  * `crc.js`: CRC-16/CCITT (XMODEM) calculation (`0x1021`, init `0x0000`) and hex formatting.
* **Betaflight Feature (`js/betaflight/`):**
  * `cli.js`: CLI stream reader (`readCliResponse` with prompt detection) and board target parser (`parseBoardName`).
  * `info.js`: Telemetry parser (`parseFcDetails` for target, firmware, date, MCU) and preset diff analyzer (`extractConfigVariables`, `calculateMismatch`).
  * `preset.js`: Flash preset execution (`flashBetaflightPreset`) with on-click-only telemetry & `diff all` mismatch calculation, abort-on-error, and optimized streaming rate (`delay(35)` + fast check).
  * `backup.js`: Flight controller configuration backup (`backupBetaflightConfig`).
* **BLHeli_32 Feature (`js/blheli/`):**
  * `protocol.js`: MSPv1 framing (`sendMsp`), low-level 4-Way protocol (`read4WayRaw`, `send4WayCmd`), FC 4-Way mode setup (`init4WayInterface`), and device connection/disconnection (`connectEscDevice`, `disconnectEscDevice`).
  * `eeprom.js`: Session lifecycle wrapper (`withEscSession`), 256-byte block reader with CRC retries (`readEscBlock`), and full 4-ESC settings readout handler (`readAllEscSettings`).
  * `preset.js`: Preset constants (`BL32_PRESET_SETTINGS`, normal/reversed headers), motor rotation detection (`detectMotorDirection`), and 4-ESC preset flasher preserving 232 calibration bytes (`applyEscPreset`).
  * `backup.js`: Raw backup format serializer (`buildBackupObject`), JSON schema/checksum validator (`parseEscBackup`), backup generator (`backupAllEscs`), and two-phase restore handler (`triggerRestoreFileSelect`, `handleRestoreFileChange`).
* **Main Bootstrap Entry (`js/main.js`):**
  * Single application bootstrap wiring serial listeners and DOM events to buttons (`btnFlashFC`, `btnBackup`, `btnSkipToEsc`, `btnReadESC`, `btnBackupESC`, `btnRestoreESC`, `fileRestoreESC`, `btnConfigureESC`, `modalCloseBtn`).
  * Exposes `window.closeModal = closeModal`.

---

## 2. Recent Feature Additions (Telemetry & ESC Info Integration)

* **Left Info Panel UI (Розділено на Крок 1 та Крок 2):**
  * **Картка Крок 1 (Flight Controller & Preset):**
    * Параметри FC: Target / Board Name, Firmware Version, Build Date & Time, MCU Type.
    * Mismatch Box: % Mismatch із кольоровим бейджем (`match-exact` 0%, `match-low-diff` $\le 30\%$, `match-high-diff` $> 30\%$) та лічильник змінних.
  * **Картка Крок 2 (`#infoCardEsc`, BLHeli_32 Регулятори):**
    * Модель ESC та відкрита текстова назва прошивки.
    * MCU ESC та апаратна сигнатура (наприклад, `STM32G071 (0x0460)`).
    * Живлення та статус ACK (`OK (4/4 LiPo є)` / `Частково` / `Fail`).
    * Напрямок обертання та стан пресету для кожного мотора (`#1..#4: N/R (100% / Stock)`).
    * Підсумкова відповідність пресету 100% (`Застосовано (4/4)` / `Потрібен запис`).
- Strict Target Verification: Added an immediate abort check in `flashBetaflightPreset` if the FC target board cannot be detected (`actualBoard === null`/`UNKNOWN`).
* **Strict On-Click Security Rule:**
  * No COM port access or polling occurs before the user explicitly clicks «Залити пресет у FC» or «Зчитати налаштування ESC».
* **One-Click Instant Execution:**
  * Removed redundant confirmation dialog (`window.confirm`) from «⚡ Застосувати пресет до 4 ESC» for streamlined zero-friction operation.
  * Live status and telemetry refresh dynamically during Phase 1 (pre-read) and Phase 2 (post-write).
* **Preset Comparison Engine:**
  * Uses `diff all` to capture complete parameters across all PID and Rate profiles.
  * Inspects exclusively variables defined in the preset (ignoring non-preset flight controller settings).
  * Evaluates missing variables or altered values as mismatches.
  * Instant loop termination on prompt `#` prevents CLI read freezes, and high-speed UART streaming ensures rapid preset execution without latency regressions.

---

## 3. Verification Performed

* **Syntax & Module Validation:** All `.js` modules and bootstrap code verified via Node.js syntax checks (`node --check`).
* **Clean HTML Entry Point:** `index5.html` contains 0 inline JavaScript lines and loads modules via `<script type="module" src="./js/main.js"></script>`.
* **Telemetry & Mismatch Logic Tests:** Tested against multi-line version outputs and diff dumps; verified exact match yields 0% mismatch.
* **Execution Latency:** Verified CLI flashing throughput retains rapid execution without blocking waits.


---

## 3. Latest Session Updates (2026-11-09)
* **ESC Direction Control:** Forced all 4 ESCs to flash with NORMAL direction header (BL32_HEADER_NORMAL_100 = `90 BD 5D F6 AA 06 4C 53`) in index5.html.
* **Betaflight CLI Preset:** Replaced default <textarea id="presetInput"> content with the defaults nosave SPEDIXF722 batch script (craft name T-System 15).
* **Session Documentation:** Created docs/JOB_SUMMARY_2026_11_09.md detailing dump byte mapping, CRC16 verification, and reasoning.

## 4. Simplified Mode & Progression Engine Status (2026-11-09)
* **Mode Toggle & Ergonomics**:
  - Top bar switch: `⚡ Спрощений режим ⇄ ⚙️ Експертний режим` (preference persisted in `localStorage`).
  - Font scaling by **125%** for high visibility at assembly stations.
  - Automatically hides expert controls: preset `<textarea>`, backup dropdown/buttons, skip buttons, manual ESC operations, and raw terminal log.
* **Unified Sequential Flashing Pipeline (`js/core/pipeline.js`)**:
  - Single-click master action button: «🚀 ПРОШИТИ ДРОН (FC + ESC)».
  - Step 1 (Betaflight preset flashing & telemetry parsing) ➔ 3.5s reboot delay & dynamic port re-enumeration ➔ Step 2 (BLHeli_32 4 ESC 100% preset configuration).
* **Hardware Unique ID (`mcu_id`) & Telemetry Verification**:
  - Direct execution of `mcu_id` CLI command extracts full hardware hex UID (e.g. `0x0026001e3036510834323839`).
  - Added `#infoDeviceId` row in the Left Panel under FC Parameters.
* **LiPo Voltage Pre-Check**:
  - Parses `Voltage:` from Betaflight `status` output. In simplified mode, immediately halts if battery is missing (`NOT PRESENT` / `0S`), preventing disconnected ESC timeouts.
* **Progression Timeline & Status Badge**:
  - Top overall status badge in progression header: `pending`, `progressing` (with continuous gear spin), `success`, and `failed`.
  - Step 1 immediately transitions to success upon reading board target and UID, simultaneously kicking Step 2 («Заливання пресету FC») into active spinning state during CLI streaming.
* **Dual-Scope Flashing Statistics (`js/utils/stats.js`)**:
  - Deduplicated counts for **Сьогодні** (auto-resets daily) and **За весь час** (persisted forever in `localStorage`).


## 5. Persistent ESC 4-Way Session & Graceful Exit Fix (2026-11-09)
* **Explicit Session Controls (`js/blheli/session.js`, `index5.html`)**:
  - Added `🔗 З'єднатися з ESC` (`#btnConnectESC`) and `❌ Від'єднатися від ESC` (`#btnDisconnectESC`) in Expert Mode.
  - ESC operations (`Read`, `Backup`, `Restore`, `Configure`) remain disabled until an active 4-Way session is established, and do not close the port on completion.
* **Protocol-Compliant 4-Way Exit (`CMD_INTERFACE_EXIT`)**:
  - Fixed `CMD_INTERFACE_EXIT` (`0x34`) payload to send 1 parameter byte `[0]` (`ParamLen = 1`, 8-byte frame `[0x2F, 0x34, 0x00, 0x00, 0x01, 0x00, CRC_H, CRC_L]`) instead of `[]` (`ParamLen = 0`, which Betaflight's `serial_4way.c` parser interprets as a 256-byte payload).
  - Pre-checks `CMD_PROTOCOL_GET_VERSION` in `init4WayInterface` before sending `MSP 245` (`MSP_SET_4WAY_IF`).
  - Automatically closes any open 4-Way session if user initiates Betaflight CLI flashing/backup or Simplified Mode pipeline.
