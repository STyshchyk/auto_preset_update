# NEXT STEPS — Drone Setup Station Refactoring

## Immediate Next Action: Phase 8 (BLHeli_32 Feature Extraction)

Extract the remaining BLHeli_32 high-level domain operations from `index5.html` into dedicated modules inside `js/blheli/`:

1. **`js/blheli/eeprom.js`**:
   * Constants: `BL32_EEPROM_ADDR` (`0xF800`), `ESC_BLOCK_LEN` (`256`), `ESC_COUNT` (`4`).
   * Functions:
     * `withEscSession(fn)` (port lifecycle wrapper with `CMD_INTERFACE_EXIT` in `finally`).
     * `readEscBlock(writer, reader, esc)` (up to 3 read attempts with CRC validation).
     * `readAllEscSettings()` (handler logic for `#btnReadESC`).

2. **`js/blheli/backup.js`**:
   * Constant: `ESC_BACKUP_FORMAT` (`'blheli32-esc-raw-backup'`).
   * Functions:
     * `buildBackupObject(escs, complete)`.
     * `parseEscBackup(text)` (backup JSON schema and checksum validation).
     * `backupAllEscs()` (handler logic for `#btnBackupESC`).
     * `triggerRestoreFileSelect()` and `handleRestoreFileChange(event)` (two-phase restore workflow with pre-restore auto-backup).

3. **`js/blheli/preset.js`**:
   * Constants: `BL32_PRESET_SETTINGS`, `BL32_HEADER_NORMAL_100`, `BL32_HEADER_REVERSED_100`, `BL32_HEADER_NORMAL_50`, `BL32_HEADER_REVERSED_50`.
   * Functions:
     * `detectMotorDirection(header8, escIndex)`.
     * `applyEscPreset()` (handler logic for `#btnConfigureESC`, preserving 232 bytes).

---

## Subsequent Tasks

1. **Phase 9 — Application Bootstrap & Main Entry (`js/main.js`)**:
   * Create `js/main.js` as the single module entry point.
   * Attach all DOM event listeners (`#btnFlashFC`, `#btnBackup`, `#btnSkipToEsc`, `#btnReadESC`, `#btnBackupESC`, `#btnRestoreESC`, `#fileRestoreESC`, `#btnConfigureESC`, `#modalCloseBtn`).
   * Update `index5.html` to reference `<script type="module" src="js/main.js"></script>` with zero inline JavaScript.

2. **Phase 10 — Final Audit & Documentation Synchronization**:
   * Update `PROJECT_MAP.md` to reflect the final modular structure and line references.
   * Create `REFACTOR_LOG.md` recording all refactoring phases, decisions, and verification steps.
   * Verify Netlify SPA redirect compatibility and production asset loading.
