/**
 * dbLocator.ts — locate and open the single VoidManager `.db` file.
 *
 * Primary path (Chromium / File System Access API):
 *   showDirectoryPicker() → auto-selects the single *.db entry.
 *   Returns bytes + FileSystemFileHandle (for future write-back) + canWriteBack:true.
 *   Persists the directory handle in IndexedDB so subsequent page loads can
 *   re-acquire without re-picking (permission is re-verified before use).
 *
 * Fallback path (no FS Access API or user chooses a single file):
 *   <input type="file" accept=".db"> → bytes + canWriteBack:false.
 *
 * Degradation:
 *   - No FS Access API   → fallback silently.
 *   - No IndexedDB       → skip persistence silently.
 *   - Permission denied  → remove stale handle from IDB, re-prompt.
 */

// ---------------------------------------------------------------------------
// Minimal local type stubs for the File System Access API.
// The TypeScript DOM lib does not yet include these types; we declare just
// enough to type-check our usage without an extra @types package.
// ---------------------------------------------------------------------------

interface FileSystemPermissionDescriptor {
  mode: 'read' | 'readwrite';
}

interface FileSystemHandleWithPermission extends FileSystemDirectoryHandle {
  queryPermission(desc: FileSystemPermissionDescriptor): Promise<PermissionState>;
  requestPermission(desc: FileSystemPermissionDescriptor): Promise<PermissionState>;
}

interface DirectoryPickerOptions {
  startIn?: string;
  id?: string;
  mode?: 'read' | 'readwrite';
}

interface WindowWithFSA extends Window {
  showDirectoryPicker(opts?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
}

// ---------------------------------------------------------------------------
// Pure helper — unit-testable in Node
// ---------------------------------------------------------------------------

/**
 * Given a list of file/entry names, return the first name that ends with
 * ".db" (case-insensitive), or null if none matches.
 *
 * This is the only part of the locator that is unit-tested; the browser API
 * surface (showDirectoryPicker, FileSystemFileHandle, IndexedDB) gets
 * Playwright E2E coverage instead.
 */
export function pickDbEntry(names: string[]): string | null {
  for (const name of names) {
    if (name.toLowerCase().endsWith('.db')) return name;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface DbLocatorResult {
  bytes: Uint8Array;
  /**
   * Present only when the File System Access API was used.
   * Keep this handle for the future write-back path.
   */
  fileHandle?: FileSystemFileHandle;
  /** True when the File System Access API was used (Chromium). */
  canWriteBack: boolean;
}

// ---------------------------------------------------------------------------
// IndexedDB persistence helpers
// ---------------------------------------------------------------------------

const IDB_DB_NAME = 'VoidManagerLocator';
const IDB_STORE_NAME = 'dirHandles';
const IDB_KEY = 'lastDirHandle';

function openLocatorIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    const idb = await openLocatorIdb();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE_NAME, 'readwrite');
      const req = tx.objectStore(IDB_STORE_NAME).put(handle, IDB_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // IndexedDB unavailable — ignore silently
  }
}

async function loadDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const idb = await openLocatorIdb();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE_NAME, 'readonly');
      const req = tx.objectStore(IDB_STORE_NAME).get(IDB_KEY);
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function clearDirectoryHandle(): Promise<void> {
  try {
    const idb = await openLocatorIdb();
    return new Promise((resolve) => {
      const tx = idb.transaction(IDB_STORE_NAME, 'readwrite');
      tx.objectStore(IDB_STORE_NAME).delete(IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve(); // best-effort
    });
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Core FS Access API path
// ---------------------------------------------------------------------------

/**
 * Attempt to read the .db file from a FileSystemDirectoryHandle.
 * Returns null when no .db entry is found.
 * Throws on permission errors or read failures.
 */
async function readDbFromDirectory(
  dirHandle: FileSystemDirectoryHandle,
): Promise<{ bytes: Uint8Array; fileHandle: FileSystemFileHandle } | null> {
  const names: string[] = [];
  for await (const [name] of (dirHandle as AsyncIterable<[string, FileSystemHandle]>)) {
    names.push(name);
  }

  const dbName = pickDbEntry(names);
  if (!dbName) return null;

  const fileHandle = await dirHandle.getFileHandle(dbName);
  const file = await fileHandle.getFile();
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { bytes, fileHandle };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether the File System Access API (directory picker) is available.
 */
export function hasFileSystemAccessApi(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/**
 * Try to reopen the last directory from the persisted handle without showing
 * a picker.  Returns null when:
 *  - No saved handle
 *  - Permission denied / expired (handle is cleared from IDB)
 *  - No .db file found in that directory
 */
export async function tryReopenSaved(): Promise<DbLocatorResult | null> {
  if (!hasFileSystemAccessApi()) return null;

  const dirHandle = await loadDirectoryHandle();
  if (!dirHandle) return null;

  try {
    const handleWithPerm = dirHandle as FileSystemHandleWithPermission;
    // Re-verify permission without prompting the user first.
    const perm = await handleWithPerm.queryPermission({ mode: 'read' });
    if (perm === 'denied') {
      await clearDirectoryHandle();
      return null;
    }
    if (perm === 'prompt') {
      // Try to re-request; this may show a non-intrusive permission prompt.
      const granted = await handleWithPerm.requestPermission({ mode: 'read' });
      if (granted !== 'granted') return null;
    }

    const result = await readDbFromDirectory(dirHandle);
    if (!result) return null;

    return { ...result, canWriteBack: true };
  } catch {
    // Stale handle — clean up.
    await clearDirectoryHandle();
    return null;
  }
}

/**
 * Open a directory picker, auto-detect the .db file, persist the handle.
 *
 * @param startIn - Optional filesystem well-known directory hint (e.g. "documents").
 *   Pass `undefined` to let the browser decide.
 * @throws when the user cancels the picker or no .db file is found.
 */
export async function pickDirectoryAndLocate(
  startIn?: string,
): Promise<DbLocatorResult> {
  if (!hasFileSystemAccessApi()) {
    throw new Error('File System Access API is not available in this browser.');
  }

  const pickerOpts: DirectoryPickerOptions = {};
  if (startIn) {
    pickerOpts.startIn = startIn;
  }

  const dirHandle: FileSystemDirectoryHandle =
    await (window as unknown as WindowWithFSA).showDirectoryPicker(pickerOpts);
  await saveDirectoryHandle(dirHandle);

  const result = await readDbFromDirectory(dirHandle);
  if (!result) {
    throw new Error(
      'No .db file was found in the selected directory. ' +
        'Please select the VoidManager data folder (e.g. %LOCALAPPDATA%\\VoidManager).',
    );
  }

  return { ...result, canWriteBack: true };
}

/**
 * Fallback: trigger an `<input type="file">` picker for a single .db file.
 * Works in all browsers but cannot write back (no FileSystemFileHandle).
 */
export function pickFileFallback(): Promise<DbLocatorResult> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.db';

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        reject(new Error('No file selected.'));
        return;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      resolve({ bytes, canWriteBack: false });
    };

    // If the picker is cancelled the "change" event never fires; handle "focus"
    // on the window as a proxy for cancellation.
    const onWindowFocus = () => {
      window.removeEventListener('focus', onWindowFocus);
      // Give the change event a chance to fire first.
      setTimeout(() => {
        if (!input.files?.length) {
          reject(new Error('File picker cancelled.'));
        }
      }, 300);
    };
    window.addEventListener('focus', onWindowFocus, { once: true });

    input.click();
  });
}
