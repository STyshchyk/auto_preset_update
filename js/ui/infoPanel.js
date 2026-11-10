/**
 * Updates a telemetry verification check icon.
 * @param {string} elementId ID of the check element
 * @param {'idle' | 'pass' | 'fail' | 'warn'} status
 * @param {string} title Tooltip text
 */
export function setCheckStatus(elementId, status, title = '') {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.className = 'check-icon state-' + status;
    if (status === 'pass') {
        el.textContent = '✓';
    } else if (status === 'fail') {
        el.textContent = '✕';
    } else if (status === 'warn') {
        el.textContent = '!';
    } else {
        el.textContent = '—';
    }
    if (title) el.title = title;
}
/**
 * UI Renderer for Left Info Panel
 */

/**
 * Updates the left information panel with FC telemetry and mismatch percentage.
 * @param {object} fcDetails Parsed FC telemetry { board, firmware, buildDate, mcu }
 * @param {object} mismatchResult Result from calculateMismatch
 */
export function updateInfoPanel(fcDetails = {}, mismatchResult = null, options = {}) {
    const elBoard = document.getElementById('infoBoardName');
    const elFw = document.getElementById('infoFirmwareVer');
    const elDate = document.getElementById('infoBuildDate');
    const elMcu = document.getElementById('infoMcuType');
    const elDeviceId = document.getElementById('infoDeviceId');

    if (elBoard) elBoard.textContent = fcDetails.board || '—';
    if (elFw) elFw.textContent = fcDetails.firmware || '—';
    if (elDate) elDate.textContent = fcDetails.buildDate || '—';
    if (elMcu) elMcu.textContent = fcDetails.mcu || '—';
    if (elDeviceId) elDeviceId.textContent = fcDetails.deviceId || '—';

    // Оновлення статус-іконок верифікації параметрів плати
    const expectedBoard = options.expectedBoard || null;
    if (fcDetails.board) {
        if (!expectedBoard || fcDetails.board.includes(expectedBoard) || expectedBoard.includes(fcDetails.board)) {
            setCheckStatus('checkBoard', 'pass', 'Плата підтверджена: ' + fcDetails.board);
        } else {
            setCheckStatus('checkBoard', 'fail', 'Невідповідність плати: очікувалась ' + expectedBoard + ', виявлено ' + fcDetails.board);
        }
    } else {
        setCheckStatus('checkBoard', 'fail', 'Плату не визначено (UNKNOWN)');
    }

    const expectedFw = options.expectedFw || null;
    let fwCheckPass = false;
    let fwCheckFailMsg = '';

    if (fcDetails.firmware) {
        if (!expectedFw || fcDetails.firmware === expectedFw) {
            fwCheckPass = true;
            setCheckStatus('checkFw', 'pass', 'Версія BTFL підтверджена: ' + fcDetails.firmware);
        } else {
            fwCheckFailMsg = 'Невідповідність BTFL: очікувалась ' + expectedFw + ', в польотнику ' + fcDetails.firmware;
            setCheckStatus('checkFw', 'fail', fwCheckFailMsg);
        }
    } else {
        fwCheckFailMsg = 'Не вдалося зчитати версію Betaflight';
        setCheckStatus('checkFw', 'fail', fwCheckFailMsg);
    }

    // Статус дати збірки прив'язаний до статусу версії прошивки
    if (fwCheckPass) {
        setCheckStatus('checkDate', 'pass', 'Дата збірки підтверджена (збіг версії): ' + (fcDetails.buildDate || 'OK'));
    } else {
        setCheckStatus('checkDate', 'fail', 'Дата збірки не валідна (' + (fwCheckFailMsg || 'не збігається версія прошивки') + ')');
    }

    const expectedMcu = options.expectedMcu || null;
    if (fcDetails.mcu) {
        if (!expectedMcu || fcDetails.mcu.includes(expectedMcu) || expectedMcu.includes(fcDetails.mcu)) {
            setCheckStatus('checkMcu', 'pass', 'MCU підтверджено: ' + fcDetails.mcu);
        } else {
            setCheckStatus('checkMcu', 'fail', 'Невідповідність MCU: очікувався ' + expectedMcu + ', виявлено ' + fcDetails.mcu);
        }
    } else {
        setCheckStatus('checkMcu', 'fail', 'MCU не визначено');
    }

    if (fcDetails.deviceId) {
        setCheckStatus('checkDeviceId', 'pass', 'Апаратний UID верифіковано');
    } else {
        setCheckStatus('checkDeviceId', 'warn', 'UID відсутній або не зчитаний');
    }

    const elBadge = document.getElementById('infoMismatchBadge');
    const elNote = document.getElementById('infoMismatchNote');

    if (!elBadge || !elNote) return;

    if (!mismatchResult || mismatchResult.totalPresetVars === 0) {
        elBadge.textContent = '0%';
        elBadge.className = 'mismatch-badge match-exact';
        elNote.textContent = 'Змінних у пресеті не виявлено';
        return;
    }

    const pct = mismatchResult.mismatchPercent;
    elBadge.textContent = `${pct}%`;

    elBadge.className = 'mismatch-badge';
    if (pct === 0) {
        elBadge.classList.add('match-exact');
    } else if (pct <= 30) {
        elBadge.classList.add('match-low-diff');
    } else {
        elBadge.classList.add('match-high-diff');
    }

    elNote.textContent = `${mismatchResult.mismatchCount} із ${mismatchResult.totalPresetVars} змінних відрізняються`;
}

