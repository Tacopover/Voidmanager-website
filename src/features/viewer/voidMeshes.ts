/**
 * voidMeshes.ts — Build THREE.js fallback void meshes from VoidRow data.
 *
 * These meshes are the PRIMARY 3D representation for this dataset because the
 * loaded IFC is the MEP model and the DB voids do not appear in it.  The voids
 * are positioned in their own mm→m coordinate space.  They will NOT overlay the
 * MEP IFC geometry — that's expected.  When a matching structural IFC is loaded
 * alongside the DB, both files will share the same Revit internal coordinate
 * system and the meshes will align naturally.
 *
 * FUTURE CALIBRATION SEAM: pass `opts.scale` (default 0.001, mm→m) and
 * `opts.offset` (THREE.Vector3) to shift meshes into the scene's coordinate
 * frame once a shared origin is established.
 */

import * as THREE from 'three';
import type { VoidRow } from '../../data/VoidRepository';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Garbage guard: DB rows with legacy ProjectStartUp data have location /
 * size values around 1e20 – 1e21.  Anything beyond these limits is skipped.
 */
const MAX_SIZE_MM = 100_000;   // 100 m in mm
const MAX_COORD_MM = 1e7;      // 10 km in mm

/** Default scale: Revit internal mm → scene metres. */
const DEFAULT_SCALE = 0.001;

/** Fallback thickness (mm) when thicknessMm is null/zero. */
const FALLBACK_THICKNESS_MM = 300;

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

/** Accent teal — semi-transparent, readable against the dark scene background. */
const normalMaterial = new THREE.MeshStandardMaterial({
  color: new THREE.Color(0x38bdf8),   // sky-400
  emissive: new THREE.Color(0x0c4a6e),
  transparent: true,
  opacity: 0.5,
  side: THREE.DoubleSide,
  depthWrite: false,
});

/** Highlight: bright amber, fully opaque. */
const highlightMaterial = new THREE.MeshStandardMaterial({
  color: new THREE.Color(0xfbbf24),   // amber-400
  emissive: new THREE.Color(0x78350f),
  transparent: true,
  opacity: 0.85,
  side: THREE.DoubleSide,
  depthWrite: false,
});

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface VoidMeshResult {
  /** Group containing all void meshes — add to scene and remove in bulk. */
  group: THREE.Group;
  /** Map from void.id → Mesh for per-void operations. */
  byVoidId: Map<number, THREE.Mesh>;
  /** Number of void rows that were skipped due to garbage coordinates/sizes. */
  skippedCount: number;
}

