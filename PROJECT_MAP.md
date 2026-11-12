# PROJECT_MAP: `index.html`

> **Drone Setup Station: Betaflight & BLHeli_32 Configurator**  
> Односторінковий веб-додаток (Single-Page HTML Application) на базі **Web Serial API** для прошивки пресетів польотного контролера (Betaflight CLI), моніторингу телеметрії та % неспівпадіння зі стеком, захищеного конфігурування/резервного копіювання регуляторів обертів (BLHeli_32 через MSP 4-Way Passthrough) та двостороннього управління дампами в IndexedDB.

---

## 1. Загальна структура інтерфейсу (`index.html`)

| Розділ | Елементи / Селектори | Опис |
| :--- | :--- | :--- |
| **Панель вибору COM-порту** | `.top-bar`, `#appVersionBadge`, `#portSelect`, `#btnToggleMode`, `#boardTargetBadge` | Верхній бар з індикатором версії додатка (`#appVersionBadge`), вибором Web Serial пристрою, перемикачем режимів (Спрощений ⇄ Експертний) та індикатором цільової плати (`SPEDIXF722`). |
| **Ліва інфо-панель (Sidebar)** | `.sidebar-col`, `.info-card`, `#infoCardFc`, `#infoCardEsc` | Розділена на два блоки: **Крок 1** (параметри FC: `#infoBoardName`, `#infoFirmwareVer`, `#infoBuildDate`, `#infoMcuType`, `#infoDeviceId`, іконки перевірки `#checkBoard`..`#checkDeviceId`, бейджі неспівпадіння `#infoMismatchBadge`, `#infoMismatchNote`) та **Крок 2** (телеметрія ESC: `#infoEscModel`, `#infoEscMcu`, `#infoEscPowerAck`, `#infoEscDirs`, `#infoEscPresetStatus`, іконки перевірки `#checkEscModel`..`#checkEscPreset`). |
| **Крок 1: Заливання пресету FC** | `#cardStep1`, `#fcFlashProgress`, `#subStepFlash`..`#subStepVerify`, `#fcStateBadge`, `#fcHistoryBadge`, `#stepStatus1`, `#presetInput`, `.controls-toolbar` | 3-етапний індикатор суб-кроків, бейджі 3-станної ідентифікації (`ALREADY_FLASHED`, `NEW_HARDWARE`), редактор пресету та згруповані панелі інструментів: Прошивка, База дампів IndexedDB (`fc_preset_dumps`), Бекап/Відновлення з файлів. |
| **Крок 2: Настройка BLHeli_32** | `#cardStep2`, `#escFlowPipeline`, `#escFlowConnect`..`#escFlowClose`, `#badgeEsc0`..`#badgeEsc3`, `#badgeEscAlreadyFlashed`, `#stepStatus2`, `.controls-toolbar` | 5-етапний конвеєр налаштування ESC (Підключення ➔ Заливка ➔ Перевірка ➔ Статус OK ➔ Закриття), бейджі 4-х моторів, згруповані панелі інструментів: 4-Way Сесія, Прошивка/Читання 256-байтного контейнера, База дампів IndexedDB (`esc_preset_dumps`), Бекап/Відновлення з JSON файлів. |
| **Крок 3: Перевірка та реверс моторів** | `#cardStep3`, `#chkPropellersRemoved`, `#quadCenterDiagram`, `#drone-schema-img`, `#podMotor1`..`#podMotor4`, `#btnSpinAllMotors`, `#btnStopAllMotors`, `#throttleSlider`, `#btnSaveMotorDirections`, `#stepStatus3` | Інтерактивна 3-колонкова схема QuadX, захисний чекбокс-інтерлок пропелерів (прихований та авто-підтверджений у спрощеному режимі), авто-запуск 4-х моторів при переході до Кроку 3, DShot-реверс (`MSP_SET_PASSTHROUGH`), живий повзунок обертів у режимі експерта та кнопка «🏁 Завершити налаштування» (збереження в EEPROM ESC `0x0C`, закриття порту, деактивація кнопок Кроку 3 та зарахування в статистику). |
| **Панель логування (Console)** | `.log-panel`, `#log`, `#btnExportLogsJson`, `#btnClearLogs` | Консоль реального часу з автоскролом, експортом структурованих логів у JSON та швидким очищенням (експертний режим). |
| **Права колонка (Спрощений режим)** | `.right-col`, `#simplifiedRightCol`, `#progBanner`, `#progStep1`..`#progStep5`, `#statDailySuccess`, `#statAllSuccess`, `#statDailyNewHw`, `#statAllNewHw` | Таймлайн 5 етапів (включаючи 5. Налаштування моторів) з таймерами, лічильники успішних прошивок і нових FC (за день і за весь час) на базі `localStorage`. |
| **Інструкція оператора / FAQ** | `.faq-card`, `.faq-section`, `.faq-btn-pill-master`, `.faq-badge-pass`, `.faq-badge-fail` | Структурований покроковий посібник (До підключення, Під час прошивки, Після прошивки, Питання та помилки) з візуальними бейджами дій. |
| **Модальні вікна** | `#statusModal`, `#modalBox`, `#instructionsModal`, `#chkAgreeInstructions`, `#btnConfirmInstructions`, `#btnCancelInstructions` | Спливаюче інформаційне вікно нотифікацій та діалогів (`js/ui/modal.js`, автоматично фільтрується у спрощеному режимі для усунення переривань на Кроках 1 та 2, залишаючи лише фінальний попап після «🏁 Завершити налаштування»), а також обов'язковий одноразовий інструктаж оператора станції перед першим запуском. |
| **Точка завантаження скриптів** | `<script type="module" src="./js/main.js"></script>` | Повністю модульний нативний ES Modules JavaScript без зовнішніх бандлерів. |

