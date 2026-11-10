/**
 * IndexedDB Persistence for Drone Operation Logs
 * Stores grouped step/operation entries with duration, device UID, status, and details.
 */

const DB_NAME = 'DroneSetupStationDB';
const DB_VERSION = 1;
const STORE_NAME = 'operation_logs';

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
