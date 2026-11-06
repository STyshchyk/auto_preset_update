# PROJECT_MAP: `index5.html`

> **Drone Setup Station: Betaflight & BLHeli_32 Configurator and Flashing Engine**  
> Single-Page HTML Application powered by **Web Serial API** for Flight Controller (Betaflight CLI / Flasher) and Electronic Speed Controller (BLHeli_32 via MSP 4-Way Passthrough) verification and configuration.

---

## 1. High-Level Architecture Overview

The application follows a clean native ES Module architecture without external bundlers (Webpack/Vite) or runtime frameworks:

```
├── index5.html                # Main application markup & active production entry point (zero inline JS)
├── css/
│   ├── main.css               # Core design tokens (:root), typography & layout
│   └── components.css         # Step cards, badges, status indicators, console & modal
└── js/
    ├── main.js                # Application entry point, diagnostic trigger & DOM orchestration
    ├── core/                  # Shared infrastructure & lifecycle
    │   ├── state.js           # Shared application state
    │   ├── serial.js          # Web Serial API connection lifecycle & port management
    │   ├── error_manager.js   # Unified diagnostic & error management (Phase 9 & 9.1 Audited)
    │   ├── firmware_validator.js # Intel HEX & raw binary parser/validator (Phase 9 & 9.1 Audited)
    │   ├── compat_checker.js  # Hardware target & firmware compatibility engine (Phase 9 & 9.1 Audited)
    │   └── diag_orchestrator.js # End-to-end diagnostic coordinator & summary aggregator (Phase 10)
    ├── ui/                    # UI presentation helpers
    │   ├── log.js             # Real-time serial terminal logger
    │   ├── status.js          # Step status and ESC badge renderers
    │   └── modal.js           # Modal dialog and auto-fade alerts
    ├── utils/                 # Pure helper functions
    │   ├── bytes.js           # Byte manipulation, delay & file export
    │   └── crc.js             # CRC-16/CCITT XMODEM calculation
    ├── betaflight/            # Flight Controller domain engine
    │   ├── cli.js             # Betaflight CLI stream reader & target parser
    │   ├── fc_diag.js         # Non-destructive FC diagnostic scanner & telemetry parser
    │   ├── preset_validator.js # Read-only pre-flash configuration validator & diff comparator
    │   ├── preset.js          # CLI preset flashing & abort handling
    │   └── backup.js          # CLI diff/dump backup exporter
    └── blheli/                # ESC domain engine
        ├── protocol.js        # MSPv1 framing & official 4-Way Passthrough commands
        ├── esc_diag.js        # Dynamic multi-channel ESC diagnostic scanner
        ├── eeprom.js          # 4-Way EEPROM session management & block read
        ├── backup.js          # JSON backup generation & two-phase restore
        └── preset.js          # Direction detection & binary preset patching (0x10..0x1F)
```

---

## 2. Betaflight Domain Modules

### 2.1 `cli.js`
* `readCliResponse(reader, timeoutMs, stopOnPrompt)`: Reads text stream until `#` prompt or timeout.
* `parseBoardName(text)`: Regex extraction of board target from `status` and `version` output (prioritizes `board_name`, handles `manufacturer_id` lookahead).

### 2.2 `fc_diag.js`
* `parseFcTelemetry(text)`: Extracts firmware name, version, build date, target identifier, board name, MCU family, architecture, MCU ID, and craft name.
* `runFcDiagnostics(options)`: Connects to serial, queries `version` and `status` non-destructively, evaluates compatibility against expected hardware profiles, and records findings in `errorManager`.

### 2.3 `preset_validator.js` (Pre-flash Preset Validation)
* `parsePresetConfig(scriptText)`: Parses target board, `set` parameters, `feature` flags, `resource` pin allocations, `beeper` rules, and `aux` channels across `master`, `profile 0..3`, and `rateprofile 0..3`.
* `parseDiffOutput(diffText)`: Parses effective current FC configuration from `dump all` or `diff all`.
* `validateFcPreset({ presetScript, log })`: Connects read-only, checks board target, reads effective configuration (`dump all`), compares all expected settings, and outputs:
  - `PASS — Configuration already matches the selected preset` (skips re-flashing).
  - `ERROR — Configuration mismatch` (lists each parameter with current FC value vs expected preset value).
  - Categorizes missing dump parameters as `UNKNOWN / UNVERIFIED` without false mismatch errors.

### 2.4 `preset.js`
* `flashBetaflightPreset()`: Executes read-only pre-flash validation first. If configuration already matches, marks Step 1 as `success` and notifies user without writing. Otherwise, proceeds with line-by-line CLI execution.
