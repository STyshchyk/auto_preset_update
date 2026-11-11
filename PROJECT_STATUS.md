# PROJECT STATUS — Drone Setup Station Refactoring

**Last Updated:** 2026-11-11  
**Active Entry Point:** `index.html`  
**Refactoring Progress:** Phases 1–14 Completed (Modular Architecture, Multi-Target Safety Guards, 3-State Firmware Recognition & Auto-Skip, Full 256-byte BLHeli_32 Golden EEPROM & Strict Verification)  
**Sidebar Architecture:** Split into dedicated Step 1 (FC Telemetry, Verification Icons & Diff) and Step 2 (`#infoCardEsc`, ESC Telemetry & Verification Badges) cards  
**Verification & Safety Protocol:** Full documentation available at `docs/FLASHING_VERIFICATION_PROTOCOL.md`.

---

## 1. Current Implementation State

The application operates as a clean, fully modular single-page application (`index.html`) using browser-native ES Modules and Web Serial API.

### Extracted & Active Modules
* **CSS Layer:**
  * `css/main.css`: Core design tokens (`:root`), base layout, two-column flex container (`.app-layout`, `.sidebar-col`, `.main-col`), responsive breakpoints, and input styling.
  * `css/components.css`: Step cards, badges, status indicators, buttons, console panel, modal overlays, `.info-card`, `.info-row`, `.info-val-wrap`, `.check-icon`, `.fc-state-pill` (`.state-already-flashed`, `.state-new-hardware`), `.btn-clean-toggle`, `.clean-preset-wrapper`, `.mismatch-box`, and `.mismatch-badge`.
* **Core Layer (`js/core/`):**
  * `state.js`: Centralized shared application state (`port`, `availablePorts`, `popupTimer`, `ignoreRebootEventsUntil`, `escChecksPassed`).
  * `serial.js`: Web Serial lifecycle (`refreshPortList`, `initSerialEvents`, `resolveSelectedPort`, `closeSerialSession`).
* **UI Layer (`js/ui/`):**
  * `log.js`: DOM terminal logging with automatic auto-scroll.
  * `status.js`: Step, FC flash sub-steps, ESC badges, and FC state badge (`setStepStatus`, `setFcSubStep`, `resetFcSubSteps`, `setFcStateBadge`, `setAlreadyFlashedBadge`, `setEscBadge`, `resetAllStepStatuses`, `setAllEscButtons`).
  * `infoPanel.js`: Telemetry sidebar updater (`updateInfoPanel`, `updateEscInfoPanel`, `resetInfoPanel`, `setCheckStatus`) managing FC/ESC telemetry, verification check icons, and automatic flash button safety locking.
  * `modal.js`: Modal dialog management with auto-close and callback execution (`showPopup`, `closeModal`).
* **Utilities (`js/utils/`):**
  * `bytes.js`: Delay timer, byte/hex serialization, array comparison, timestamp generation, file download.
  * `crc.js`: CRC-16/CCITT (XMODEM) calculation (`0x1021`, init `0x0000`) and hex formatting.
* **Betaflight Feature (`js/betaflight/`):**
  * `cli.js`: CLI stream reader (`readCliResponse` with prompt detection) and board target parser (`parseBoardName`).
  * `info.js`: Telemetry parser (`parseFcDetails` for target, firmware, date, MCU), preset diff analyzer (`extractConfigVariables`, `calculateMismatch`), and 3-state firmware recognition engine (`detectFcState`).
  * `preset.js`: Flash preset execution (`flashBetaflightPreset`) with pre-flash 3-state baseline diff, redundant flash skip for `ALREADY_FLASHED`, warning popup for `NEW_HARDWARE`, clean FC handling, post-flash `diff all` re-read, and expert 3-way preset comparison (`comparePresetWithFc`).
  * `backup.js`: Flight controller configuration backup (`backupBetaflightConfig`).
