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

* **Zero-Mismatch Skip Flashing Engine (`js/betaflight/preset.js`, `js/ui/status.js`, `js/core/pipeline.js`)**:
  - Якщо початковий аналіз `diff all` виявляє **0% розбіжностей** із пресетом (`mismatchStats.mismatchCount === 0`), система розпізнає пристрій як вже прошитий.
  - Повторний запис команд у флеш-пам'ять FC та зайва команда `save` скасовуються.
  - Статус Кроку 1 переводиться в `success` із явним текстом біля іконки успіху: `<span class="step-status success">✅ Вже прошитий пристрій</span>`.
  - Підпункти Кроку 1 інформують: `1. Пропущено (0% diff)`, `2. Звірено (100% збіг)`, `3. Перевірено (Вже прошитий)`.
  - Конвеєр спрощеного режиму відображає `Вже прошитий (0% розбіжностей, пропущено)` та без затримки на перезавантаження продовжує перехід до Кроку 2 (ESC).

* **Operator Instructions & FAQ Redesign (`index5.html`, `css/components.css`)**:
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

* **Pipeline Status & Left Panel Parity Fixes (`js/core/pipeline.js`, `index5.html`)**:
  - Усунено зависання іконки Кроку 2 в статусі `working`: при успішному записі пресету FC іконка одразу переводиться в статус `success`, навіть якщо через відсутність LiPo батареї зупиняється налаштування ESC.
  - Досягнуто паритету лівої інфо-панелі між спрощеним та експертним режимами: поля **«Дата збірки»** та **«MCU»** відображаються завжди, а блок «Порівняння з пресетом» залишено ексклюзивно для режиму експерта.
  - Кнопку «Дозволити новий пристрій» приховано з інтерфейсу (запит дозволу відбувається безпосередньо при натисканні на прошивку або виборі порту).
