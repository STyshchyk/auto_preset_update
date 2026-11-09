# JOB SUMMARY: ESC Flashing & Betaflight CLI Preset Configuration

**Date:** 2026-11-09  
**Target Board:** SPEDIXF722 (Betaflight 4.5.1 STM32F7X2) / MCU 0x4706  
**Primary Files Modified:** `index5.html`, `PROJECT_STATUS.md`, `AGENTS.md`

---

## 1. ESC Dump Analysis & Binary References

A raw 256-byte EEPROM dump (`0xF800`) from 4 connected ESCs (MCU `0x4706`) was analyzed and validated:
* **Settings Block (`0x10..0x1F`)**:
  ```
  9E DF FF 55 21 E8 2E 9C 16 BA C7 D7 50 E7 FA 5B
  ```
  Corresponds to: Rampup Power = 100%, Low RPM Power Protect = Off, Beacon = Off.
* **Direction Header (`0x00..0x07`)**:
  ```
  90 BD 5D F6 AA 06 4C 53
  ```
  Corresponds to: Motor direction `NORMAL` @ 100% Rampup.
* **CRC16 (XMODEM CCITT `0x1021`)**: Calculated & verified as `8976`.

---

## 2. Changes Implemented in `index5.html`

### A. Forced Motor Direction to `NORMAL` for all 4 ESCs
* **Problem Identified**: The previous logic inspected the existing flash header (`detectMotorDirection(currentHeader, esc)`). If ESCs #2 and #4 previously had reversed headers, it preserved them, preventing them from being set to normal.
* **Fix Applied**: Updated `btnConfigureESC` patch generation to force `direction = 'normal'` and `targetHeader = BL32_HEADER_NORMAL_100` for all 4 ESC channels until instructed otherwise:
  ```javascript
  // Примусово NORMAL для всіх ESC до окремої вказівки
  const direction = 'normal';
  const targetHeader = BL32_HEADER_NORMAL_100;
  ```
* Updated `detectMotorDirection` default return fallback to `'normal'`.

### B. Updated Default Betaflight CLI Preset (`#presetInput`)
Replaced the default contents of `<textarea id="presetInput">` in `index5.html` with the new production batch configuration:
* Begins with `defaults nosave` (initial full reset without reboot).
* Target configuration: `board_name SPEDIXF722`, `manufacturer_id SPDX`, craft name `T-System 15`.
* Hardware resources, features (`SERVO_TILT`, `OSD`, `ESC_SENSOR`), servos, beepers, aux channels, and vtxtables.
* Filter and motor parameters: PT2 gyro/dterm filters, dynamic notch, `yaw_motors_reversed = ON`.
* Rates & profile 0 PIDs (`roll/pitch/yaw_srate = 35`, simplified sliders enabled).
* Closes with `# save configuration` / save sequence.

---

## 3. Verification
* Verified textarea syntax and boundary tags (`<textarea id="presetInput">...</textarea>`).
* Verified CRC-16 computation (`0x8976`) using native project `js/utils/crc.js`.
* Git diff inspected for clean indentation, encoding, and zero regressions to existing UI components.
