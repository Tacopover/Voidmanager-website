/**
 * pick.ts — Resolve raycasts against voids and IFC elements to a single winner.
 *
 * In the 3D viewer, a click triggers raycasts against two targets:
 *   (a) Void fallback meshes (primary domain objects)
 *   (b) IFC fragments (secondary context geometry)
 *
 * This module applies the bias rule: prefer voids UNLESS the element is
 * meaningfully closer (beyond a configurable threshold). The threshold exists
 * because the MEP model and void meshes may coexist in the same space with
 * overlapping geometry, and we want clicks on voids to reliably select voids
 * even when IFC geometry is slightly in front.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface VoidHit {
  kind: 'void';
  voidId: number;
  distance: number;
}

export interface ElementHit {
  kind: 'element';
  localId: number;
  distance: number;
}

export type PickHit = VoidHit | ElementHit;

export interface ChooseHitOptions {
  /**
   * How much closer (in world units) the element hit must be than the void hit
   * before the element wins. Larger => stronger bias toward voids.
   *
   * Default: 0.5 units (typically meters in scene space).
   *
   * Example: if voidBias = 1.0 and void is at 5.0 while element is at 4.2,
   * element is only 0.8 units closer, so void wins. If element were at 3.9
   * (1.1 units closer), element wins.
   */
  voidBias?: number;
}

// ---------------------------------------------------------------------------
// Main decision logic
// ---------------------------------------------------------------------------

/**
 * Choose the winning hit from a void raycast and an element raycast.
 *
 * Rules (in order of precedence):
 *   1. If only one side hit, return that hit.
 *   2. If neither hit, return null.
 *   3. If both hit:
 *      - Element wins ONLY if: elementHit.distance < voidHit.distance - voidBias
 *      - Otherwise void wins (includes ties and near-ties).
 *
 * @param voidHit      Result from raycast against void meshes, or null.
 * @param elementHit   Result from raycast against IFC fragments, or null.
 * @param opts         Configuration options (voidBias threshold).
 * @returns            The winning hit, or null if neither hit.
 */
export function chooseNearestHit(
  voidHit: VoidHit | null,
  elementHit: ElementHit | null,
  opts?: ChooseHitOptions,
): PickHit | null {
  const voidBias = opts?.voidBias ?? 0.5;

  // Case 1: Only void hit.
  if (voidHit && !elementHit) {
    return voidHit;
  }

  // Case 2: Only element hit.
  if (elementHit && !voidHit) {
    return elementHit;
  }

  // Case 3: Neither hit.
  if (!voidHit && !elementHit) {
    return null;
  }

  // Case 4: Both hit — apply bias rule.
  // At this point, we know both are non-null due to the checks above.
  // Element must be at least voidBias units closer to win.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const threshold = voidHit!.distance - voidBias;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  if (elementHit!.distance < threshold) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return elementHit!;
  }

  // Void wins (default).
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return voidHit!;
}
