/**
 * IndexedDB Persistence for Drone Operation Logs
 * Stores grouped step/operation entries with duration, device UID, status, and details.
 */

const DB_NAME = 'DroneSetupStationDB';
const DB_VERSION = 3;
const STORE_NAME = 'operation_logs';
const DUMP_STORE_NAME = 'fc_preset_dumps';

let dbInstance = null;

/**
 * Initializes and returns the IndexedDB database instance.
 * @returns {Promise<IDBDatabase>}
 */
export function getDb() {
    if (dbInstance) return Promise.resolve(dbInstance);

    return new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) {
            return reject(new Error('IndexedDB не підтримується у цьому браузері.'));
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                store.createIndex('by_deviceId', 'deviceId', { unique: false });
                store.createIndex('by_timestamp', 'timestamp', { unique: false });
                store.createIndex('by_step', 'step', { unique: false });
            }
            // Dedicated store for flight controller preset dumps (dump all / diff)
            if (!db.objectStoreNames.contains(DUMP_STORE_NAME)) {
                const dumpStore = db.createObjectStore(DUMP_STORE_NAME, { keyPath: 'mcuId' });
                dumpStore.createIndex('by_savedAt', 'savedAt', { unique: false });
                dumpStore.createIndex('by_board', 'board', { unique: false });
                dumpStore.createIndex('by_type', 'dumpType', { unique: false });
            }
        };

        request.onsuccess = (event) => {
            dbInstance = event.target.result;
            resolve(dbInstance);
        };

        request.onerror = (event) => {
            reject(event.target.error || new Error('Помилка відкриття IndexedDB'));
        };
    });
}

/**
 * Saves a completed step/operation log entry into IndexedDB.
 * @param {Object} entry
 * @returns {Promise<number>} generated record id
 */
export async function saveOperationLog(entry) {
    try {
        const db = await getDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([STORE_NAME], 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req = store.add(entry);

            req.onsuccess = () => resolve(req.result);
            req.onerror = (err) => reject(err.target.error);
        });
    } catch (e) {
        console.warn('Не вдалося зберегти лог операції в IndexedDB:', e);
        return null;
    }
}

/**
 * Retrieves all stored operation logs sorted by timestamp descending.
 * @returns {Promise<Array<Object>>}
 */
export async function getAllOperationLogs() {
    const db = await getDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_NAME], 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();

        req.onsuccess = () => {
            const results = req.result || [];
            // Sort newest first
            results.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
            resolve(results);
        };
        req.onerror = (err) => reject(err.target.error);
    });
}

/**
 * Clears all stored operation logs.
 * @returns {Promise<void>}
 */
export async function clearAllOperationLogs() {
    const db = await getDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_NAME], 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.clear();

        req.onsuccess = () => resolve();
        req.onerror = (err) => reject(err.target.error);
    });
}

/**
 * Saves both diff all and dump all of an FC keyed by its mcuId into IndexedDB (Store: fc_preset_dumps).
 * @param {string} mcuId
 * @param {object} payloads - { diffAll?: string, dumpAll?: string }
 * @param {object} [metadata]
 * @returns {Promise<string>} mcuId
 */
export async function saveFcDualDump(mcuId, payloads = {}, metadata = {}) {
    if (!mcuId || mcuId === '—') return null;
    const cleanId = String(mcuId).trim().toLowerCase();
    try {
        const db = await getDb();
        return new Promise(async (resolve, reject) => {
            const existing = await getFcDump(cleanId).catch(() => null);
            const tx = db.transaction([DUMP_STORE_NAME], 'readwrite');
            const store = tx.objectStore(DUMP_STORE_NAME);

            const record = {
                mcuId: cleanId,
                diffAll: payloads.diffAll || existing?.diffAll || '',
                dumpAll: payloads.dumpAll || existing?.dumpAll || existing?.dump || '',
                dumpType: 'FC_PRESET_DUMP',
                targetType: 'FLIGHT_CONTROLLER',
                board: metadata.board || existing?.board || 'SPEDIXF722',
                firmware: metadata.firmware || existing?.firmware || '—',
                savedAt: new Date().toISOString(),
                reason: metadata.reason || existing?.reason || 'NEW_HARDWARE_BACKUP'
            };

            const req = store.put(record);
            req.onsuccess = () => resolve(cleanId);
            req.onerror = (err) => reject(err.target.error);
        });
    } catch (e) {
        console.warn('Не вдалося зберегти дампи пресету FC в IndexedDB:', e);
        return null;
    }
}

/**
 * Backward-compatible wrapper for saveFcDump.
 */
export async function saveFcDump(mcuId, dumpContent, metadata = {}) {
    return saveFcDualDump(mcuId, { dumpAll: dumpContent }, metadata);
}

/**
 * Retrieves a stored FC dump by its mcuId.
 * @param {string} mcuId
 * @returns {Promise<object|null>}
 */
export async function getFcDump(mcuId) {
    if (!mcuId || mcuId === '—') return null;
    const cleanId = String(mcuId).trim().toLowerCase();
    try {
        const db = await getDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([DUMP_STORE_NAME], 'readonly');
            const store = tx.objectStore(DUMP_STORE_NAME);
            const req = store.get(cleanId);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = (err) => reject(err.target.error);
        });
    } catch (e) {
        console.warn('Не вдалося зчитати дамп FC з IndexedDB:', e);
        return null;
    }
}

/**
 * Checks whether an FC dump exists for a given mcuId.
 * @param {string} mcuId
 * @returns {Promise<boolean>}
 */
export async function hasFcDump(mcuId) {
    const dump = await getFcDump(mcuId);
    return Boolean(dump && (dump.dumpAll || dump.diffAll));
}


