/**
 * Unit tests for voidMeshes.ts
 *
 * THREE.js geometry math works headless in jsdom/node — no WebGL context needed.
 * We test:
 *   - Mesh count matches non-garbage voids (voids with valid location + size).
 *   - Circle void produces a CylinderGeometry.
 *   - Rectangle void produces a BoxGeometry.
 *   - Positions are scaled by 0.001 (mm → m).
 *   - Garbage voids (location > 1e7 or size > 100 000) are skipped.
 *   - Voids without a location are skipped (no mesh).
 *   - setVoidHighlight switches material correctly.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildVoidMeshes, setVoidHighlight } from './voidMeshes';
import type { VoidRow } from '../../data/VoidRepository';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const BASE: VoidRow = {
  id: 1,
  externalId: null,
  type: 'circle',
  status: 'concept',
  assignedTo: null,
  story: null,
  host: null,
  sizeMm: { diameter: 200 },
  thicknessMm: 300,
  location: { x: 1000, y: 2000, z: 3000 },
  direction: { x: 0, y: 0, z: 1 },
  sequenceName: null,
  isClosed: false,
};

function makeCircle(overrides: Partial<VoidRow> = {}): VoidRow {
  return { ...BASE, ...overrides, type: 'circle', sizeMm: { diameter: 200, ...overrides.sizeMm } };
}

function makeRect(overrides: Partial<VoidRow> = {}): VoidRow {
  return {
    ...BASE,
    ...overrides,
    type: 'rectangle',
    sizeMm: { width: 400, height: 600, ...overrides.sizeMm },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildVoidMeshes', () => {
  it('returns one mesh for one valid circle void', () => {
    const { group, byVoidId, skippedCount } = buildVoidMeshes([makeCircle({ id: 10 })]);
    expect(byVoidId.size).toBe(1);
    expect(group.children.length).toBe(1);
    expect(skippedCount).toBe(0);
  });

  it('returns one mesh for one valid rectangle void', () => {
    const { byVoidId } = buildVoidMeshes([makeRect({ id: 20 })]);
    expect(byVoidId.size).toBe(1);
  });

  it('circle void yields a CylinderGeometry', () => {
    const { byVoidId } = buildVoidMeshes([makeCircle({ id: 1 })]);
    const mesh = byVoidId.get(1)!;
    expect(mesh).toBeDefined();
    expect(mesh.geometry).toBeInstanceOf(THREE.CylinderGeometry);
  });

  it('rectangle void yields a BoxGeometry', () => {
    const { byVoidId } = buildVoidMeshes([makeRect({ id: 2 })]);
    const mesh = byVoidId.get(2)!;
    expect(mesh).toBeDefined();
    expect(mesh.geometry).toBeInstanceOf(THREE.BoxGeometry);
  });

  it('positions are scaled by 0.001 (mm → m)', () => {
    const void_ = makeCircle({ id: 3, location: { x: 5000, y: -2000, z: 1000 } });
    const { byVoidId } = buildVoidMeshes([void_]);
    const mesh = byVoidId.get(3)!;
    expect(mesh.position.x).toBeCloseTo(5.0);
    expect(mesh.position.y).toBeCloseTo(-2.0);
    expect(mesh.position.z).toBeCloseTo(1.0);
  });

  it('tags mesh with userData.voidId', () => {
    const { byVoidId } = buildVoidMeshes([makeCircle({ id: 42 })]);
    const mesh = byVoidId.get(42)!;
    expect(mesh.userData.voidId).toBe(42);
  });

  it('skips voids with location coordinates exceeding MAX_COORD_MM (1e7)', () => {
    const garbage = makeCircle({ id: 99, location: { x: 1e8, y: 0, z: 0 } });
    const good = makeCircle({ id: 1 });
    const { byVoidId, skippedCount } = buildVoidMeshes([garbage, good]);
    expect(byVoidId.has(99)).toBe(false);
    expect(byVoidId.has(1)).toBe(true);
    expect(skippedCount).toBe(1);
  });

  it('skips voids with diameter exceeding MAX_SIZE_MM (100 000)', () => {
    const garbage = makeCircle({ id: 99, sizeMm: { diameter: 200_000 } });
    const { byVoidId, skippedCount } = buildVoidMeshes([garbage]);
    expect(byVoidId.size).toBe(0);
    expect(skippedCount).toBe(1);
  });

  it('skips voids without a location (no mesh, not counted as garbage)', () => {
    const noLoc = makeCircle({ id: 5, location: null });
    const good = makeCircle({ id: 6 });
    const { byVoidId, skippedCount } = buildVoidMeshes([noLoc, good]);
    expect(byVoidId.has(5)).toBe(false);
    expect(byVoidId.has(6)).toBe(true);
    expect(skippedCount).toBe(0); // no-location voids are not "garbage"
  });

  it('skips rectangle voids missing width or height', () => {
    const noSize = makeRect({ id: 7, sizeMm: { width: undefined, height: undefined } });
    const { byVoidId } = buildVoidMeshes([noSize]);
    expect(byVoidId.size).toBe(0);
  });

  it('mixed list: only valid voids produce meshes', () => {
    const voids: VoidRow[] = [
      makeCircle({ id: 1 }),
      makeCircle({ id: 2, location: null }),
      makeCircle({ id: 3, location: { x: 5e7, y: 0, z: 0 } }), // garbage
      makeRect({ id: 4 }),
      makeRect({ id: 5, sizeMm: { width: 200_000, height: 300 } }), // garbage
    ];
    const { byVoidId, skippedCount } = buildVoidMeshes(voids);
    expect(byVoidId.size).toBe(2); // ids 1 and 4
    expect(byVoidId.has(1)).toBe(true);
    expect(byVoidId.has(4)).toBe(true);
    expect(skippedCount).toBe(2);
  });

  it('accepts custom scale option', () => {
    const void_ = makeCircle({ id: 10, location: { x: 1000, y: 0, z: 0 } });
    const { byVoidId } = buildVoidMeshes([void_], { scale: 0.01 });
    const mesh = byVoidId.get(10)!;
    expect(mesh.position.x).toBeCloseTo(10.0);
  });

  it('uses fallback thickness when thicknessMm is null', () => {
    // With null thickness a mesh is still created (fallback = 300 mm)
    const void_ = makeCircle({ id: 11, thicknessMm: null });
    const { byVoidId } = buildVoidMeshes([void_]);
    expect(byVoidId.has(11)).toBe(true);
  });

  it('rectangle X-axis direction: height axis aligns with Revit Z (vertical)', () => {
    // Regression: X-axis wall voids previously had width/height swapped because
    // setFromUnitVectors left roll unconstrained, mapping local +Y to horizontal.
    const xVoid = makeRect({ id: 30, direction: { x: 1, y: 0, z: 0 } });
    const { byVoidId } = buildVoidMeshes([xVoid]);
    const mesh = byVoidId.get(30)!;
    const localY = new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.quaternion);
    // Local +Y (height) must be parallel to Revit Z (0,0,1), not horizontal.
    expect(localY.x).toBeCloseTo(0);
    expect(localY.y).toBeCloseTo(0);
    expect(Math.abs(localY.z)).toBeCloseTo(1);
  });

  it('rectangle Y-axis direction: height axis aligns with Revit Z (vertical)', () => {
    const yVoid = makeRect({ id: 31, direction: { x: 0, y: 1, z: 0 } });
    const { byVoidId } = buildVoidMeshes([yVoid]);
    const mesh = byVoidId.get(31)!;
    const localY = new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.quaternion);
    expect(localY.x).toBeCloseTo(0);
    expect(localY.y).toBeCloseTo(0);
    expect(Math.abs(localY.z)).toBeCloseTo(1);
  });
});

// ---------------------------------------------------------------------------
// setVoidHighlight
// ---------------------------------------------------------------------------

describe('setVoidHighlight', () => {
  it('switches material when toggled on', () => {
    const { byVoidId } = buildVoidMeshes([makeCircle({ id: 1 })]);
    const mesh = byVoidId.get(1)!;
    const normalMat = mesh.material;
    setVoidHighlight(mesh, true);
    expect(mesh.material).not.toBe(normalMat);
    expect((mesh.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xfbbf24);
  });

  it('restores a normal-looking material when toggled off', () => {
    const { byVoidId } = buildVoidMeshes([makeCircle({ id: 2 })]);
    const mesh = byVoidId.get(2)!;
    setVoidHighlight(mesh, true);
    setVoidHighlight(mesh, false);
    expect((mesh.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0x38bdf8);
  });
});
