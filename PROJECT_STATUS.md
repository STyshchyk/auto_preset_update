# PROJECT STATUS — Drone Setup Station Refactoring

**Last Updated:** 2026-11-06  
**Active Entry Point:** `index5.html`  
**Refactoring Progress:** Phases 1–7 Completed; Telemetry & Preset Mismatch Analysis Implemented (Phase 8 Pending)  
**Sidebar Architecture:** Split into dedicated Step 1 (FC Telemetry & Diff) and Step 2 (`#infoCardEsc`, BLHeli_32 Live Status) cards

---

## 1. Current Implementation State

The application operates as a modularized single-page application (`index5.html`) using browser-native ES Modules and Web Serial API.

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

* **Syntax & Module Validation:** All `.js` modules and inline `<script type="module">` verified via `node --check`.
* **Telemetry & Mismatch Logic Tests:** Tested against multi-line version outputs and diff dumps; verified exact match yields 0% mismatch.
* **Execution Latency:** Verified CLI flashing throughput retains rapid execution without blocking waits.