---

## 2. DOM-елементи та UI-компоненти

### Управління COM-портом та верхній бар
* `#appVersionBadge` — бейдж версії та дати збірки додатку (`js/core/version.js`).
* `#portSelect` — випадаючий список доступних Web Serial портів + опція `+ Обрати / Додати новий порт...`.
* `#btnGrantPort` — прихована кнопка швидкого запиту порту.
* `#btnToggleMode` — перемикач між спрощеним (One-Click) та експертним режимами інтерфейсу.
* `#boardTargetBadge` — бейдж еталонної цільової плати (`Target: SPEDIXF722`).

### Ліва інфо-панель польотника та ESC (FC & ESC Info Panel)
* `#infoCardFc` — контейнер картки інформації польотника (Крок 1).
* `#infoCardEsc` — контейнер картки інформації ESC (Крок 2).
* `#infoBoardName` + `#checkBoard` — назва плати / target FC та статус збігу з пресетом.
* `#infoFirmwareVer` + `#checkFw` — версія прошивки Betaflight (строго `4.5.1`) та статус збігу.
* `#infoBuildDate` + `#checkDate` — дата збірки прошивки (синхронізована зі статусом версії).
* `#infoMcuType` + `#checkMcu` — архітектура MCU (`STM32F7X2`) та статус валідності.
* `#infoDeviceId` + `#checkDeviceId` — апаратний `mcu_id` процесора FC.
* `#infoMismatchBadge` — відсоток неспівпадіння конфігурації стеку з пресетом (`match-exact`, `match-low-diff`, `match-high-diff`).
* `#infoMismatchNote` — лічильник розбіжностей параметрів.
* `#infoEscModel` + `#checkEscModel` — відкрита модель регуляторів (`BLHeli_32` vs `Bluejay 8-bit`).
* `#infoEscMcu` + `#checkEscMcu` — сигнатура процесора ESC (строго `0x4706`).
* `#infoEscPowerAck` + `#checkEscPower` — статус живлення регуляторів (ACK `0x00` / `0x0F` LiPo).
* `#infoEscDirs` + `#checkEscDirs` — статус моторів 1..4 та напрямок обертання.
* `#infoEscPresetStatus` + `#checkEscPreset` — статус відповідності пресету регуляторів.

### Крок 1: Польотний контролер (FC)
* `#fcStateBadge` — бейдж стану FC (`⚡ Вже прошитий`, `⚠️ Нове обладнання`).
* `#fcHistoryBadge` — індикатор історії обладнання (якщо плата раніше була `NEW_HARDWARE`).
* `#stepStatus1` — головний індикатор Кроку 1 (`awaiting`, `working`, `success`, `fail`).
* `#fcFlashProgress` (`#subStepFlash`, `#subStepReadDiff`, `#subStepVerify`) — три підпункти виконання запису FC.
* `#presetInput` — поле редагування тексту пресету CLI.
* **Група 1 (⚡ Прошивка):**
  * `#btnFlashFC` — залити робочий пресет у FC.
  * `#btnComparePreset` — 3-сторонній аналіз конфігурації FC проти цільового та чистого пресетів.
  * `#btnFlashCleanFC` — залити чистий заводський дамп.
