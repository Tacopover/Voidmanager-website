/**
 * statusEdit.ts — pure helpers for in-memory status editing (M14).
 *
 * Status edits are visual/in-memory only this round (write-back to the
 * mutation-versioned .db is deferred — see docs/SCHEMA_FINDINGS.md). The grid
 * tracks which void ids have been edited so an "N unsaved" indicator can be
 * shown; this helper computes the updated dirty set immutably.
 */

/** Return a NEW set = `prev` plus every id in `ids` (immutable; never mutates `prev`). */
export function mergeDirty(prev: ReadonlySet<number>, ids: Iterable<number>): Set<number> {
  const next = new Set(prev);
  for (const id of ids) next.add(id);
  return next;
}