* **BLHeli_32 Feature (`js/blheli/`):**
  * `protocol.js`: MSPv1 framing (`sendMsp`), low-level 4-Way protocol (`read4WayRaw`, `send4WayCmd`), FC 4-Way mode setup (`init4WayInterface`), and device connection/disconnection (`connectEscDevice`, `disconnectEscDevice`).
  * `eeprom.js`: Session lifecycle wrapper (`withEscSession`), 256-byte block reader with CRC retries (`readEscBlock`), and full 4-ESC settings readout handler (`readAllEscSettings`) synchronized with full golden preset validation.
  * `preset.js`: Golden 256-byte reference EEPROM container (`BL32_GOLDEN_PRESET_256`, CRC16 `0xbc05`), `isGoldenPresetMatched()` checker, motor rotation detection (`detectMotorDirection`), Bluejay 8-bit safety abort, target 0x4706 MCU / BLHeli_32 model validation, full 256-byte page overwriting, and strict post-flash byte-by-byte verification (`applyEscPreset`).
  * `backup.js`: Raw backup format serializer (`buildBackupObject`), JSON schema/checksum validator (`parseEscBackup`), backup generator (`backupAllEscs`), and two-phase restore handler (`triggerRestoreFileSelect`, `handleRestoreFileChange`).
* **Main Bootstrap Entry (`js/main.js`):**
  * Single application bootstrap wiring serial listeners and DOM events to buttons (`btnFlashFC`, `btnComparePreset`, `btnToggleCleanPreset`, `btnBackup`, `btnSkipToEsc`, `btnReadESC`, `btnBackupESC`, `btnRestoreESC`, `fileRestoreESC`, `btnConfigureESC`, `modalCloseBtn`).
  * Exposes `window.closeModal = closeModal`.

---

## 2. Latest Updates (2026-11-11)

* **Phase 16: Automated ESC IndexedDB Backup & Instant Restore Engine (`js/core/db.js`, `js/blheli/preset.js`, `js/blheli/backup.js`, `index.html`, `js/main.js`, `js/ui/status.js`)**:
  - Upgraded IndexedDB schema to version 4 with dedicated object store `esc_preset_dumps` keyed by FC `mcuId`.
  - Added automatic backup creation during `applyEscPreset()`: captures original 256-byte blocks of all 4 ESCs with CRC verification and writes to `esc_preset_dumps` under the FC's `mcuId` before applying any flash changes.
  - Implemented «📥 Експорт з БД» (`exportEscBackupFromDb()`): exports stored ESC backup directly from IndexedDB into a valid JSON file.
  - Implemented «🔄 Відновити з БД» (`restoreEscFromDb()`): flashes original ESC settings back from IndexedDB, preceded by a safety confirmation dialog displaying MCU ID, byte size, date, LiPo requirement, and propeller removal warnings.
  - Integrated button state management in `comparePresetWithFc()` and `setAllEscButtons()`.

* **Phase 15: Pipeline COM Port Stabilization & ESC Bootloader Retry Engine (`js/core/pipeline.js`, `js/core/serial.js`, `js/blheli/protocol.js`)**:
  - Increased automated conveyor reboot wait time: 5.0 seconds after FC `save` and 2.5 seconds after `exit` (skip mode) ensuring complete USB/UART re-enumeration.
  - Implemented automatic retry polling (5 attempts x 400ms) in `resolveSelectedPort()` before prompting the user with `requestPort()`, preventing unwanted device selection dialogs when COM port temporarily drops during reboot.
  - Added robust 3-attempt handshake loop with 250ms spacing and `CMD_DEVICE_RESET` re-trigger in `connectEscDevice()` to eliminate transient `0x0F` (`ACK_D_GENERAL_ERROR`) failures on ESC #1.
  - Increased post-MSP 245 UART muxing delay to 400ms and post-`CMD_INTERFACE_SET_MODE` pause to 500ms before querying ESC channels.

