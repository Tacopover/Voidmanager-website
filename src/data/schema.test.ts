import { describe, it, expect } from 'vitest';
import { APPROVAL_STATUSES, isApprovalStatus } from './schema';

describe('approval statuses', () => {
  it('has the six exact values in order', () => {
    expect(APPROVAL_STATUSES).toEqual([
      'concept',
      'open for review',
      'approved',
      'rejected',
      'released for execution',
      'executed',
    ]);
  });

  it('matches valid values exactly (case-sensitive)', () => {
    expect(isApprovalStatus('approved')).toBe(true);
    expect(isApprovalStatus('released for execution')).toBe(true);
  });

  it('rejects wrong casing and unknown values', () => {
    expect(isApprovalStatus('Approved')).toBe(false);
    expect(isApprovalStatus('open_for_review')).toBe(false);
    expect(isApprovalStatus('done')).toBe(false);
  });
});
