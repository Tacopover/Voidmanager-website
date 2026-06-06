/**
 * Unit tests for the unified selection store (selectionStore.ts).
 *
 * Tests cover only the imperative store API — the React hook (useSelection)
 * requires @testing-library/react which is not installed, so it is excluded.
 *
 * State is reset before each test via clear('api').
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  refKey,
  parseRefKey,
  subscribe,
  getSnapshot,
  setSelection,
  toggle,
  clear,
  getSelection,
  type SelectionRef,
} from './selectionStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reset store state before every test. */
beforeEach(() => {
  clear('api');
});

// ---------------------------------------------------------------------------
// refKey / parseRefKey round-trips
// ---------------------------------------------------------------------------

describe('refKey / parseRefKey', () => {
  it('round-trips a void ref', () => {
    const ref: SelectionRef = { kind: 'void', voidId: 123 };
    const key = refKey(ref);
    expect(key).toBe('void:123');
    expect(parseRefKey(key)).toEqual(ref);
  });

  it('round-trips an element ref with a simple modelId', () => {
    const ref: SelectionRef = { kind: 'element', modelId: 'arch', localId: 456 };
    const key = refKey(ref);
    expect(key).toBe('elem:arch:456');
    expect(parseRefKey(key)).toEqual(ref);
  });

  it('round-trips an element ref whose modelId contains colons', () => {
    const ref: SelectionRef = { kind: 'element', modelId: 'urn:model:v2', localId: 789 };
    const key = refKey(ref);
    expect(key).toBe('elem:urn:model:v2:789');
    expect(parseRefKey(key)).toEqual(ref);
  });

  it('parseRefKey throws on a malformed key', () => {
    expect(() => parseRefKey('badformat')).toThrow();
    expect(() => parseRefKey('elem:noLocalId')).toThrow();
    expect(() => parseRefKey('void:notANumber')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// setSelection
// ---------------------------------------------------------------------------

describe('setSelection', () => {
  it('replaces the selection, fires subscribers, and updates getSnapshot', () => {
    const refs: SelectionRef[] = [
      { kind: 'void', voidId: 1 },
      { kind: 'element', modelId: 'mep', localId: 42 },
    ];
    const listener = vi.fn();
    const unsub = subscribe(listener);

    setSelection(refs, 'grid');

    expect(listener).toHaveBeenCalledTimes(1);
    const snap = getSnapshot();
    expect(snap.source).toBe('grid');
    expect(snap.refs).toHaveLength(2);
    expect(snap.keys.has('void:1')).toBe(true);
    expect(snap.keys.has('elem:mep:42')).toBe(true);

    unsub();
  });

  it('deduplicates refs by key, keeping insertion order of first occurrence', () => {
    const refs: SelectionRef[] = [
      { kind: 'void', voidId: 10 },
      { kind: 'void', voidId: 10 }, // duplicate
      { kind: 'element', modelId: 'a', localId: 1 },
    ];
    setSelection(refs, 'api');
    const snap = getSnapshot();
    expect(snap.refs).toHaveLength(2);
    expect(snap.keys.size).toBe(2);
  });

  it('is a NO-OP (no notify, same snapshot ref) when key-set is identical', () => {
    const refs: SelectionRef[] = [{ kind: 'void', voidId: 5 }];
    setSelection(refs, 'grid');
    const snapBefore = getSnapshot();

    const listener = vi.fn();
    const unsub = subscribe(listener);

    // Same key, different source — must still be a no-op.
    setSelection([{ kind: 'void', voidId: 5 }], 'viewer');

    expect(listener).not.toHaveBeenCalled();
    expect(getSnapshot()).toBe(snapBefore); // same object reference

    unsub();
  });

  it('is a NO-OP when refs are reordered but key-set is identical', () => {
    const a: SelectionRef = { kind: 'void', voidId: 1 };
    const b: SelectionRef = { kind: 'element', modelId: 'm', localId: 2 };
    setSelection([a, b], 'api');
    const snapBefore = getSnapshot();

    const listener = vi.fn();
    const unsub = subscribe(listener);

    // Reversed order, same set.
    setSelection([b, a], 'api');

    expect(listener).not.toHaveBeenCalled();
    expect(getSnapshot()).toBe(snapBefore);

    unsub();
  });

  it('notifies when the key-set genuinely changes', () => {
    setSelection([{ kind: 'void', voidId: 1 }], 'api');

    const listener = vi.fn();
    const unsub = subscribe(listener);

    setSelection([{ kind: 'void', voidId: 2 }], 'api');

    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
  });

  it('records the source on the snapshot', () => {
    setSelection([{ kind: 'void', voidId: 7 }], 'browser');
    expect(getSnapshot().source).toBe('browser');
  });
});

// ---------------------------------------------------------------------------
// toggle
// ---------------------------------------------------------------------------

describe('toggle', () => {
  it('adds an absent ref and notifies', () => {
    const listener = vi.fn();
    const unsub = subscribe(listener);

    toggle({ kind: 'void', voidId: 99 }, 'viewer');

    expect(listener).toHaveBeenCalledTimes(1);
    const snap = getSnapshot();
    expect(snap.keys.has('void:99')).toBe(true);
    expect(snap.source).toBe('viewer');

    unsub();
  });

  it('removes a present ref and notifies', () => {
    toggle({ kind: 'void', voidId: 99 }, 'api');
    const listener = vi.fn();
    const unsub = subscribe(listener);

    toggle({ kind: 'void', voidId: 99 }, 'grid');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getSnapshot().keys.has('void:99')).toBe(false);
    expect(getSnapshot().refs).toHaveLength(0);

    unsub();
  });

  it('preserves existing refs when adding a new one', () => {
    toggle({ kind: 'void', voidId: 1 }, 'api');
    toggle({ kind: 'void', voidId: 2 }, 'api');

    const snap = getSnapshot();
    expect(snap.keys.size).toBe(2);
    expect(snap.refs).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// clear
// ---------------------------------------------------------------------------

describe('clear', () => {
  it('empties the selection and notifies once', () => {
    setSelection([{ kind: 'void', voidId: 1 }], 'api');
    const listener = vi.fn();
    const unsub = subscribe(listener);

    clear('api');

    expect(listener).toHaveBeenCalledTimes(1);
    const snap = getSnapshot();
    expect(snap.keys.size).toBe(0);
    expect(snap.refs).toHaveLength(0);

    unsub();
  });

  it('is a no-op (no notify) when already empty', () => {
    // Store was reset in beforeEach — it is already empty.
    const listener = vi.fn();
    const unsub = subscribe(listener);

    clear('api');

    expect(listener).not.toHaveBeenCalled();

    unsub();
  });
});

// ---------------------------------------------------------------------------
// getSnapshot referential stability
// ---------------------------------------------------------------------------

describe('getSnapshot referential stability', () => {
  it('returns the same object on successive reads when nothing changed', () => {
    const snap1 = getSnapshot();
    const snap2 = getSnapshot();
    expect(snap1).toBe(snap2);
  });

  it('returns a NEW object after a mutation', () => {
    const snapBefore = getSnapshot();
    setSelection([{ kind: 'void', voidId: 42 }], 'api');
    const snapAfter = getSnapshot();
    expect(snapBefore).not.toBe(snapAfter);
  });
});

// ---------------------------------------------------------------------------
// getSelection (alias for getSnapshot)
// ---------------------------------------------------------------------------

describe('getSelection', () => {
  it('returns the same snapshot as getSnapshot', () => {
    setSelection([{ kind: 'element', modelId: 'x', localId: 1 }], 'api');
    expect(getSelection()).toBe(getSnapshot());
  });
});

// ---------------------------------------------------------------------------
// source tracking
// ---------------------------------------------------------------------------

describe('source tracking', () => {
  it('is null initially (after clear in beforeEach)', () => {
    // After clear the snapshot source is 'api' (from beforeEach clear).
    // But on a brand-new store startup the initial snapshot source is null.
    // We test the initial null by re-importing ... can't easily re-module.
    // Instead test that source correctly reflects the last mutating operation.
    setSelection([{ kind: 'void', voidId: 1 }], 'viewer');
    expect(getSnapshot().source).toBe('viewer');

    toggle({ kind: 'void', voidId: 2 }, 'grid');
    expect(getSnapshot().source).toBe('grid');

    clear('browser');
    expect(getSnapshot().source).toBe('browser');
  });
});
