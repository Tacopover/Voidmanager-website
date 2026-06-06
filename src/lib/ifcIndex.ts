/**
 * ifcIndex.ts — IFC element index + void-to-element resolver.
 *
 * Provides a lightweight in-memory index built from a loaded FragmentsModel
 * (the @thatopen/fragments model object) so that void ExternalIds can be
 * resolved to IFC element localIds (expressIDs).
 *
 * API confirmed via Context7 (@thatopen/engine_fragment v3.4.x):
 *   - `model.getLocalIds()` → Promise<number[]>
 *   - `model.getItemsData(localIds, { attributes: ["GlobalId", "Tag"] })`
 *       → Promise<Array<Record<string, { value: unknown }>>>
 *
 * NOTE ON CURRENT DATASET: The loaded IFC is the MEP model; the DB voids are
 * from a structural model.  `resolveVoidToElement` will return null for every
 * void in the current fixture because no GlobalId/Tag matches exist.  This
 * function is correct — it's the data that don't match.  The fallback void
 * meshes in voidMeshes.ts are used for 3D representation instead.
 */

import type { VoidRow } from '../data/VoidRepository';
import { guidToIfcGuid } from './revitGuid';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * In-memory index of the loaded IFC model.
 * Values are element localIds (= expressIDs in the @thatopen/fragments API).
 */
export interface IfcIndex {
  /** Revit ElementId (integer, stored as string in DB) → localId */
  byElementId: Map<number, number>;
  /** IFC GlobalId (22-char IfcGuid) → localId */
  byGlobalId: Map<string, number>;
}

// ---------------------------------------------------------------------------
// Resolver (pure — no browser/OBC needed)
// ---------------------------------------------------------------------------

/**
 * Attempt to resolve a void's ExternalId to an IFC element localId.
 *
 * Match priority:
 *   (a) Parse `void.externalId` as an integer → look up in `byElementId`.
 *   (b) Treat `void.externalId` as a raw IfcGuid (22 chars) → `byGlobalId`.
 *   (c) Treat `void.externalId` as a plain GUID (36-char dashed or 32-char
 *       hex) → convert via `guidToIfcGuid` → `byGlobalId`.
 *
 * Returns the element localId, or null if nothing matched.
 *
 * @param voidRow  The void whose ExternalId is to be resolved.
 * @param index    The IfcIndex built from the currently loaded model.
 */
export function resolveVoidToElement(voidRow: VoidRow, index: IfcIndex): number | null {
  const ext = voidRow.externalId;
  if (!ext) return null;

  // (a) Integer ElementId
  const asInt = parseInt(ext, 10);
  if (!isNaN(asInt) && String(asInt) === ext.trim()) {
    const found = index.byElementId.get(asInt);
    if (found !== undefined) return found;
  }

  // (b) Raw 22-char IfcGuid
  if (ext.length === 22) {
    const found = index.byGlobalId.get(ext);
    if (found !== undefined) return found;
  }

  // (c) Standard GUID (36-char dashed or 32-char hex) → IfcGuid
  try {
    const ifcGuid = guidToIfcGuid(ext);
    const found = index.byGlobalId.get(ifcGuid);
    if (found !== undefined) return found;
  } catch {
    // Not a GUID — silently ignore
  }

  return null;
}

// ---------------------------------------------------------------------------
// Index builder (async, uses FragmentsModel API)
// ---------------------------------------------------------------------------

/**
 * Build an IfcIndex from a loaded fragments model by reading each element's
 * GlobalId and Tag attributes.
 *
 * Uses the @thatopen/fragments v3.x API:
 *   - `model.getLocalIds()` to enumerate all element localIds.
 *   - `model.getItemsData(localIds, { attributes: ["GlobalId", "Tag"] })`
 *     to retrieve attributes in batches.
 *
 * The builder is intentionally lenient: if an element is missing GlobalId or
 * Tag it is simply skipped.  On the MEP fixture the index will be populated
 * with MEP element IDs that have no match in the DB voids — that's expected.
 *
 * @param model  A loaded FragmentsModel object (from FragmentsManager.list).
 * @returns      An IfcIndex with all GlobalId/Tag entries found.
 */
export async function buildIfcIndex(
  // Use `unknown` for the model type to avoid importing @thatopen/fragments
  // in contexts where it might not be available (e.g., unit-test environment).
  // The runtime code casts to the real type.
  model: FragmentsModelLike,
): Promise<IfcIndex> {
  const index: IfcIndex = {
    byElementId: new Map(),
    byGlobalId: new Map(),
  };

  let localIds: number[];
  try {
    localIds = await model.getLocalIds();
  } catch (e) {
    console.warn('[ifcIndex] getLocalIds() failed — returning empty index:', e);
    return index;
  }

  if (localIds.length === 0) return index;

  // Batch the attribute reads to avoid huge single requests.
  const BATCH_SIZE = 500;
  for (let i = 0; i < localIds.length; i += BATCH_SIZE) {
    const batch = localIds.slice(i, i + BATCH_SIZE);
    try {
      const data = await model.getItemsData(batch, {
        attributesDefault: false,
        attributes: ['GlobalId', 'Tag'],
      });

      for (let j = 0; j < batch.length; j++) {
        const localId = batch[j];
        const attrs = data[j];
        if (!attrs) continue;

        // Helper: extract a scalar attribute value (skips nested ItemData[])
        const getAttr = (key: string): unknown => {
          const entry = attrs[key];
          if (!entry || Array.isArray(entry)) return undefined;
          return (entry as FragsItemAttribute).value;
        };

        // GlobalId → byGlobalId
        const globalId = getAttr('GlobalId');
        if (typeof globalId === 'string' && globalId.length > 0) {
          index.byGlobalId.set(globalId, localId);
        }

        // Tag → byElementId (Revit exports Tag = ElementId as integer string)
        const tag = getAttr('Tag');
        if (tag != null) {
          const tagStr = String(tag).trim();
          const tagInt = parseInt(tagStr, 10);
          if (!isNaN(tagInt)) {
            index.byElementId.set(tagInt, localId);
          }
        }
      }
    } catch (e) {
      console.warn(`[ifcIndex] getItemsData batch ${i}–${i + BATCH_SIZE} failed:`, e);
      // Continue with next batch
    }
  }

  return index;
}

// ---------------------------------------------------------------------------
// Minimal structural type for FragmentsModel (avoids import of @thatopen/fragments)
// ---------------------------------------------------------------------------

/**
 * ItemAttribute as defined in @thatopen/fragments.
 * Each attribute has a `value` (any) and an optional `type`.
 */
export interface FragsItemAttribute {
  value: unknown;
  type?: string;
}

/**
 * ItemData as defined in @thatopen/fragments.
 * Each key maps to either an ItemAttribute or a nested ItemData[].
 */
export interface FragsItemData {
  [name: string]: FragsItemAttribute | FragsItemData[];
}

/**
 * Minimal interface matching the @thatopen/fragments FragmentsModel surface
 * used by `buildIfcIndex`.  Real models satisfy this automatically.
 */
export interface FragmentsModelLike {
  getLocalIds(): Promise<number[]>;
  getItemsData(
    localIds: number[],
    opts: { attributesDefault: boolean; attributes: string[] },
  ): Promise<FragsItemData[]>;
}