* **Phase 14: BLHeli_32 Full 256-Byte Golden EEPROM Container & Strict Post-Flash Verification (`js/blheli/preset.js`, `js/blheli/eeprom.js`, `js/blheli/session.js`, `docs/FLASHING_VERIFICATION_PROTOCOL.md`)**:
  - Integrated `BL32_GOLDEN_PRESET_256` (512 hex characters / 256 bytes, CRC16 `0xbc05`, target MCU `0x4706`) from `BLHeli32_ESC_backup_20261111_135350_2.json`.
  - Exported `BL32_GOLDEN_CRC16 = 'bc05'` and helper function `isGoldenPresetMatched(data)` evaluating full 256-byte array equality. Preserved backward compatibility exports (`BL32_PRESET_SETTINGS`, `BL32_HEADER_NORMAL_100`).
  - Switched `applyEscPreset()` from partial 24-byte patching to writing the full monolithic 256-byte cryptographic EEPROM container (`0xF800`).
  - Replaced partial delta check with full 256-byte equality evaluation (`isGoldenPresetMatched` and `!bytesEqual(originalData, patchData)`).
  - Fixed ASCII model name scanning: removed `|| str.includes('_')` in `preset.js` and `eeprom.js` to eliminate false positives from encrypted byte values (`0x5F`).
  - Phase 3 post-flash verification: added strict byte-by-byte check (`!bytesEqual(verifyBlock.data, targets[esc].patchData)`). On mismatch, immediately sets `escFlowVerify = fail`, `setEscBadge(esc, 'fail', 'Розбіжність даних')`, and safely aborts.
  - Hardened ESC session disconnect (`disconnectEscSession()`): sets `state.escSession.isConnected = false` immediately upon entering the `try` block before dispatching `CMD_INTERFACE_EXIT`, and guarantees `#btnConnectESC` / `#btnDisconnectESC` are re-enabled upon completion or failure.
  - Synchronized `docs/FLASHING_VERIFICATION_PROTOCOL.md` (items 2.8, 2.9, 2.14) with the 256-byte golden preset architecture.
    2. **`CLEAN`**: Matches clean baseline dump (ignoring accelerometer calibration). Proceeds directly to standard flashing without special badges.
    3. **`NEW_HARDWARE`**: Neither clean nor flashed. Displays warning badge `⚠️ Нове обладнання` with amber glowing animation and triggers a warning popup notifying the operator that non-standard configuration was detected.
* **Flight Controller Preset Dump Store & Dual Backup/Restore Engine (`js/core/db.js`, `js/betaflight/preset.js`, `index.html`, `css/components.css`, `js/main.js`)**:
  - IndexedDB upgraded to schema version 3 with dedicated store **`fc_preset_dumps`** explicitly identifying stored dumps as `FC_PRESET_DUMP` (`targetType: 'FLIGHT_CONTROLLER'`).
  - Automatic backup saves both `diffAll` and `dumpAll` simultaneously upon detecting `NEW_HARDWARE` (both during comparison and before flashing).
  - Added buttons:
    1. **«📥 Експорт (diff + dump)»** (`#btnExportNewHwDump`): downloads `NEW_HW_DIFF_...txt` and `NEW_HW_DUMP_...txt` as two separate files.
    2. **«🔄 Відновити diff»** (`#btnRestoreDiffFromDb`): automatically flashes the saved `diff all` back into the flight controller.
    3. **«🔄 Відновити dump»** (`#btnRestoreDumpFromDb`): automatically flashes the saved full `dump all` back into the flight controller.
    4. **«🔄 Відновити з файлу»** (`#btnRestoreFCFromFile` / `#fileRestoreFC`): executes full-cycle flight controller flashing from an external configuration file with all safety and verification checks.
  - Removed defunct `Перейти до ESC ➜` (`#btnSkipToEsc`) button.
  - Buttons in Step 1 (Expert Mode) harmoniously sorted and structured into 3 logical functional toolbars (`.controls-toolbar`, `.controls-group`):
    1. **⚡ Прошивка:** «Залити пресет у FC» (`#btnFlashFC`), «🔍 Порівняти з пресетом» (`#btnComparePreset`), «🧼 Залити чистий дамп» (`#btnFlashCleanFC`).
    2. **💾 База дампів:** «📥 Експорт (diff + dump)» (`#btnExportNewHwDump`), «🔄 Відновити diff» (`#btnRestoreDiffFromDb`), «🔄 Відновити dump» (`#btnRestoreDumpFromDb`).
    3. **📁 Бекап:** Селектор diff/dump, «💾 Зберегти бекап у файл» (`#btnBackup`), «🔄 Відновити з файлу» (`#btnRestoreFCFromFile`).
  - Added new hardware metrics tracking to Statistics card (`Нові FC`: `#statDailyNewHw`, `#statAllNewHw`).
