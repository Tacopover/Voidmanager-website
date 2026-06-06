/**
 * Normalize raw spatial structure from BIM models into clean trees for React UI.
 *
 * BIM models expose a recursive tree structure via `getSpatialStructure()` where nodes
 * ALTERNATE between "category" nodes (IFC type codes like IFCPROJECT, IFCSITE, etc.,
 * with `category` set and `localId` null) and "item" nodes (actual element instances
 * with a numeric `localId` and `category` null). This module flattens that alternation
 * into a uniform tree where every node has consistent fields for React tree browsers.
 *
 * The normalized tree:
 *   - Preserves the full hierarchy (no collapsing).
 *   - Carries a `modelId` on every node (for distinguishing which loaded model it came from).
 *   - Uses deterministic, unique `id` values derived from the path from root.
 *   - Provides human-readable `label` fields (e.g. "IFCBUILDINGSTOREY" → "Building Storey").
 *   - Separates category nodes (category != null, localId == null) from item nodes
 *     (localId != null, category == null) via the `category` and `localId` fields.
 */

/**
 * Raw node shape as returned by FragmentsModel.getSpatialStructure().
 * Nodes alternate between category (category set, localId null) and item (localId set, category null).
 */
export interface RawSpatialNode {
  /** Numeric element ID if this is an item node; null if this is a category node. */
  localId: number | null;
  /** IFC category code (e.g. "IFCPROJECT") if this is a category node; null if this is an item node. */
  category: string | null;
  /** Child nodes (undefined or null is treated as empty array). */
  children?: RawSpatialNode[] | null;
}

/**
 * Normalized node for the React tree UI.
 * Every node has consistent fields: id, label, category, localId, modelId, children.
 */
export interface TreeNode {
  /**
   * Stable, deterministic unique identifier within the model.
   * Format: "<modelId>:loc:<localId>" for item nodes, "<modelId>:cat:<category>:<path>" for category nodes.
   * Path is built from the hierarchical traversal (e.g. "0.0.1") to ensure uniqueness even if
   * localId or category values repeat.
   */
  id: string;

  /** Human-readable label. */
  label: string;

  /**
   * IFC category code if this is a category node (e.g. "IFCPROJECT", "IFCSITE", "IFCBUILDINGSTOREY").
   * Null if this is an item node.
   */
  category: string | null;

  /**
   * Element localId if this is an item node.
   * Null if this is a category node.
   */
  localId: number | null;

  /** Which loaded model this node belongs to. */
  modelId: string;

  /** Normalized children. */
  children: TreeNode[];
}

/**
 * Convert a category code to a human-readable label.
 *
 * Rule:
 *   1. Remove leading "IFC" (case-insensitive).
 *   2. Split the remaining ALLCAPS token on word boundaries using pattern matching:
 *      - camelCase boundaries (lowercase→uppercase)
 *      - CAPS followed by Title boundaries (e.g., "BUILDINGStorey" splits into "BUILDING" and "Storey")
 *      - Known compound suffixes (TYPE, STOREY when they appear as the start of a new logical word)
 *   3. Convert each word to Title Case.
 *   4. Join with spaces.
 *
 * Examples:
 *   "IFCBUILDINGSTOREY" → "Building Storey"
 *   "IFCPROJECT" → "Project"
 *   "IFCSITE" → "Site"
 *   "IFCRELATIONSHIP" → "Relationship"
 *   "IFCDOORTYPE" → "Door Type"
 *
 * Algorithm: Use regex replacements to insert markers before word boundaries, then split.
 * Focus on common compound suffixes that are typically standalone words (TYPE, STOREY),
 * and avoid splitting suffixes that are integral to a single logical word (like SHIP in RELATIONSHIP).
 */
function categoryToLabel(category: string): string {
  // Remove leading "IFC" (case-insensitive).
  const stripped = category.replace(/^ifc/i, '');
  if (!stripped) return category; // Fallback if the whole thing was "IFC".

  let text = stripped;

  // Handle CAPS-then-Title: insert before a capital that's preceded by capital
  // and followed by capital-then-lowercase. E.g., "BUILDING|STOREY" (where STOREY is Title-cased in input).
  text = text.replace(/([A-Z])([A-Z][a-z])/g, '$1|$2');

  // Also handle camelCase or BrokenCase: insert marker before a capital preceded by lowercase.
  text = text.replace(/([a-z])([A-Z])/g, '$1|$2');

  // Insert markers before "TYPE" when it appears as a compound suffix, but be conservative:
  // Only split before "TYPE" when it's preceded by another word (at least 4+ chars before it),
  // to avoid splitting "RELATIONSHIP" into "RELATION|SHIP".
  // Match: at least 4 chars, then "TYPE" or "STOREY" at end or before another capital.
  text = text.replace(/([A-Z]{4,})(TYPE|STOREY)(?=[A-Z]|$)/g, '$1|$2');

  // Split on the markers.
  const words = text.split('|');

  // Title case each word and join.
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Normalize one model's raw spatial structure into a clean TreeNode tree.
 *
 * @param root - The raw root node from `FragmentsModel.getSpatialStructure()`.
 * @param modelId - The model identifier to attach to every node.
 * @param names - Optional localId→Name lookup so the tree shows real element names.
 * @param modelName - Optional human-readable model name (e.g. filename without extension).
 *   When provided, overrides the root node's category-derived label so the browser
 *   shows the filename rather than "Project".
 * @returns The normalized root TreeNode.
 */
export function normalizeSpatialStructure(
  root: RawSpatialNode,
  modelId: string,
  names: Record<number, string> = {},
  modelName?: string,
): TreeNode {
  const tree = normalizeNode(root, modelId, '0', names);
  if (modelName) return { ...tree, label: modelName };
  return tree;
}

/**
 * Internal: recursively normalize a single raw node.
 *
 * @param node - The raw node.
 * @param modelId - Model identifier.
 * @param path - Hierarchical path from root (e.g. "0", "0.1", "0.1.2").
 * @returns The normalized TreeNode.
 */
function normalizeNode(
  node: RawSpatialNode,
  modelId: string,
  path: string,
  names: Record<number, string>,
): TreeNode {
  // Determine if this is a category node or an item node.
  const isCategory = node.category !== null && node.category !== undefined;
  const isItem = node.localId !== null && node.localId !== undefined;

  // Build the id: use the path for uniqueness, plus the localId or category for clarity.
  let id: string;
  let label: string;

  if (isItem) {
    id = `${modelId}:loc:${node.localId}`;
    // Prefer the element's real Name; fall back to "#<localId>" when unknown.
    const name = names[node.localId as number];
    label = name && name.length > 0 ? name : `#${node.localId}`;
  } else if (isCategory) {
    id = `${modelId}:cat:${node.category}:${path}`;
    label = categoryToLabel(node.category as string);
  } else {
    // Neither category nor item set. This shouldn't happen in a well-formed tree,
    // but handle it gracefully.
    id = `${modelId}:unknown:${path}`;
    label = '(Unknown)';
  }

  // Normalize children.
  const rawChildren = node.children ?? [];
  const children: TreeNode[] = rawChildren.map((child, index) =>
    normalizeNode(child, modelId, `${path}.${index}`, names),
  );

  return {
    id,
    label,
    category: node.category ?? null,
    localId: node.localId ?? null,
    modelId,
    children,
  };
}