/**
 * Updates the ESC telemetry block in the left panel.
 * @param {Array<{esc: number, direction: string, presetMatched: boolean, chip: string}>} escList
 */
export function updateEscInfoPanel(escList = []) {
    let allPreset = true;
    let foundCount = 0;
    const dirParts = [];
    let detectedModel = null;
    let detectedMcu = null;
    let detectedSig = null;

    for (let i = 0; i < 4; i++) {
        const item = escList.find(e => e.esc === i);
        if (item) {
            foundCount++;
            if (!detectedModel && item.modelName) detectedModel = item.modelName;
            if (!detectedMcu && item.mcu) detectedMcu = item.mcu;
            if (!detectedSig && item.signature) detectedSig = item.signature;

            const dirLabel = item.direction === 'reversed' ? 'R' : 'N';
            const color = item.presetMatched ? '#00ff88' : '#ffaa00';
            dirParts.push(`#${i + 1}:<span style="color:#00ccff">${dirLabel}</span><span style="color:${color}">(${item.presetMatched ? '100%' : 'Stk'})</span>`);
            if (!item.presetMatched) allPreset = false;
        } else {
            dirParts.push(`#${i + 1}:<span style="color:#666">—</span>`);
            allPreset = false;
        }
    }

    // 1. Модель ESC та прошивка
    const elModel = document.getElementById('infoEscModel');
    if (elModel) {
        elModel.textContent = detectedModel || (foundCount > 0 ? 'BLHeli_32' : '—');
    }
    if (foundCount > 0 && (detectedModel || foundCount === 4)) {
        setCheckStatus('checkEscModel', 'pass', 'Модель ESC підтверджено: ' + (detectedModel || 'BLHeli_32'));
    } else if (foundCount > 0) {
        setCheckStatus('checkEscModel', 'warn', 'Частково розпізнано модель');
    } else {
        setCheckStatus('checkEscModel', 'fail', 'ESC не виявлено');
    }

    // 2. Модель процесора (MCU Signature)
    const elMcu = document.getElementById('infoEscMcu');
    if (elMcu) {
        if (detectedMcu && detectedSig) {
            elMcu.innerHTML = `<span style="color:#fff">${detectedMcu}</span> <span style="font-size:10px; color:#888;">(${detectedSig})</span>`;
        } else {
            elMcu.textContent = detectedMcu || '—';
        }
    }
    if (detectedMcu && detectedSig) {
        setCheckStatus('checkEscMcu', 'pass', 'MCU ESC: ' + detectedMcu + ' (' + detectedSig + ')');
    } else if (detectedMcu) {
        setCheckStatus('checkEscMcu', 'warn', 'MCU ESC: ' + detectedMcu);
    } else {
        setCheckStatus('checkEscMcu', 'fail', 'MCU ESC не визначено');
    }

    // 3. Живлення та ACK
    const elPower = document.getElementById('infoEscPowerAck');
    if (elPower) {
        if (foundCount === 4) {
            elPower.innerHTML = '<span style="color:#00ff88;">OK (4/4 LiPo є)</span>';
            setCheckStatus("checkEscPower", "pass", "LiPo живлення та зв'язок 4/4 ACK OK");
        } else if (foundCount > 0) {
            elPower.innerHTML = `<span style="color:#ffaa00;">Частково (${foundCount}/4)</span>`;
            setCheckStatus("checkEscPower", "warn", "Частковий зв'язок: лише " + foundCount + "/4 ESC");
        } else {
            elPower.innerHTML = '<span style="color:#ff4444;">Немає живлення / Fail</span>';
            setCheckStatus('checkEscPower', 'fail', 'Немає живлення LiPo або збій ACK');
        }
    }

    // 4. Помоторний статус
    const elDirs = document.getElementById('infoEscDirs');
    if (elDirs) {
        elDirs.innerHTML = dirParts.join(' ');
    }
    if (foundCount === 4) {
        setCheckStatus('checkEscDirs', 'pass', 'Усі 4 мотори опитано успішно');
    } else if (foundCount > 0) {
        setCheckStatus('checkEscDirs', 'warn', 'Зчитано лише ' + foundCount + '/4 моторів');
    } else {
        setCheckStatus('checkEscDirs', 'fail', 'Мотори не відповідають');
    }

    // 5. Загальний стан пресету
    const elPresetStatus = document.getElementById('infoEscPresetStatus');
    if (elPresetStatus) {
        if (foundCount === 0) {
            elPresetStatus.textContent = '—';
            elPresetStatus.style.color = '#fff';
            setCheckStatus('checkEscPreset', 'idle', 'Очікує перевірки');
        } else if (foundCount === 4 && allPreset) {
            elPresetStatus.textContent = 'Застосовано (4/4)';
            elPresetStatus.style.color = '#00ff88';
            setCheckStatus('checkEscPreset', 'pass', '100% пресет записано та підтверджено на 4/4 ESC');
        } else {
            const needWriteCount = 4 - (allPreset ? 4 : escList.filter(e => e.presetMatched).length);
            elPresetStatus.textContent = `Потрібен запис (${needWriteCount}/4)`;
            elPresetStatus.style.color = '#ffaa00';
            setCheckStatus('checkEscPreset', 'warn', 'Потрібен запис пресету на ' + needWriteCount + ' ESC');
        }
    }
}