* **Enhanced Expert Multi-Preset Comparator (`js/betaflight/preset.js`)**:
  - `#btnComparePreset` now performs 3-way evaluation: logs diff metrics against both target preset and clean baseline preset, sets the appropriate badge, and displays diagnostic modal breakdown.

---

## 2. Latest Updates (2026-11-10)

* **Zero-Mismatch Skip Flashing Engine (`js/betaflight/preset.js`, `js/ui/status.js`, `js/core/pipeline.js`)**:
  - Якщо початковий аналіз `diff all` виявляє **0% розбіжностей** із пресетом (`mismatchStats.mismatchCount === 0`), система розпізнає пристрій як вже прошитий.
  - Повторний запис команд у флеш-пам'ять FC та зайва команда `save` скасовуються.
  - Статус Кроку 1 переводиться в `success` із явним текстом біля іконки успіху: `<span class="step-status success">✅ Вже прошитий пристрій</span>`.
  - Підпункти Кроку 1 інформують: `1. Пропущено (0% diff)`, `2. Звірено (100% збіг)`, `3. Перевірено (Вже прошитий)`.
  - Конвеєр спрощеного режиму відображає `Вже прошитий (0% розбіжностей, пропущено)` та без затримки на перезавантаження продовжує перехід до Кроку 2 (ESC).

* **Operator Instructions & FAQ Redesign (`index.html`, `css/components.css`)**:
  - Structured into chronological stages:
    1. **🔌 До підключення**: Сувора заборона підключення декількох девайсів (`‼️`), закриття сторонніх конфігураторів (Betaflight/ESC Configurator/BLHeliSuite32), рекомендація USB Type-A через хаб з живленням, порядок живлення (LiPo ➔ очікування мелодії ➔ 2 сек ➔ USB), техніка безпеки (зняті пропелери `⚠️`).
    2. **⚡ Під час прошивки**: Штатний старт в 1 клік, діалог дозволу для нових пристроїв, сувора заборона вимикання під час запису (`‼️`).
    3. **✅ Після прошивки**: Порядок безпечного відключення `[1] USB ➔ [2] LiPo` зі стилізованим бейджем `<span class="faq-status-pill-success">✓ УСПІШНО</span>`.
    4. **❓ Загальні питання та помилки**: Орієнтування за галочками `<span class="faq-badge-pass">✓</span>` та хрестиками `<span class="faq-badge-fail">✕</span>` на лівій панелі, алгоритм дій при збої ESC, призначення режиму експерта.
  - Додано візуальний інтерактивний елемент-кнопку `<span class="faq-btn-pill-master">🚀 ПРОШИТИ ДРОН (FC + ESC)</span>` всередині тексту FAQ для 100% візуальної асоціації оператора.

* **One-time Operator Safety Agreement Dialog (`#instructionsModal`, `js/ui/modal.js`)**:
  - Модальне вікно інструктажу перед першим запуском прошивки (перевіряється в спрощеному та експертному режимах).
  - Чекбокс згоди із правилами роботи активує кнопку підтвердження.
  - Стан підтвердження зберігається в `localStorage` (`drone_station_instructions_ack_v1`).
  - Передбачено кнопки скасування/закриття (хрестик `✕` та «Скасувати»), що закривають вікно без запуску процесу прошивки.

* **Pipeline Status & Left Panel Parity Fixes (`js/core/pipeline.js`, `index.html`)**:
  - Усунено зависання іконки Кроку 2 в статусі `working`: при успішному записі пресету FC іконка одразу переводиться в статус `success`, навіть якщо через відсутність LiPo батареї зупиняється налаштування ESC.
  - Досягнуто паритету лівої інфо-панелі між спрощеним та експертним режимами: поля **«Дата збірки»** та **«MCU»** відображаються завжди, а блок «Порівняння з пресетом» залишено ексклюзивно для режиму експерта.
  - Кнопку «Дозволити новий пристрій» приховано з інтерфейсу (запит дозволу відбувається безпосередньо при натисканні на прошивку або виборі порту).
