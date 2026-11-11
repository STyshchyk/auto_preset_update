/**
 * Flashing Statistics Manager (Dual-Scope: Daily & All-Time by Unique Device ID)
 * Stored in localStorage key: 'drone_flashing_stats_v2'
 */

const STORAGE_KEY = 'drone_flashing_stats_v2';

/**
 * Returns today's date formatted as YYYY-MM-DD in local time.
 * @returns {string}
 */
export function getTodayDateString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Reads and validates stats from localStorage, performing daily auto-rollover if date changed.
 * @returns {{allTime: {successIds: string[], failIds: string[]}, daily: {date: string, successIds: string[], failIds: string[]}}}
 */
export function getStats() {
    const today = getTodayDateString();
    let stats = null;

    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            stats = JSON.parse(raw);
        }
    } catch (e) {
        console.warn('[Stats] Failed to parse stats from localStorage:', e);
    }

    if (!stats || typeof stats !== 'object') {
        stats = {
            allTime: { successIds: [], failIds: [], newHwIds: [] },
            daily: { date: today, successIds: [], failIds: [], newHwIds: [] }
        };
    }

    if (!stats.allTime) stats.allTime = { successIds: [], failIds: [], newHwIds: [] };
    if (!Array.isArray(stats.allTime.successIds)) stats.allTime.successIds = [];
    if (!Array.isArray(stats.allTime.failIds)) stats.allTime.failIds = [];
    if (!Array.isArray(stats.allTime.newHwIds)) stats.allTime.newHwIds = [];

    if (!stats.daily || stats.daily.date !== today) {
        stats.daily = {
            date: today,
            successIds: [],
            failIds: [],
            newHwIds: []
        };
        saveStats(stats);
    } else {
        if (!Array.isArray(stats.daily.successIds)) stats.daily.successIds = [];
        if (!Array.isArray(stats.daily.failIds)) stats.daily.failIds = [];
        if (!Array.isArray(stats.daily.newHwIds)) stats.daily.newHwIds = [];
    }

    return stats;
}

/**
 * Saves stats object to localStorage.
 * @param {object} stats
 */
function saveStats(stats) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
    } catch (e) {
        console.error('[Stats] Failed to write stats to localStorage:', e);
    }
}

/**
 * Records the outcome of a flashing run for a unique device ID.
 * @param {string} deviceId Unique device hex ID (e.g. '0x24002d3036510834323839')
 * @param {boolean} isSuccess Whether the full sequence succeeded
 * @returns {object} Updated stats
 */
export function recordDeviceResult(deviceId, isSuccess) {
    if (!deviceId || deviceId === '—' || deviceId === 'UNKNOWN') {
        // Fallback placeholder if hardware ID was not detected
        deviceId = 'unknown_device_' + Date.now();
    }
    const cleanId = String(deviceId).toLowerCase();
    const stats = getStats();

    if (isSuccess) {
        // Add to daily success, remove from daily fail if previously failed today
        if (!stats.daily.successIds.includes(cleanId)) {
            stats.daily.successIds.push(cleanId);
        }
        stats.daily.failIds = stats.daily.failIds.filter(id => id !== cleanId);

        // Add to all-time success, remove from all-time fail
        if (!stats.allTime.successIds.includes(cleanId)) {
            stats.allTime.successIds.push(cleanId);
        }
        stats.allTime.failIds = stats.allTime.failIds.filter(id => id !== cleanId);
    } else {
        // Only mark fail if not already counted as successful
        if (!stats.daily.successIds.includes(cleanId) && !stats.daily.failIds.includes(cleanId)) {
            stats.daily.failIds.push(cleanId);
        }
        if (!stats.allTime.successIds.includes(cleanId) && !stats.allTime.failIds.includes(cleanId)) {
            stats.allTime.failIds.push(cleanId);
        }
    }

    saveStats(stats);
    renderStatsWidget();
    return stats;
}

/**
 * Manually resets today's daily counters.
 */
export function resetDailyStats() {
    const stats = getStats();
    stats.daily = {
        date: getTodayDateString(),
        successIds: [],
        failIds: [],
        newHwIds: []
    };
    saveStats(stats);
    renderStatsWidget();
}