/**
 * Resets the left info panel to its initial awaiting state.
 */
export function resetInfoPanel() {
    const elBoard = document.getElementById('infoBoardName');
    const elFw = document.getElementById('infoFirmwareVer');
    const elDate = document.getElementById('infoBuildDate');
    const elMcu = document.getElementById('infoMcuType');
    const elDeviceId = document.getElementById('infoDeviceId');
    const elBadge = document.getElementById('infoMismatchBadge');
    const elNote = document.getElementById('infoMismatchNote');

    if (elBoard) elBoard.textContent = '—';
    if (elFw) elFw.textContent = '—';
    if (elDate) elDate.textContent = '—';
    if (elMcu) elMcu.textContent = '—';
    if (elDeviceId) elDeviceId.textContent = '—';

    setCheckStatus('checkBoard', 'idle', 'Очікує перевірки');
    setCheckStatus('checkFw', 'idle', 'Очікує перевірки');
    setCheckStatus('checkDate', 'idle', 'Очікує перевірки');
    setCheckStatus('checkMcu', 'idle', 'Очікує перевірки');
    setCheckStatus('checkDeviceId', 'idle', 'Очікує перевірки');

    if (elBadge) {
        elBadge.textContent = '—';
        elBadge.className = 'mismatch-badge';
    }
    if (elNote) {
        elNote.textContent = 'Очікує запуску (натисніть «Залити»)...';
    }

    const elModel = document.getElementById('infoEscModel');
    if (elModel) elModel.textContent = '—';

    const elEscMcu = document.getElementById('infoEscMcu');
    if (elEscMcu) elEscMcu.textContent = '—';

    const elPower = document.getElementById('infoEscPowerAck');
    if (elPower) elPower.textContent = '—';

    const elDirs = document.getElementById('infoEscDirs');
    if (elDirs) elDirs.textContent = '—';

    const elPresetStatus = document.getElementById('infoEscPresetStatus');
    if (elPresetStatus) {
        elPresetStatus.textContent = '—';
        elPresetStatus.style.color = '#fff';
    }

    setCheckStatus('checkEscModel', 'idle', 'Очікує перевірки');
    setCheckStatus('checkEscMcu', 'idle', 'Очікує перевірки');
    setCheckStatus('checkEscPower', 'idle', 'Очікує перевірки');
    setCheckStatus('checkEscDirs', 'idle', 'Очікує перевірки');
    setCheckStatus('checkEscPreset', 'idle', 'Очікує перевірки');
}
