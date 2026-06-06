/**
 * Unified selection store for the 3D BIM viewer.
 *
 * Tracks which objects are currently selected across two object kinds:
 *   - DB "void" fallback meshes, keyed by a numeric voidId.
 *   - IFC elements, keyed by modelId + numeric localId.
 *
 * A `source` tag on each mutation lets each consumer (AG Grid datagrid,
 * 3D viewer, model-browser tree) skip echoing back its own change,
 * preventing feedback loops.
 *
 * The store is a module-level singleton designed for use with React's
 * `useSyncExternalStore`. The `getSnapshot` function returns a referentially
 * stable object — the same reference is returned on every call as long as the
 * selection has not changed. A new object is only allocated on actual mutations.
 */

import { useSyncExternalStore } from 'react';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SelectionRef =
  | { kind: 'void'; voidId: number }
  | { kind: 'element'; modelId: string; localId: number };

export type SelectionSource = 'grid' | 'viewer' | 'browser' | 'api';

export interface SelectionState {
  /** Stable set of ref keys currently selected. */
  keys: ReadonlySet<string>;
  /** The selected refs (decoded), in insertion order. */
  refs: readonly SelectionRef[];
  /** Source of the most recent mutation (null initially). */
  source: SelectionSource | null;
}

// ---------------------------------------------------------------------------
// Key encoding / decoding
// ---------------------------------------------------------------------------

/**
 * Encode a ref to a stable string key.
 *
 * Void:    `"void:<voidId>"`       e.g. `"void:123"`
 * Element: `"elem:<modelId>:<localId>"`  e.g. `"elem:arch-model:456"`
 */
export function refKey(ref: SelectionRef): string {
  if (ref.kind === 'void') {
    return `void:${ref.voidId}`;
  }
  return `elem:${ref.modelId}:${ref.localId}`;
}

/**
 * Inverse of refKey. Throws on malformed input.
 *
 * @param key - A string produced by `refKey`.
 * @returns The decoded SelectionRef.
 * @throws Error if the key does not match either expected format.
 */
export function parseRefKey(key: string): SelectionRef {
  if (key.startsWith('void:')) {
    const voidId = Number(key.slice(5));
    if (!Number.isFinite(voidId)) {
      throw new Error(`parseRefKey: invalid void key "${key}"`);
    }
    return { kind: 'void', voidId };
  }

  if (key.startsWith('elem:')) {
    // Format: "elem:<modelId>:<localId>"
    // modelId may itself contain colons, so split at the LAST colon.
    const rest = key.slice(5); // "<modelId>:<localId>"
    const lastColon = rest.lastIndexOf(':');
    if (lastColon === -1) {
      throw new Error(`parseRefKey: malformed element key "${key}" — no localId separator`);
    }
    const modelId = rest.slice(0, lastColon);
    const localId = Number(rest.slice(lastColon + 1));
    if (modelId.length === 0) {
      throw new Error(`parseRefKey: empty modelId in key "${key}"`);
    }
    if (!Number.isFinite(localId)) {
      throw new Error(`parseRefKey: invalid localId in key "${key}"`);
    }
    return { kind: 'element', modelId, localId };
  }

  throw new Error(`parseRefKey: unrecognised key format "${key}"`);
}

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------

/** Listeners registered via subscribe(). */
const listeners = new Set<() => void>();

/** The single cached snapshot object. Replaced (not mutated) on every change. */
let currentSnapshot: SelectionState = {
  keys: new Set<string>(),
  refs: [],
  source: null,
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Returns true iff newKeys contains exactly the same keys as the current snapshot. */
function keySetEqual(newKeys: ReadonlySet<string>): boolean {
  const current = currentSnapshot.keys;
  if (current.size !== newKeys.size) return false;
  for (const k of newKeys) {
    if (!current.has(k)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Public store API
// ---------------------------------------------------------------------------

/**
 * Subscribe to selection changes. Returns an unsubscribe function.
 *
 * Designed for use with React's `useSyncExternalStore`.
 */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Current immutable snapshot.
 *
 * Returns the SAME object reference between calls when nothing has changed —
 * this is required by React's `useSyncExternalStore` to avoid infinite
 * render loops.
 */
export function getSnapshot(): SelectionState {
  return currentSnapshot;
}

/**
 * Replace the whole selection. Deduplicates by key (insertion order preserved
 * for the first occurrence of each key).
 *
 * This is a NO-OP (no notification) when the resulting key-set is deep-equal to
 * the current key-set — regardless of `source` or ref order — to break feedback
 * loops between the grid, viewer, and browser consumers.
 */
export function setSelection(refs: SelectionRef[], source: SelectionSource): void {
  // Build deduped key-ordered map.
  const newRefs: SelectionRef[] = [];
  const newKeys = new Set<string>();
  for (const ref of refs) {
    const k = refKey(ref);
    if (!newKeys.has(k)) {
      newKeys.add(k);
      newRefs.push(ref);
    }
  }

  // No-op guard: if key sets are equal, don't notify.
  if (keySetEqual(newKeys)) return;

  currentSnapshot = { keys: newKeys, refs: newRefs, source };
  notify();
}

/**
 * Toggle a single ref: add it if absent, remove it if present.
 *
 * Always changes the key-set (by definition) so always notifies.
 */
export function toggle(ref: SelectionRef, source: SelectionSource): void {
  const k = refKey(ref);
  const newKeys = new Set<string>(currentSnapshot.keys);
  const newRefs: SelectionRef[] = [];

  if (newKeys.has(k)) {
    // Remove: rebuild refs without this key.
    newKeys.delete(k);
    for (const existing of currentSnapshot.refs) {
      if (refKey(existing) !== k) newRefs.push(existing);
    }
  } else {
    // Add: append to existing.
    newKeys.add(k);
    newRefs.push(...currentSnapshot.refs, ref);
  }

  currentSnapshot = { keys: newKeys, refs: newRefs, source };
  notify();
}

/**
 * Clear all selection.
 *
 * No-op (no notification) if already empty.
 */
export function clear(source: SelectionSource): void {
  if (currentSnapshot.keys.size === 0) return;

  currentSnapshot = { keys: new Set<string>(), refs: [], source };
  notify();
}

/**
 * Non-hook imperative accessor — identical to `getSnapshot()`.
 */
export function getSelection(): SelectionState {
  return currentSnapshot;
}

/**
 * React hook for consuming the selection state.
 *
 * Implemented with `useSyncExternalStore` for tear-free concurrent-mode
 * reads. The server snapshot is identical to the client snapshot (selection
 * is always empty on first render, which is the correct SSR value).
 */
export function useSelection(): SelectionState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
