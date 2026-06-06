/**
 * boxUtils.test.ts — Tests for camera-framing bounding box helpers.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { unionBoxes, sphereFromBox } from './boxUtils';

describe('unionBoxes', () => {
  it('should union two disjoint boxes into their combined min/max', () => {
    const box1 = new THREE.Box3(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 1, 1)
    );
    const box2 = new THREE.Box3(
      new THREE.Vector3(10, 10, 10),
      new THREE.Vector3(11, 11, 11)
    );

    const result = unionBoxes([box1, box2]);

    expect(result.min.x).toBeCloseTo(0);
    expect(result.min.y).toBeCloseTo(0);
    expect(result.min.z).toBeCloseTo(0);
    expect(result.max.x).toBeCloseTo(11);
    expect(result.max.y).toBeCloseTo(11);
    expect(result.max.z).toBeCloseTo(11);
  });

  it('should ignore empty boxes in the input', () => {
    const box1 = new THREE.Box3(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 1, 1)
    );
    const emptyBox = new THREE.Box3().makeEmpty();

    const result = unionBoxes([emptyBox, box1, emptyBox]);

    expect(result.min.x).toBeCloseTo(0);
    expect(result.min.y).toBeCloseTo(0);
    expect(result.min.z).toBeCloseTo(0);
    expect(result.max.x).toBeCloseTo(1);
    expect(result.max.y).toBeCloseTo(1);
    expect(result.max.z).toBeCloseTo(1);
  });

  it('should return empty box when input is empty array', () => {
    const result = unionBoxes([]);

    expect(result.isEmpty()).toBe(true);
  });

  it('should return empty box when all input boxes are empty', () => {
    const emptyBox1 = new THREE.Box3().makeEmpty();
    const emptyBox2 = new THREE.Box3().makeEmpty();

    const result = unionBoxes([emptyBox1, emptyBox2]);

    expect(result.isEmpty()).toBe(true);
  });
});

describe('sphereFromBox', () => {
  it('should return null for an empty box', () => {
    const emptyBox = new THREE.Box3().makeEmpty();

    const result = sphereFromBox(emptyBox);

    expect(result).toBeNull();
  });

  it('should derive sphere center and radius from a unit box centered at origin', () => {
    const box = new THREE.Box3(
      new THREE.Vector3(-0.5, -0.5, -0.5),
      new THREE.Vector3(0.5, 0.5, 0.5)
    );

    const sphere = sphereFromBox(box);

    expect(sphere).not.toBeNull();
    expect(sphere!.center.x).toBeCloseTo(0);
    expect(sphere!.center.y).toBeCloseTo(0);
    expect(sphere!.center.z).toBeCloseTo(0);
    // Unit box from -0.5 to 0.5 has radius sqrt(3) * 0.5 ≈ 0.866
    expect(sphere!.radius).toBeGreaterThanOrEqual(0.5);
  });

  it('should enforce minRadius on a degenerate (point) box', () => {
    const pointBox = new THREE.Box3(
      new THREE.Vector3(1, 2, 3),
      new THREE.Vector3(1, 2, 3)
    );

    const sphere = sphereFromBox(pointBox);

    expect(sphere).not.toBeNull();
    expect(sphere!.center.x).toBeCloseTo(1);
    expect(sphere!.center.y).toBeCloseTo(2);
    expect(sphere!.center.z).toBeCloseTo(3);
    expect(sphere!.radius).toBeCloseTo(0.5); // default minRadius
  });

  it('should respect custom minRadius on a tiny box', () => {
    const tinyBox = new THREE.Box3(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.001, 0.001, 0.001)
    );
    const customMinRadius = 2.5;

    const sphere = sphereFromBox(tinyBox, customMinRadius);

    expect(sphere).not.toBeNull();
    expect(sphere!.radius).toBeCloseTo(customMinRadius);
  });

  it('should not clamp radius for large boxes', () => {
    const largeBox = new THREE.Box3(
      new THREE.Vector3(-10, -10, -10),
      new THREE.Vector3(10, 10, 10)
    );
    const minRadius = 0.5;

    const sphere = sphereFromBox(largeBox, minRadius);

    expect(sphere).not.toBeNull();
    // Large box should have radius > minRadius
    expect(sphere!.radius).toBeGreaterThan(minRadius);
  });
});
