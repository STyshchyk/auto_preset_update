# NEXT STEPS — Drone Setup Station Refactoring

## Status: Full Verification Suite, Status Icons, 3-State FC Recognition, 256-Byte Golden ESC Preset, Dual IndexedDB Dumps & Motor Direction Testing Completed! 🎉

The Drone Setup Station features a unified one-click simplified assembly pipeline, hardware UID extraction (`mcu_id`), live progression timeline, localStorage-backed device statistics and operator agreement, IndexedDB-backed operation logs and dual dump stores (`fc_preset_dumps` & `esc_preset_dumps`), real-time verification status check icons (`.check-icon`), strict target/firmware/MCU validation against presets, Bluejay 8-bit detection, structured operator FAQ, automatic ESC flashing button locking, COM port reboot stabilization polling, interactive Step 3 motor direction testing via Betaflight MSP and DShot commands (`DSHOT_CMD_SAVE_SETTINGS`), and automated CI/CD deployment via Vercel.

---

## Completed Architecture Summary

1. **`docs/FLASHING_VERIFICATION_PROTOCOL.md`**:
   - Comprehensive technical protocol detailing all pre-flash, during-flash, and post-flash checks for Step 1 (FC) and Step 2 (ESC), including 3-state baseline diff, automatic IndexedDB backup, full 256-byte golden EEPROM writing, and strict post-flash verification.
2. **`PROJECT_STATUS.md` & `PROJECT_MAP.md`**:
   - Up-to-date tracking of Phases 1–19, DOM selectors, grouped toolbars, Simplified Mode popup filtering, and active ES module structure anchored on `index.html`.
3. **`index.html` & `css/components.css`**:
   - Grouped expert toolbars for Step 1 (⚡ Прошивка, 💾 База дампів, 📁 Бекап) and Step 2 (🔗 Сесія, ⚡ Прошивка, 💾 База дампів, 📁 Файли).
   - Structured operator instructions FAQ (`🔌 До підключення`, `⚡ Під час прошивки`, `✅ Після прошивки`, `❓ Загальні питання та помилки`) with master run pill (`.faq-btn-pill-master`) and status badges.
   - One-time operator safety agreement modal (`#instructionsModal`) with checkbox, confirmation, and safe cancellation.
   - Parity of left info panel between simplified and expert modes (`#infoBuildDate`, `#infoMcuType`).
4. **`js/ui/modal.js`**:
   - `ensureInstructionsAcknowledged()` enforcing single-time acknowledgment backed by `localStorage`.
5. **`js/core/pipeline.js` & `serial.js`**:
   - Unified automated conveyor (`runFullDroneSequence`) with adaptive COM port polling (5 attempts x 400ms) and stabilized reboot delays (5.0s on save, 2.5s on skip).
   - Immediate Step 2 status resolution to `success` upon verified FC flash even when LiPo is missing.
6. **`js/ui/infoPanel.js` & `css/components.css`**:
   - Status check indicators (`#checkBoard`, `#checkFw`, `#checkDate`, `#checkMcu`, `#checkDeviceId`, `#checkEscModel`, `#checkEscMcu`, `#checkEscPower`, `#checkEscDirs`, `#checkEscPreset`).
   - Dynamic button lock on `#btnConfigureESC` if any verification rule fails (e.g. no LiPo, ACK 0xf, not BLHeli_32, or not 0x4706).
7. **`js/betaflight/preset.js` & `info.js`**:
   - Strict checking of `expectedBoard` (`SPEDIXF722`), `expectedMcu` (`STM32F7X2`), and `expectedFw` (`4.5.1`).
   - 3-state firmware recognition (`ALREADY_FLASHED` skip, `CLEAN`, `NEW_HARDWARE` warning).
   - Dual FC dump backup (`diff all` and `dump all`) to IndexedDB with one-click restore and file export.
8. **`js/blheli/preset.js`, `eeprom.js`, `protocol.js`, `backup.js`**:
   - 256-byte golden EEPROM container (`BL32_GOLDEN_PRESET_256`, CRC16 `0xbc05`) targeting MCU `0x4706` (`NORMAL` direction for all 4 ESCs; if the golden preset is changed, `targets` and `detectMotorDirection()` headers in `js/blheli/preset.js` must also be updated to reflect expected motor directions in the UI).
   - Automatic pre-flash ESC backup to IndexedDB (`esc_preset_dumps` keyed by FC `mcu_id`) with one-click DB restore and export.
   - 3-attempt handshake with `CMD_DEVICE_RESET` preventing transient connection failures.
   - Strict Bluejay 8-bit detection (`0xE8B2` / `0xE8B1` / Silicon Labs EFM8BB21) and safety abort.
9. **`js/betaflight/msp.js` & `js/motors/test.js` (Step 3: Motor Testing & Reversal)**:
   - Interactive QuadX layout with schematic drone diagram (`img/drone-quad-x.png`).
   - Low-speed motor test via Betaflight `MSP_SET_MOTOR` (`214`).
   - Individual motor reversal via `MSP_SET_PASSTHROUGH` (`245`) with DShot commands `20` / `21`.
   - ESC EEPROM persistence with `DSHOT_CMD_SAVE_SETTINGS` (`12` / `0x0C`).
   - Live speed slider in Expert Mode with quick default reset button.
10. **Simplified Mode Popup Streamlining (`js/ui/modal.js` & `js/motors/test.js`)**:
   - Centralized popup suppression during Step 1 (FC) and Step 2 (ESC) when running in Simplified Mode.
   - Automatic execution of popup callbacks to maintain pipeline progression and logs without UI blocking.
   - Exclusively permitted final completion popup following «🏁 Завершити налаштування» (`#btnSaveMotorDirections`) with a 1-second auto-close timer (`1000ms`) in Simplified Mode.
   - Full modal popup preservation in Expert Mode.

---

## Potential Next Steps

1. **Bluejay Dedicated Profile Mode (Optional Future Extension)**:
   - If 8-bit drones are formally supported in the future, add dedicated Bluejay flashing/configuration profiles rather than just aborting.
2. **Station Export / Reporting**:
   - Option to export daily/all-time device flash logs into CSV/JSON for station quality assurance archives.
3. **Multi-Baud Rate Probing**:
   - Fallback baud rate probe (e.g. 57600 or 230400) if a non-standard Betaflight build is connected.
