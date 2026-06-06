/**
 * boxUtils.ts — Camera-framing helpers for the 3D viewer.
 *
 * Combines multiple bounding boxes (selected IFC elements + void meshes, or all
 * visible objects) into a single union box, then derives a bounding sphere for
 * camera-controls `fitToSphere`.
 *
 * All functions are pure with no module-level mutable state.
 */

import * as THREE from 'three';

/**
 * Union of all the given boxes. Empty boxes are ignored.
 * Returns an EMPTY THREE.Box3 (makeEmpty) when the input is empty or all boxes are empty.
 */
export function unionBoxes(boxes: THREE.Box3[]): THREE.Box3 {
  const accumulator = new THREE.Box3().makeEmpty();

  for (const box of boxes) {
    if (!box.isEmpty()) {
      accumulator.union(box);
    }
  }

  return accumulator;
}

/**
 * Bounding sphere of a box, with a minimum radius floor so degenerate
 * (zero/near-zero) boxes still produce a visible, fittable sphere.
 * Returns null when the box is empty.
 * @param box The bounding box to convert to a sphere
 * @param minRadius default 0.5
 */
export function sphereFromBox(box: THREE.Box3, minRadius = 0.5): THREE.Sphere | null {
  if (box.isEmpty()) {
    return null;
  }

  const sphere = box.getBoundingSphere(new THREE.Sphere());
  if (sphere.radius < minRadius) {
    sphere.radius = minRadius;
  }

  return sphere;
}