export interface BuildVoidMeshesOpts {
  /**
   * Scale factor applied to all coordinates and sizes.
   * Default 0.001 (mm → metres).
   *
   * CALIBRATION SEAM: adjust this and `offset` to align void meshes with
   * the scene when a shared coordinate reference is established.
   */
  scale?: number;
  /**
   * Scene-space offset added AFTER scaling.
   * Default (0, 0, 0).  Leave as zero until calibration is done.
   */
  offset?: THREE.Vector3;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return true when any size dimension or coordinate component is outside the
 * valid range — these are legacy ProjectStartUp artefact rows.
 */
function isGarbage(v: VoidRow): boolean {
  const loc = v.location;
  if (!loc) return false; // no location → not garbage, just un-positionable

  if (
    Math.abs(loc.x) > MAX_COORD_MM ||
    Math.abs(loc.y) > MAX_COORD_MM ||
    Math.abs(loc.z) > MAX_COORD_MM
  ) {
    return true;
  }

  if (v.type === 'circle') {
    const d = v.sizeMm.diameter;
    if (d != null && d > MAX_SIZE_MM) return true;
  } else {
    const w = v.sizeMm.width;
    const h = v.sizeMm.height;
    if (w != null && w > MAX_SIZE_MM) return true;
    if (h != null && h > MAX_SIZE_MM) return true;
  }

  const t = v.thicknessMm;
  if (t != null && t > MAX_SIZE_MM) return true;

  return false;
}

/**
 * Compute a rotation quaternion that aligns the mesh's local primary axis to
 * the given world direction vector.
 *
 * Convention:
 *   - CylinderGeometry → local +Y axis is the cylinder axis.
 *   - BoxGeometry      → local +Z axis is the depth/extrusion axis.
 */
function orientTo(
  meshPrimaryAxis: 'Y' | 'Z',
  direction: { x: number; y: number; z: number } | null,
): THREE.Quaternion {
  const up = meshPrimaryAxis === 'Y'
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(0, 0, 1);

  if (!direction) return new THREE.Quaternion(); // identity → default axis

  const dir = new THREE.Vector3(direction.x, direction.y, direction.z);
  const len = dir.length();
  if (len < 1e-6) return new THREE.Quaternion(); // zero vector → identity

  dir.divideScalar(len); // normalise
  const q = new THREE.Quaternion();
  q.setFromUnitVectors(up, dir);
  return q;
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

/**
 * Build THREE.js meshes for each void in `voids` that has a valid location and
 * valid size.  Garbage rows (huge values from legacy ProjectStartUp voids) are
 * skipped.
 *
 * @param voids   VoidRow array from VoidRepository.
 * @param opts    Optional scale/offset calibration (see BuildVoidMeshesOpts).
 * @returns       A group + id-map + skip count.
 */
export function buildVoidMeshes(
  voids: VoidRow[],
  opts: BuildVoidMeshesOpts = {},
): VoidMeshResult {
  const scale = opts.scale ?? DEFAULT_SCALE;
  const offset = opts.offset ?? new THREE.Vector3(0, 0, 0);

  const group = new THREE.Group();
  group.name = 'void-meshes';

  const byVoidId = new Map<number, THREE.Mesh>();
  let skippedCount = 0;

  for (const v of voids) {
    // Must have a location to be positionable
    if (!v.location) continue;

    // Garbage guard
    if (isGarbage(v)) {
      skippedCount++;
      continue;
    }

    const thickness = v.thicknessMm && v.thicknessMm > 0
      ? v.thicknessMm
      : FALLBACK_THICKNESS_MM;

    let geometry: THREE.BufferGeometry;
    let meshPrimaryAxis: 'Y' | 'Z';

    if (v.type === 'circle') {
      const diameter = v.sizeMm.diameter;
      if (!diameter || diameter <= 0) continue; // no valid size

      const r = (diameter / 2) * scale;
      const depth = thickness * scale;
      // CylinderGeometry(radiusTop, radiusBottom, height, segments)
      geometry = new THREE.CylinderGeometry(r, r, depth, 32);
      meshPrimaryAxis = 'Y'; // cylinder axis is +Y
    } else {
      const w = v.sizeMm.width;
      const h = v.sizeMm.height;
      if (!w || !h || w <= 0 || h <= 0) continue; // no valid size

      const depth = thickness * scale;
      // BoxGeometry(width, height, depth) — depth mapped to extrusion axis (+Z)
      geometry = new THREE.BoxGeometry(w * scale, h * scale, depth);
      meshPrimaryAxis = 'Z'; // box extrusion is +Z
    }

    // Clone material so individual meshes can be toggled independently
    const mat = normalMaterial.clone();
    const mesh = new THREE.Mesh(geometry, mat);

    // Position (mm → m)
    mesh.position.set(
      v.location.x * scale + offset.x,
      v.location.y * scale + offset.y,
      v.location.z * scale + offset.z,
    );

    // Orientation
    mesh.quaternion.copy(orientTo(meshPrimaryAxis, v.direction));

    // Tag for reverse lookup
    mesh.userData.voidId = v.id;
    mesh.name = `void-${v.id}`;

    group.add(mesh);
    byVoidId.set(v.id, mesh);
  }

  return { group, byVoidId, skippedCount };
}

// ---------------------------------------------------------------------------
// Per-mesh highlight toggle
// ---------------------------------------------------------------------------

/**
 * Toggle the highlight material on a single void mesh.
 *
 * @param mesh  The mesh returned by `buildVoidMeshes`.
 * @param on    true → highlight material; false → normal material.
 */
export function setVoidHighlight(mesh: THREE.Mesh, on: boolean): void {
  mesh.material = on ? highlightMaterial.clone() : normalMaterial.clone();
}
