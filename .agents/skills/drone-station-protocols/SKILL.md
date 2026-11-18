---
name: drone-station-protocols
description: Hardware, Web Serial, Betaflight CLI/MSP, BLHeli_32 4-Way, and DShot motor-control safety invariants for the Drone Setup Station. Trigger when editing or reviewing js/core/serial.js, js/core/pipeline.js, js/betaflight/, js/blheli/, or js/motors/.
---

# Drone Station Protocol & Safety Invariants

## 1. Hardware & Firmware Targets
- **FC Target:** `SPEDIXF722` | **MCU:** `STM32F7X2` | **Betaflight:** `4.5.1`
- **ESC Target:** `BLHeli_32` | **MCU:** `0x4706` | **Golden EEPROM:** `BL32_GOLDEN_PRESET_256` (256 bytes at `0xF800`, CRC-16 `0xbc05`, `NORMAL` direction for all 4 ESCs).
  - If `BL32_GOLDEN_PRESET_256` is changed, also update `targets` and `detectMotorDirection()` 8-byte headers in `js/blheli/preset.js`.
- **Bluejay 8-bit Safety:** Abort immediately if `0xE8B2`, `0xE8B1`, or Silicon Labs `EFM8BB21` is detected.

## 2. Web Serial & Stream Locking
- **CLI Streams:** Use `createCliStreams(port)` in `js/betaflight/cli.js` (direct `getReader()` / `getWriter()`). Never use `TextEncoderStream` / `TextDecoderStream` with unawaited `pipeTo()`, as it permanently locks streams on macOS/Linux and non-reboot paths.
- **Port Open Guards:** Check `if (!port.readable || !port.writable)` before calling `port.open()`.
- **Cleanup:** Always release reader/writer locks in `finally` blocks, and call `closeSerialSession()` on `"device has been lost"` errors.

## 3. BLHeli_32 4-Way & Pipeline Stability
- **4-Way Session:** Guard `CMD_INTERFACE_EXIT` (`0x34`) in `withEscSession()` with `if (writer && reader)`. Drain stale `session.buffer` bytes at the start of `send4WayCmd()`.
- **Pipeline State:** Respect `state.isPipelineRunning` in `js/core/serial.js` so `resetAllStepStatuses()` does not clear UI progress during FC USB reboots.

## 4. Step 3 Motor & DShot Safety
- **Motor Stop:** `stopAllMotors()` must send `1000µs` (double send with `50ms` interval). Always verify motors are stopped in `saveMotorDirections()` before `closeSerialSession()`.
- **Writer Synchronization:** Use `withMotorPortWriter()` in `js/motors/test.js` to wait for `port.writable.locked` before writing.
- **DShot MSPv2 (`0x3003`):** `sendDshotProgCommand()` must drain stale RX bytes before sending `$X<`, verify `$X>` ACK (`parseMsp2DshotAck()`), and retry up to 3 times on failure.
- **UI Locking:** Keep `#btnRunSimplified` locked while Step 3 is active (`motorState.step2Finished === true`), unlocking only on `saveMotorDirections()`, pipeline error, or USB disconnect (`resetMotorStateOnDisconnect()`).
