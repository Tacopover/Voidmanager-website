// Centralized VoidManager schema constants. All table/column names and enum values
// live here only (per CLAUDE.md). Fail loudly elsewhere on missing columns.

/**
 * The six approval status values, in display order.
 *
 * CRITICAL: case-sensitive, lowercase with spaces. These must match the VoidManager
 * Revit add-in / VmoViewer exactly, or edits written back to the .db won't be recognized.
 */
export const APPROVAL_STATUSES = [
  'concept',
  'open for review',
  'approved',
  'rejected',
  'released for execution',
  'executed',
] as const;

export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export function isApprovalStatus(value: string): value is ApprovalStatus {
  return (APPROVAL_STATUSES as readonly string[]).includes(value);
}