* **Група 2 (💾 База дампів IndexedDB `fc_preset_dumps`):**
  * `#btnExportNewHwDump` — експорт збережених `diff all` та `dump all` у файли.
  * `#btnRestoreDiffFromDb` — автоматична прошивка збереженого `diff all` назад у FC.
  * `#btnRestoreDumpFromDb` — автоматична прошивка збереженого повного `dump all` назад у FC.
* **Група 3 (📁 Бекап):**
  * `#backupType` — вибір типу збереження (`diff all` / `dump all`).
  * `#btnBackup` — збереження поточної конфігурації у файл.
  * `#btnRestoreFCFromFile` + `#fileRestoreFC` — відновлення конфігурації з зовнішнього файлу.

### Крок 2: Регулятори обертів (ESC)
* `#badgeEscAlreadyFlashed` — бейдж попередньої повної відповідності пресету.
* `#stepStatus2` — головний індикатор Кроку 2 (`awaiting`, `working`, `success`, `fail`).
* `#escFlowPipeline` (`#escFlowConnect`, `#escFlowFlash`, `#escFlowVerify`, `#escFlowStatus`, `#escFlowClose`) — 5-етапний індикатор конвеєра налаштування регуляторів.
* `#badgeEsc0`..`#badgeEsc3` — індивідуальні картки стану 4-х моторів (`pending`, `working`, `ok`, `fail`).
* **Група 1 (🔗 Сесія):**
  * `#btnConnectESC` — встановлення 4-Way з'єднання через MSP 245.
  * `#btnDisconnectESC` — розрив сесії та надсилання `CMD_INTERFACE_EXIT (0x34)`.
* **Група 2 (⚡ Прошивка):**
  * `#btnConfigureESC` — запис повного 256-байтного крипто-контейнера `BL32_GOLDEN_PRESET_256` (`0xF800`).
  * `#btnReadESC` — повне зчитування налаштувань 4-х регуляторів.
* **Група 3 (💾 База дампів IndexedDB `esc_preset_dumps`):**
  * `#btnExportEscDb` — завантаження збереженого бекапу 4 ESC з IndexedDB у JSON-файл.
  * `#btnRestoreEscDb` — автоматичне відновлення збереженого бекапу 4 ESC з IndexedDB.
* **Група 4 (📁 Файли):**
  * `#btnBackupESC` — ручне збереження бекапу 4 ESC у JSON-файл.
  * `#btnRestoreESC` + `#fileRestoreESC` — ручне відновлення з вибраного JSON-файлу.

### Крок 3: Перевірка та реверс моторів (Motor Direction & Test)
* `#cardStep3` — контейнер блоку Кроку 3.
* `#stepStatus3` — статус виконання Кроку 3 (`awaiting`, `working`, `success`, `fail`).
* `#chkPropellersRemoved` — обов'язковий чекбокс підтвердження зняття пропелерів (розблоковує пуск).
* `#quadCenterDiagram` + `.drone-schema-img` — центрована на повну висоту схема рами QuadX (`img/drone-quad-x.png`) з орієнтирами носа та хвоста.
* `#podMotor1`..`#podMotor4` — візуальні картки моторів 1..4 із статусом обертання, стрілкою та кнопками швидкого реверсу (`#btnRevMotor1`..`#btnRevMotor4`).
* **Панель інструментів тестування:**
  * `#btnSpinAllMotors` — одночасний пуск 4-х моторів на низьких безпечних обертах (`MSP_SET_MOTOR 214`).
  * `#btnStopAllMotors` — негайна зупинка моторів (`1000µs`).
  * `#throttleSlider` + `#throttleValBadge` — ручний регулятор обертів (1000..1200µs) у режимі експерта з живим оновленням тяги в польоті.
  * `#btnApplyDefaultThrottle` — скидання тестової швидкості до дефолтних `1060µs`.
  * `#btnSaveMotorDirections` — кнопка «🏁 Завершити налаштування»: постійна фіксація обраних напрямків у пам'ять ESC через команду DShot `0x0C` (`DSHOT_CMD_SAVE_SETTINGS`), безпечне закриття послідовного порту та зарахування успішної конфігурації у статистику.

### Права колонка прогресу та статистики
* `#btnRunSimplified` — єдина кнопка автоматичного проходження всіх етапів прошивки станції.
* `#progBanner` — великий інформаційний статусний банер поточного етапу.
* `#progStep1`..`#progStep5` — 5-кроковий таймлайн конвеєра з вимірюванням часу виконання (включаючи фінальний крок 5 «Налаштування моторів»).
* `#statDailySuccess`, `#statAllSuccess` — лічильники успішно налаштованих дронів.
* `#statDailyNewHw`, `#statAllNewHw` — лічильники виявлених контролерів з нестандартними налаштуваннями.
