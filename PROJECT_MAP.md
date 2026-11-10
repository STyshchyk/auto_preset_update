# PROJECT_MAP: `index5.html`

> **Drone Setup Station: Betaflight & BLHeli_32 Configurator**  
> Односторінковий веб-додаток (Single-Page HTML Application) на базі **Web Serial API** для прошивки пресетів польотного контролера (Betaflight CLI), моніторингу телеметрії та % неспівпадіння зі стеком, а також конфігурації/резервного копіювання регуляторів обертів (BLHeli_32 через MSP 4-Way Passthrough).

---

## 1. Загальна структура інтерфейсу (`index5.html`)

| Розділ | Елементи / Селектори | Опис |
| :--- | :--- | :--- |
| **Панель вибору COM-порту** | `.top-bar`, `#portSelect`, `#btnToggleMode`, `#boardTargetBadge` | Верхній бар вибору Web Serial пристрою, перемикач режимів (Спрощений ⇄ Експертний) та індикатор цільової плати. |
| **Ліва інфо-панель (Sidebar)** | `.sidebar-col`, `.info-card`, `#infoCardFc`, `#infoCardEsc` | Розділена на два блоки: **Крок 1** (параметри FC: `#infoBoardName`, `#infoFirmwareVer`, `#infoBuildDate`, `#infoMcuType`, `#infoDeviceId`, іконки перевірки `#checkBoard`, `#checkFw`, `#checkDate`, `#checkMcu`, `#checkDeviceId`, бейдж неспівпадіння `#infoMismatchBadge`, `#infoMismatchNote`) та **Крок 2** (телеметрія ESC: `#infoEscModel`, `#infoEscMcu`, `#infoEscPowerAck`, `#infoEscDirs`, `#infoEscPresetStatus`, іконки перевірки `#checkEscModel`, `#checkEscMcu`, `#checkEscPower`, `#checkEscDirs`, `#checkEscPreset`). |
| **Крок 1: Заливання пресету FC** | `#cardStep1`, `#fcFlashProgress`, `#subStepFlash`, `#subStepReadDiff`, `#subStepVerify`, `#btnRunSimplified`, `#presetInput`, `#btnFlashFC`, `#btnBackup`, `#btnSkipToEsc` | Мастер-кнопка для спрощеного режиму, робочі кнопки, textarea пресету та 3-етапний індикатор виконання (прошивка, читання, перевірка). |
| **Крок 2: Настройка BLHeli_32** | `#cardStep2`, `#escFlowPipeline`, `#escFlowConnect`..`#escFlowClose`, `#badgeEsc0`..`#badgeEsc3`, `#btnConnectESC`, `#btnDisconnectESC`, `#btnReadESC`, `#btnConfigureESC`, `#btnBackupESC`, `#btnRestoreESC`, `#fileRestoreESC` | 5-етапний конвеєр налаштування ESC (Підключення ➔ Заливка ➔ Перевірка ➔ Статус OK ➔ Закриття), кнопки сесії, статуси 4-х ESC, читання, бекап, відновлення та застосування пресету із захисним блокуванням. |
| **Панель логування (Console)** | `.log-panel`, `#log` | Консоль реального часу (прихована у спрощеному режимі). |
| **Права колонка (Спрощений режим)** | `.right-col`, `#simplifiedRightCol`, `#progBanner`, `#progStep1`..`#progStep4`, `#statDailySuccess`, `#statAllSuccess`, `.faq-card` | Панель прогресу (таймлайн 4 кроків), статистика прошитих пристроїв за унікальним ID (сьогодні та за весь час) та FAQ. |
| **Модальне вікно статусу** | `#statusModal`, `#modalBox` | Спливаюче вікно для нотифікацій про хід операцій або помилки. |
| **Точка завантаження скриптів** | `<script type="module" src="./js/main.js"></script>` | Повністю винесений JS код, нуль інлайн-скриптів у HTML. |

---

## 2. DOM-елементи та UI-компоненти

### Управління COM-портом та індикація
* `#portSelect` — випадаючий список доступних Web Serial портів + опція `+ Обрати / Додати новий порт...`.
* `#boardTargetBadge` — бейдж цільової плати (`Target: SPEDIXF722`).
* `#stepStatus1`, `#stepStatus2` — індикатори статусу виконання Кроків 1 та 2 (`awaiting`, `working`, `success`, `fail`).
* `#escFlowPipeline` — 5-етапна візуальна лінія прогресу налаштування регуляторів:
  * `#escFlowConnect` — 1. Підключення
  * `#escFlowFlash` — 2. Заливка
  * `#escFlowVerify` — 3. Перевірка
  * `#escFlowStatus` — 4. Статус OK
  * `#escFlowClose` — 5. Закриття
* `#badgeEsc0`, `#badgeEsc1`, `#badgeEsc2`, `#badgeEsc3` — індивідуальні статуси для ESC #1..#4 (`pending`, `working`, `ok`, `fail`).
* `#log` — контейнер термінального логу.
* `#statusModal`, `#modalBox`, `#modalTitle`, `#modalMsg`, `#modalCloseBtn` — елементи модального вікна.

### Ліва інфо-панель польотника та ESC (FC & ESC Info Panel)
* `#infoCardFc` — контейнер картки інформації польотника (Крок 1).
* `#infoCardEsc` — контейнер картки інформації ESC (Крок 2).
* `#infoBoardName` + `#checkBoard` — назва плати / target польотного контролера та статус збігу з пресетом.
* `#infoFirmwareVer` + `#checkFw` — версія прошивки Betaflight (наприклад, `4.5.1`) та статус збігу з пресетом.
* `#infoBuildDate` + `#checkDate` — дата та час збірки прошивки (синхронізована зі статусом версії).
* `#infoMcuType` + `#checkMcu` — архітектура MCU (наприклад, `STM32F7X2`) та статус збігу з пресетом.
* `#infoDeviceId` + `#checkDeviceId` — апаратний UID процесора та статус валідності.
* `#infoMismatchBadge` — відсоток неспівпадіння конфігурації стеку з пресетом (`match-exact`, `match-low-diff`, `match-high-diff`).
* `#infoMismatchNote` — лічильник неспівпалих змінних (`X із Y змінних відрізняються`).
* `#infoEscModel` + `#checkEscModel` — відкрита текстова назва моделі ESC (`BLHeli_32` vs `Bluejay 8-bit`) та статус валідності моделі.
* `#infoEscMcu` + `#checkEscMcu` — сигнатура процесора ESC (строго `0x4706`) та статус підтвердження чіпа.
* `#infoEscPowerAck` + `#checkEscPower` — апаратний статус зв'язку та живлення регуляторів (`OK (4/4 LiPo є)` / `Частково` / `Fail`).
* `#infoEscDirs` + `#checkEscDirs` — статус 4-х моторів та напрямок обертання.
* `#infoEscPresetStatus` + `#checkEscPreset` — статус застосування 100% пресету.