/**
 * Updates DOM elements for the statistics widget.
 */
export function renderStatsWidget() {
    const stats = getStats();

    const dailySuccessCount = stats.daily.successIds.length;
    const dailyFailCount = stats.daily.failIds.length;
    const dailyNewHwCount = (stats.daily.newHwIds || []).length;
    const dailyTotal = dailySuccessCount + dailyFailCount;

    const allTimeSuccessCount = stats.allTime.successIds.length;
    const allTimeFailCount = stats.allTime.failIds.length;
    const allTimeNewHwCount = (stats.allTime.newHwIds || []).length;
    const allTimeTotal = allTimeSuccessCount + allTimeFailCount;

    const elDailySuccess = document.getElementById('statDailySuccess');
    const elDailyFail = document.getElementById('statDailyFail');
    const elDailyNewHw = document.getElementById('statDailyNewHw');
    const elDailyTotal = document.getElementById('statDailyTotal');
    const elDailyDate = document.getElementById('statDailyDate');

    const elAllSuccess = document.getElementById('statAllSuccess');
    const elAllFail = document.getElementById('statAllFail');
    const elAllNewHw = document.getElementById('statAllNewHw');
    const elAllTotal = document.getElementById('statAllTotal');

    if (elDailySuccess) elDailySuccess.textContent = String(dailySuccessCount);
    if (elDailyFail) elDailyFail.textContent = String(dailyFailCount);
    if (elDailyNewHw) elDailyNewHw.textContent = String(dailyNewHwCount);
    if (elDailyTotal) elDailyTotal.textContent = String(dailyTotal);
    if (elDailyDate) elDailyDate.textContent = stats.daily.date;

    if (elAllSuccess) elAllSuccess.textContent = String(allTimeSuccessCount);
    if (elAllFail) elAllFail.textContent = String(allTimeFailCount);
    if (elAllNewHw) elAllNewHw.textContent = String(allTimeNewHwCount);
    if (elAllTotal) elAllTotal.textContent = String(allTimeTotal);
}

/**
 * Storage key for persistent tracking of MCUs detected with new / unexpected hardware configurations.
 */
const NEW_HARDWARE_STORAGE_KEY = 'drone_new_hardware_mcu_ids';

/**
 * Retrieves the list of recorded new hardware MCU IDs.
 * @returns {string[]}
 */
export function getNewHardwareMcuIds() {
    try {
        const raw = localStorage.getItem(NEW_HARDWARE_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed;
        }
    } catch (_) {}
    return [];
}

/**
 * Records an MCU ID as new / unexpected hardware in localStorage if not already recorded.
 * @param {string} mcuId
 * @returns {boolean} True if newly added, false if already present
 */
export function recordNewHardwareMcu(mcuId) {
    if (!mcuId || mcuId === '—' || mcuId === 'unknown') return false;
    const cleanId = String(mcuId).trim().toLowerCase();
    const list = getNewHardwareMcuIds();
    let isNew = false;
    if (!list.includes(cleanId)) {
        list.push(cleanId);
        try {
            localStorage.setItem(NEW_HARDWARE_STORAGE_KEY, JSON.stringify(list));
            isNew = true;
        } catch (_) {}
    }

    // Also update main stats counter (Daily and All-Time)
    const stats = getStats();
    if (!stats.daily.newHwIds.includes(cleanId)) {
        stats.daily.newHwIds.push(cleanId);
    }
    if (!stats.allTime.newHwIds.includes(cleanId)) {
        stats.allTime.newHwIds.push(cleanId);
    }
    saveStats(stats);
    renderStatsWidget();

    return isNew;
}

/**
 * Checks if a given MCU ID was previously recorded as having new / unexpected hardware configuration.
 * @param {string} mcuId
 * @returns {boolean}
 */
export function isNewHardwareMcuRecorded(mcuId) {
    if (!mcuId || mcuId === '—') return false;
    const cleanId = String(mcuId).trim().toLowerCase();
    const list = getNewHardwareMcuIds();
    return list.includes(cleanId);
}

