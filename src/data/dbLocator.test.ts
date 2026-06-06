/**
 * dbLocator tests.
 *
 * Only the pure `pickDbEntry` helper is unit-tested here.
 * The browser-API surface (showDirectoryPicker, FileSystemFileHandle, IndexedDB)
 * is not testable in Node — it gets Playwright E2E coverage instead.
 */

import { describe, it, expect } from 'vitest';
import { pickDbEntry } from './dbLocator';

describe('pickDbEntry', () => {
  it('returns null for an empty list', () => {
    expect(pickDbEntry([])).toBeNull();
  });

  it('returns the .db entry when present', () => {
    expect(pickDbEntry(['readme.txt', 'VoidManager.db', 'config.json'])).toBe('VoidManager.db');
  });

  it('returns the first .db entry when multiple match', () => {
    expect(pickDbEntry(['a.db', 'b.db'])).toBe('a.db');
  });

  it('is case-insensitive for the extension', () => {
    expect(pickDbEntry(['ARCHIVE.DB'])).toBe('ARCHIVE.DB');
    expect(pickDbEntry(['mixed.Db'])).toBe('mixed.Db');
  });

  it('returns null when no .db is present', () => {
    expect(pickDbEntry(['file.txt', 'image.png', 'document.pdf'])).toBeNull();
  });

  it('does not match names that merely contain .db (not as extension)', () => {
    // '.db' must be a suffix, not an infix
    expect(pickDbEntry(['my.db.backup'])).toBeNull();
  });

  it('handles a single-element list with a .db file', () => {
    expect(pickDbEntry(['project.db'])).toBe('project.db');
  });

  it('handles names with dots in the stem', () => {
    expect(pickDbEntry(['VoidManager.v2.db'])).toBe('VoidManager.v2.db');
  });
});
