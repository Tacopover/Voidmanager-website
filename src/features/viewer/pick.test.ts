import { describe, it, expect } from 'vitest';
import {
  chooseNearestHit,
  type VoidHit,
  type ElementHit,
} from './pick';

describe('pick.ts', () => {
  // =========================================================================
  // Only void hit
  // =========================================================================

  it('returns void hit when only void hits', () => {
    const voidHit: VoidHit = { kind: 'void', voidId: 42, distance: 10.0 };
    const result = chooseNearestHit(voidHit, null);
    expect(result).toEqual(voidHit);
    expect(result?.kind).toBe('void');
  });

  // =========================================================================
  // Only element hit
  // =========================================================================

  it('returns element hit when only element hits', () => {
    const elementHit: ElementHit = {
      kind: 'element',
      localId: 123,
      distance: 5.0,
    };
    const result = chooseNearestHit(null, elementHit);
    expect(result).toEqual(elementHit);
    expect(result?.kind).toBe('element');
  });

  // =========================================================================
  // Neither hit
  // =========================================================================

  it('returns null when neither hits', () => {
    const result = chooseNearestHit(null, null);
    expect(result).toBeNull();
  });

  // =========================================================================
  // Both hit — void closer
  // =========================================================================

  it('returns void when void is clearly closer', () => {
    const voidHit: VoidHit = {
      kind: 'void',
      voidId: 10,
      distance: 3.0,
    };
    const elementHit: ElementHit = {
      kind: 'element',
      localId: 20,
      distance: 8.0,
    };
    const result = chooseNearestHit(voidHit, elementHit);
    expect(result).toEqual(voidHit);
    expect(result?.kind).toBe('void');
  });

  // =========================================================================
  // Both hit — element slightly closer but within bias
  // =========================================================================

  it('returns void when element is closer but within voidBias', () => {
    // void @ 10.0, element @ 9.7 (only 0.3 closer, but default bias is 0.5)
    const voidHit: VoidHit = {
      kind: 'void',
      voidId: 10,
      distance: 10.0,
    };
    const elementHit: ElementHit = {
      kind: 'element',
      localId: 20,
      distance: 9.7,
    };
    const result = chooseNearestHit(voidHit, elementHit);
    expect(result).toEqual(voidHit);
    expect(result?.kind).toBe('void');
  });

  // =========================================================================
  // Both hit — element much closer (beyond bias)
  // =========================================================================

  it('returns element when element is much closer (beyond voidBias)', () => {
    // void @ 10.0, element @ 8.4 (1.6 closer, beyond default bias of 0.5)
    const voidHit: VoidHit = {
      kind: 'void',
      voidId: 10,
      distance: 10.0,
    };
    const elementHit: ElementHit = {
      kind: 'element',
      localId: 20,
      distance: 8.4,
    };
    const result = chooseNearestHit(voidHit, elementHit);
    expect(result).toEqual(elementHit);
    expect(result?.kind).toBe('element');
  });

  // =========================================================================
  // Both hit — exact tie
  // =========================================================================

  it('returns void on exact tie (same distance)', () => {
    const voidHit: VoidHit = {
      kind: 'void',
      voidId: 10,
      distance: 5.0,
    };
    const elementHit: ElementHit = {
      kind: 'element',
      localId: 20,
      distance: 5.0,
    };
    const result = chooseNearestHit(voidHit, elementHit);
    expect(result).toEqual(voidHit);
    expect(result?.kind).toBe('void');
  });

  // =========================================================================
  // Both hit — custom voidBias
  // =========================================================================

  it('respects custom voidBias threshold', () => {
    // With higher bias (2.0), element must be 2.0 closer to win
    const voidHit: VoidHit = {
      kind: 'void',
      voidId: 10,
      distance: 10.0,
    };
    const elementHit: ElementHit = {
      kind: 'element',
      localId: 20,
      distance: 8.5, // 1.5 closer, not enough for 2.0 bias
    };
    const result = chooseNearestHit(voidHit, elementHit, { voidBias: 2.0 });
    expect(result).toEqual(voidHit);
    expect(result?.kind).toBe('void');
  });

  it('element wins with custom voidBias when sufficiently closer', () => {
    // With bias 1.0, element at 8.9 is 1.1 closer, enough to win
    const voidHit: VoidHit = {
      kind: 'void',
      voidId: 10,
      distance: 10.0,
    };
    const elementHit: ElementHit = {
      kind: 'element',
      localId: 20,
      distance: 8.9,
    };
    const result = chooseNearestHit(voidHit, elementHit, { voidBias: 1.0 });
    expect(result).toEqual(elementHit);
    expect(result?.kind).toBe('element');
  });

  // =========================================================================
  // Edge cases
  // =========================================================================

  it('handles zero voidBias (any element closer wins)', () => {
    const voidHit: VoidHit = {
      kind: 'void',
      voidId: 10,
      distance: 10.0,
    };
    const elementHit: ElementHit = {
      kind: 'element',
      localId: 20,
      distance: 9.99, // even 0.01 closer wins
    };
    const result = chooseNearestHit(voidHit, elementHit, { voidBias: 0 });
    expect(result).toEqual(elementHit);
    expect(result?.kind).toBe('element');
  });

  it('handles very small distances', () => {
    const voidHit: VoidHit = {
      kind: 'void',
      voidId: 10,
      distance: 0.001,
    };
    const elementHit: ElementHit = {
      kind: 'element',
      localId: 20,
      distance: 0.0005,
    };
    const result = chooseNearestHit(voidHit, elementHit);
    // 0.0005 is only 0.0005 closer, less than default 0.5 bias
    expect(result).toEqual(voidHit);
    expect(result?.kind).toBe('void');
  });

  it('handles very large distances', () => {
    const voidHit: VoidHit = {
      kind: 'void',
      voidId: 10,
      distance: 1000.0,
    };
    const elementHit: ElementHit = {
      kind: 'element',
      localId: 20,
      distance: 999.0, // 1.0 closer, exceeds default 0.5 bias
    };
    const result = chooseNearestHit(voidHit, elementHit);
    expect(result).toEqual(elementHit);
    expect(result?.kind).toBe('element');
  });
});
