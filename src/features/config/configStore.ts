/**
 * configStore.ts — IndexedDB-backed session configuration cache.
 *
 * Stores the full bytes needed to restore a viewer session without re-picking
 * files:  the .db bytes + the pre-converted .frag bytes for each loaded IFC.
 *
 * DB name   : VoidManagerConfigs
 * Store name: configs
 * Key       : StoredConfig.name (string)
 *
 * Uint8Array values round-trip through the structured-clone algorithm that
 * IndexedDB uses internally, so no serialisation work is needed.
 *
 * All public functions degrade gracefully (try/catch) when IndexedDB is
 * unavailable (e.g. Firefox Private Browsing, some test environments).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StoredConfig {
  /** Primary key — user-supplied name (e.g. "Last session" or the .db filename). */
  name: string;
  /** Raw bytes of the .db file. */
  dbBytes: Uint8Array;
  /** Converted FRAGMENT bytes per IFC model (NOT raw IFC bytes). */
  models: { id: string; bytes: Uint8Array }[];
  /** Date.now() timestamp of when the config was last saved. */
  lastOpened: number;
}

export interface ConfigMeta {
  name: string;
  lastOpened: number;
  modelCount: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const DB_NAME = 'VoidManagerConfigs';
const DB_VERSION = 1;
const STORE_NAME = 'configs';

function openConfigDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'name' });
      }
    };
    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror = () => reject(req.error);
  });
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Save (or overwrite) a configuration in IndexedDB.
 * Silently no-ops if IndexedDB is unavailable.
 */
export async function saveConfig(cfg: StoredConfig): Promise<void> {
  try {
    const db = await openConfigDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    await idbRequest(store.put(cfg));
    db.close();
  } catch (e) {
    console.warn('[configStore] saveConfig failed:', e);
  }
}

/**
 * List all stored configuration metadata (no bytes — keeps it fast).
 * Returns an empty array on error.
 */
export async function listConfigs(): Promise<ConfigMeta[]> {
  try {
    const db = await openConfigDb();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const all = await idbRequest<StoredConfig[]>(store.getAll());
    db.close();
    return all.map(({ name, lastOpened, models }) => ({
      name,
      lastOpened,
      modelCount: models.length,
    }));
  } catch (e) {
    console.warn('[configStore] listConfigs failed:', e);
    return [];
  }
}

/**
 * Load a specific config by name (includes bytes).
 * Returns null if not found or on error.
 */
export async function loadConfig(name: string): Promise<StoredConfig | null> {
  try {
    const db = await openConfigDb();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const result = await idbRequest<StoredConfig | undefined>(store.get(name));
    db.close();
    return result ?? null;
  } catch (e) {
    console.warn('[configStore] loadConfig failed:', e);
    return null;
  }
}

/**
 * Return the most recently saved config (highest lastOpened).
 * Returns null if none exist or on error.
 */
export async function getMostRecent(): Promise<StoredConfig | null> {
  try {
    const db = await openConfigDb();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const all = await idbRequest<StoredConfig[]>(store.getAll());
    db.close();
    if (all.length === 0) return null;
    return all.reduce((best, cur) => (cur.lastOpened > best.lastOpened ? cur : best));
  } catch (e) {
    console.warn('[configStore] getMostRecent failed:', e);
    return null;
  }
}

/**
 * Delete a config by name.
 * Silently no-ops if not found or on error.
 */
export async function deleteConfig(name: string): Promise<void> {
  try {
    const db = await openConfigDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    await idbRequest(store.delete(name));
    db.close();
  } catch (e) {
    console.warn('[configStore] deleteConfig failed:', e);
  }
}
