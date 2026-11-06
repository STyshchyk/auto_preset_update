# PROJECT STATUS — Drone Setup Station Refactoring

**Last Updated:** 2026-11-06  
**Active Entry Point:** `index5.html`  
**Refactoring Progress:** Phases 1–7 Completed (Phase 8 Pending)

---

## 1. Current Implementation State

The monolithic single-file application (`index5.html`) has been modularized via native ES Modules without altering hardware communication protocols or UI behaviors.

### Extracted Modules
* **CSS Layer:**
  * `css/main.css`: Core design tokens (`:root`), base layout, container, and input styling.
  * `css/components.css`: Step cards, badges, status indicators, buttons, console panel, and modal overlays.
* **Core Layer (`js/core/`):**
  * `state.js`: Centralized shared application state (`port`, `availablePorts`, `popupTimer`, `ignoreRebootEventsUntil`).
  * `serial.js`: Web Serial lifecycle (`refreshPortList`, `initSerialEvents`, `resolveSelectedPort`, `closeSerialSession`).
* **UI Utilities (`js/ui/`):**
  * `log.js`: DOM terminal logging with automatic auto-scroll.
  * `status.js`: Step and ESC badge visual updates (`setStepStatus`, `setEscBadge`, `resetAllStepStatuses`, `setAllEscButtons`).
  * `modal.js`: Modal dialog management with auto-close and callback execution (`showPopup`, `closeModal`).
* **Utilities (`js/utils/`):**
  * `bytes.js`: Delay timer, byte/hex serialization, array comparison, timestamp generation, file download.
  * `crc.js`: CRC-16/CCITT (XMODEM) calculation (`0x1021`, init `0x0000`) and hex formatting.
* **Betaflight Feature (`js/betaflight/`):**
  * `cli.js`: CLI stream reader (`readCliResponse` with prompt detection) and board target parser (`parseBoardName`).
  * `preset.js`: Flash preset execution (`flashBetaflightPreset`) with per-line error abort and `skipToEsc`.
  * `backup.js`: Flight controller configuration backup (`backupBetaflightConfig`).
* **BLHeli_32 Feature (`js/blheli/`):**
  * `protocol.js`: MSPv1 framing (`sendMsp`), low-level 4-Way protocol (`read4WayRaw`, `send4WayCmd`), FC 4-Way mode setup (`init4WayInterface`), and device connection/disconnection (`connectEscDevice`, `disconnectEscDevice`).

### Remaining in `index5.html`
* BLHeli_32 EEPROM higher-level logic:
  * `withEscSession`, `readEscBlock`, `btnReadESC` handler.
  * `buildBackupObject`, `parseEscBackup`, `btnBackupESC` handler, `btnRestoreESC`/`fileRestoreESC` restore workflow.
  * Dummy preset patch logic (`detectMotorDirection`, `BL32_PRESET_SETTINGS`, `BL32_HEADER_*`, `btnConfigureESC` handler).
* Main bootstrapping / event listener binding.

---

## 2. Key Architectural Decisions & Constraints

* **Strict Protocol Preservation:** Never alter binary constants, command byte sequences, delay timings (e.g. 50ms, 100ms bootloader delay, 300ms post-settle), or packet structures.
* **Native ES Modules:** No bundlers (Webpack, Vite), transpilers, or external frameworks. All imports resolve via browser-native ES module resolution.
* **Dependency Flow:** Unidirectional DAG:
  `features (betaflight, blheli)` → `core` / `ui` / `utils`.
  `core` never imports feature modules. `ui` and `utils` remain leaf-level helpers.
* **State Management:** Single shared mutable state object in `js/core/state.js` prevents stale bindings across ES module boundaries.
* **Known Discrepancy Recorded:** In `btnConfigureESC`, the UI confirm dialog mentions read-back verification and pre-restore backup, but the actual implementation directly applies the binary patch via `TestAlive` -> `DeviceWrite` (with ACK check). As per safety rules, existing behavior is preserved without functional modification.

---

## 3. Verification Performed

* **CSS Line-by-Line Equality:** Verified exact line-by-line parity with original `<style>` contents (`Compare-Object` zero diff).
* **CRC16 & Byte Vectors:** Unit-tested in Node.js with known 4-Way read packet vectors (`0x93F4`) and standard ASCII checks.
* **Web Serial Lock Order:** Unit-tested mock lock release sequence (`reader.cancel` → `reader.releaseLock` → `writer.releaseLock` → `encoder.readable.cancel` → `port.close`).
* **Betaflight CLI & Parsing:** Verified `parseBoardName` regex matching and CLI prompt detection stops on `#`.
* **BLHeli_32 4-Way Packet Framing:** Verified MSP 245 frame output (`[0x24, 0x4D, 0x3C, 0x00, 0xF5, 0xF5]`) and 4-Way packet big-endian CRC verification.
* **Syntax Validation:** Clean syntax checks on all `.js` files and inline `<script type="module">` via `node --check`.
