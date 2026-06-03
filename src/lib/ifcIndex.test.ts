/**
 * Unit tests for ifcIndex.ts — resolveVoidToElement
 *
 * Uses a mock IfcIndex only.  The buildIfcIndex function requires a real
 * FragmentsModel (browser/OBC) and is NOT tested here.
 */

import { describe, it, expect } from 'vitest';
import { resolveVoidToElement } from './ifcIndex';
import type { IfcIndex } from './ifcIndex';
import type { VoidRow } from '../data/VoidRepository';
import { ifcGuidDecompress } from './revitGuid';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const BASE_VOID: VoidRow = {
  id: 1,
  externalId: null,
  type: 'circle',
  status: 'concept',
  assignedTo: null,
  story: null,
  host: null,
  sizeMm: { diameter: 200 },
  thicknessMm: 300,
  location: null,
  direction: null,
  sequenceName: null,
  isClosed: false,
};

function makeVoid(externalId: string | null): VoidRow {
  return { ...BASE_VOID, externalId };
}

// A minimal mock index
const MOCK_INDEX: IfcIndex = {
  byElementId: new Map([
    [12345, 100],
    [99999, 200],
  ]),
  byGlobalId: new Map([
    // 22-char IfcGuid
    ['0YicDc4$P4YPxuHnqnxDPn', 300],
    // Standard GUID (guidToIfcGuid of "550e8400-e29b-41d4-a716-446655440000" →
    // we don't need to know the exact IfcGuid; we'll test that path with a real GUID)
    ['2Eg4K$r4LFz8T3Bik0ItX7', 400],
  ]),
};

// ---------------------------------------------------------------------------
// resolveVoidToElement
// ---------------------------------------------------------------------------

describe('resolveVoidToElement', () => {
  it('returns null when externalId is null', () => {
    expect(resolveVoidToElement(makeVoid(null), MOCK_INDEX)).toBeNull();
  });

  it('returns null when externalId is an empty string', () => {
    expect(resolveVoidToElement(makeVoid(''), MOCK_INDEX)).toBeNull();
  });

  it('matches by integer ElementId (path a)', () => {
    const result = resolveVoidToElement(makeVoid('12345'), MOCK_INDEX);
    expect(result).toBe(100);
  });

  it('returns null for an integer ElementId not in index', () => {
    const result = resolveVoidToElement(makeVoid('00001'), MOCK_INDEX);
    expect(result).toBeNull();
  });

  it('matches by 22-char IfcGuid (path b)', () => {
    const result = resolveVoidToElement(makeVoid('0YicDc4$P4YPxuHnqnxDPn'), MOCK_INDEX);
    expect(result).toBe(300);
  });

  it('returns null for a 22-char IfcGuid not in index', () => {
    const result = resolveVoidToElement(makeVoid('0000000000000000000000'), MOCK_INDEX);
    expect(result).toBeNull();
  });

  it('converts a dashed GUID to IfcGuid and matches (path c)', () => {
    // Build a void whose externalId is a dashed GUID that converts to the
    // IfcGuid we stored in MOCK_INDEX under '2Eg4K$r4LFz8T3Bik0ItX7'.
    // Round-trip: decompress the IfcGuid → hex → re-format as dashed GUID,
    // then verify resolveVoidToElement finds the match via path (c).
    const hex = ifcGuidDecompress('2Eg4K$r4LFz8T3Bik0ItX7');
    const dashed = [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join('-');

    const result = resolveVoidToElement(makeVoid(dashed), MOCK_INDEX);
    expect(result).toBe(400);
  });

  it('handles a non-GUID/non-integer string gracefully (returns null)', () => {
    const result = resolveVoidToElement(makeVoid('not-a-valid-id-at-all'), MOCK_INDEX);
    expect(result).toBeNull();
  });

  it('integer path takes priority over IfcGuid path for numeric strings', () => {
    // '99999' is in byElementId → should return 200, not attempt IfcGuid lookup
    const result = resolveVoidToElement(makeVoid('99999'), MOCK_INDEX);
    expect(result).toBe(200);
  });
});
