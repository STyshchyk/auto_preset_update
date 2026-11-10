# PROJECT STATUS — Drone Setup Station Refactoring

**Last Updated:** 2026-11-10  
**Active Entry Point:** `index5.html`  
**Refactoring Progress:** Phases 1–12 Completed (Modular Architecture, IndexedDB Logger, Pre/Post Flash Verification Engine, Multi-Target Safety Guards)  
**Sidebar Architecture:** Split into dedicated Step 1 (FC Telemetry, Verification Icons & Diff) and Step 2 (`#infoCardEsc`, ESC Telemetry & Verification Badges) cards  
**Verification & Safety Protocol:** Full documentation available at `docs/FLASHING_VERIFICATION_PROTOCOL.md`.

---

## 1. Current Implementation State

The application operates as a clean, fully modular single-page application (`index5.html`) using browser-native ES Modules and Web Serial API.

### Extracted & Active Modules
* **CSS Layer:**
  * `css/main.css`: Core design tokens (`:root`), base layout, two-column flex container (`.app-layout`, `.sidebar-col`, `.main-col`), responsive breakpoints, and input styling.
  * `css/components.css`: Step cards, badges, status indicators, buttons, console panel, modal overlays, `.info-card`, `.info-row`, `.info-val-wrap`, `.check-icon` (`.state-idle`, `.state-pass`, `.state-fail`, `.state-warn`), `.mismatch-box`, and `.mismatch-badge`.
* **Core Layer (`js/core/`):**
  * `state.js`: Centralized shared application state (`port`, `availablePorts`, `popupTimer`, `ignoreRebootEventsUntil`, `escChecksPassed`).
  * `serial.js`: Web Serial lifecycle (`refreshPortList`, `initSerialEvents`, `resolveSelectedPort`, `closeSerialSession`).
* **UI Layer (`js/ui/`):**
  * `log.js`: DOM terminal logging with automatic auto-scroll.
  * `status.js`: Step, FC flash sub-steps, and ESC badge visual updates (`setStepStatus`, `setFcSubStep`, `resetFcSubSteps`, `setEscBadge`, `resetAllStepStatuses`, `setAllEscButtons` with verification awareness).
  * `infoPanel.js`: Telemetry sidebar updater (`updateInfoPanel`, `updateEscInfoPanel`, `resetInfoPanel`, `setCheckStatus`) managing FC/ESC telemetry, verification check icons, and automatic flash button safety locking.
  * `modal.js`: Modal dialog management with auto-close and callback execution (`showPopup`, `closeModal`).
* **Utilities (`js/utils/`):**
  * `bytes.js`: Delay timer, byte/hex serialization, array comparison, timestamp generation, file download.
  * `crc.js`: CRC-16/CCITT (XMODEM) calculation (`0x1021`, init `0x0000`) and hex formatting.
* **Betaflight Feature (`js/betaflight/`):**
  * `cli.js`: CLI stream reader (`readCliResponse` with prompt detection) and board target parser (`parseBoardName`).
  * `info.js`: Telemetry parser (`parseFcDetails` for target, firmware, date, MCU) and preset diff analyzer (`extractConfigVariables`, `calculateMismatch`).
  * `preset.js`: Flash preset execution (`flashBetaflightPreset`) with pre-flash baseline diff, target/MCU/firmware preset validation, line-by-line CLI execution, post-flash `diff all` re-read without closing connection, 100% verification comparison, and abort-without-save on discrepancy.
  * `backup.js`: Flight controller configuration backup (`backupBetaflightConfig`).
* **BLHeli_32 Feature (`js/blheli/`):**
  * `protocol.js`: MSPv1 framing (`sendMsp`), low-level 4-Way protocol (`read4WayRaw`, `send4WayCmd`), FC 4-Way mode setup (`init4WayInterface`), and device connection/disconnection (`connectEscDevice`, `disconnectEscDevice`).
  * `eeprom.js`: Session lifecycle wrapper (`withEscSession`), 256-byte block reader with CRC retries (`readEscBlock`), and full 4-ESC settings readout handler (`readAllEscSettings`).
  * `preset.js`: Preset constants (`BL32_PRESET_SETTINGS`, normal/reversed headers), motor rotation detection (`detectMotorDirection`), Bluejay 8-bit safety abort, target 0x4706 MCU / BLHeli_32 model validation, and 4-ESC preset flasher preserving 232 calibration bytes (`applyEscPreset`).
  * `backup.js`: Raw backup format serializer (`buildBackupObject`), JSON schema/checksum validator (`parseEscBackup`), backup generator (`backupAllEscs`), and two-phase restore handler (`triggerRestoreFileSelect`, `handleRestoreFileChange`).
* **Main Bootstrap Entry (`js/main.js`):**
  * Single application bootstrap wiring serial listeners and DOM events to buttons (`btnFlashFC`, `btnBackup`, `btnSkipToEsc`, `btnReadESC`, `btnBackupESC`, `btnRestoreESC`, `fileRestoreESC`, `btnConfigureESC`, `modalCloseBtn`).
  * Exposes `window.closeModal = closeModal`.

---

## 2. Latest Updates (2026-11-10)

* **Left Panel Verification Status Check Icons (`.check-icon`)**:
  - Added real-time check badges for all parameters across Step 1 and Step 2:
    - Step 1: `#checkBoard`, `#checkFw`, `#checkDate`, `#checkMcu`, `#checkDeviceId`.
    - Step 2: `#checkEscModel`, `#checkEscMcu`, `#checkEscPower`, `#checkEscDirs`, `#checkEscPreset`.
  - Visual color states: `✓` green (`state-pass`), `✕` red (`state-fail`), `!` orange (`state-warn`), `—` idle.

* **Strict Preset Matching Engine (FC Step 1)**:
  - Added automatic extraction of `expectedMcu` (`STM32F7X2`) and `expectedFw` (`4.5.1`) directly from the preset `<textarea>`.
  - Enforced strict abort logic: if connected flight controller target, MCU, or firmware version does not match the preset, the session immediately issues `exit\r\n` and aborts without touching the flight controller.
  - Linked the verification status of Build Date (`#checkDate`) directly to the firmware version check (`#checkFw`).

* **Bluejay 8-Bit Platform Identification & Safety Guard**:
  - Tested against an 8-bit drone and identified the signature `0xE8B2` as Silicon Labs EFM8BB21 (48MHz).
  - Explicitly mapped `0xE8B2` and `0xE8B1` in `js/blheli/protocol.js` and `js/blheli/preset.js`.
  - Displays **`Bluejay 8-bit`** under Model and **`0xE8B2`** under MCU.
  - Prohibits flashing 32-bit presets onto Bluejay 8-bit ESCs.

* **Expert Mode Button Safety Lock**:
  - The «⚡ Застосувати пресет до 4 ESC» button is automatically disabled (`disabled = true`) with descriptive tooltips if:
    - LiPo battery is missing or any ESC returns ACK `0xf`;
    - Fewer than 4 ESCs respond;
    - Model is not `BLHeli_32`;
    - MCU signature is not `0x4706`.
  - Master action button in simplified mode remains accessible.

* **Documentation**:
  - Created `docs/FLASHING_VERIFICATION_PROTOCOL.md` with complete pre-flash, during-flash, and post-flash tables.
  - Created `docs/JOB_SUMMARY_2026_11_10.md` detailing daily achievements.
