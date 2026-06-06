import { describe, it, expect } from 'vitest';
import { mergeDirty } from './statusEdit';

describe('statusEdit — mergeDirty', () => {
  it('adds ids to an empty set', () => {
    const result = mergeDirty(new Set(), [1, 2, 3]);
    expect([...result].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('is additive — keeps prior ids', () => {
    const result = mergeDirty(new Set([1, 2]), [3]);
    expect([...result].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('dedupes ids already present', () => {
    const result = mergeDirty(new Set([1, 2]), [2, 2, 1]);
    expect([...result].sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('does not mutate the input set (immutable)', () => {
    const prev = new Set([1]);
    const result = mergeDirty(prev, [2]);
    expect(prev.size).toBe(1);
    expect(result).not.toBe(prev);
    expect(result.has(2)).toBe(true);
  });

  it('handles an empty ids iterable', () => {
    const prev = new Set([5]);
    const result = mergeDirty(prev, []);
    expect([...result]).toEqual([5]);
    expect(result).not.toBe(prev);
  });
});
