/**
 * Tests for spatialTree.ts — normalizing raw spatial structures into React tree nodes.
 */

import { describe, it, expect } from 'vitest';
import type { RawSpatialNode, TreeNode } from './spatialTree';
import { normalizeSpatialStructure } from './spatialTree';

describe('spatialTree — normalize spatial structures', () => {
  /**
   * Example raw spatial structure from the spec:
   * Alternating category/item nodes, full hierarchy preserved.
   */
  const exampleRawStructure: RawSpatialNode = {
    localId: null,
    category: 'IFCPROJECT',
    children: [
      {
        localId: 34,
        category: null,
        children: [
          {
            localId: null,
            category: 'IFCSITE',
            children: [
              {
                localId: 35,
                category: null,
                children: [
                  {
                    localId: null,
                    category: 'IFCBUILDINGSTOREY',
                    children: [
                      {
                        localId: 36,
                        category: null,
                        children: [],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  describe('basic structure and labels', () => {
    it('root is "Project" (IFCPROJECT → Project)', () => {
      const result = normalizeSpatialStructure(exampleRawStructure, 'm1');
      expect(result.label).toBe('Project');
      expect(result.category).toBe('IFCPROJECT');
      expect(result.localId).toBeNull();
    });

    it('root has modelId "m1"', () => {
      const result = normalizeSpatialStructure(exampleRawStructure, 'm1');
      expect(result.modelId).toBe('m1');
    });

    it('item node #34 has correct label and fields', () => {
      const result = normalizeSpatialStructure(exampleRawStructure, 'm1');
      const item34 = result.children[0];
      expect(item34.localId).toBe(34);
      expect(item34.category).toBeNull();
      expect(item34.label).toBe('#34');
      expect(item34.modelId).toBe('m1');
    });

    it('item nodes use the provided Name map, falling back to #id', () => {
      const result = normalizeSpatialStructure(exampleRawStructure, 'm1', { 34: 'Level 1' });
      const item34 = result.children[0];
      expect(item34.label).toBe('Level 1'); // named
      // #35 has no name → falls back to #id
      const item35 = item34.children[0].children[0];
      expect(item35.localId).toBe(35);
      expect(item35.label).toBe('#35');
    });

    it('category node IFCSITE has correct label', () => {
      const result = normalizeSpatialStructure(exampleRawStructure, 'm1');
      const item34 = result.children[0];
      const site = item34.children[0];
      expect(site.label).toBe('Site');
      expect(site.category).toBe('IFCSITE');
      expect(site.localId).toBeNull();
    });

    it('category node IFCBUILDINGSTOREY → "Building Storey"', () => {
      const result = normalizeSpatialStructure(exampleRawStructure, 'm1');
      const item34 = result.children[0];
      const site = item34.children[0];
      const item35 = site.children[0];
      const storey = item35.children[0];
      expect(storey.label).toBe('Building Storey');
      expect(storey.category).toBe('IFCBUILDINGSTOREY');
    });

    it('item node #36 has correct label and fields', () => {
      const result = normalizeSpatialStructure(exampleRawStructure, 'm1');
      const item34 = result.children[0];
      const site = item34.children[0];
      const item35 = site.children[0];
      const storey = item35.children[0];
      const item36 = storey.children[0];
      expect(item36.localId).toBe(36);
      expect(item36.category).toBeNull();
      expect(item36.label).toBe('#36');
      expect(item36.modelId).toBe('m1');
    });
  });

  describe('hierarchy and tree depth', () => {
    it('preserves full hierarchy depth', () => {
      const result = normalizeSpatialStructure(exampleRawStructure, 'm1');
      expect(result.children).toHaveLength(1); // IFCPROJECT → [item 34]
      const item34 = result.children[0];
      expect(item34.children).toHaveLength(1); // item 34 → [IFCSITE]
      const site = item34.children[0];
      expect(site.children).toHaveLength(1); // IFCSITE → [item 35]
      const item35 = site.children[0];
      expect(item35.children).toHaveLength(1); // item 35 → [IFCBUILDINGSTOREY]
      const storey = item35.children[0];
      expect(storey.children).toHaveLength(1); // IFCBUILDINGSTOREY → [item 36]
      const item36 = storey.children[0];
      expect(item36.children).toHaveLength(0); // item 36 → []
    });

    it('all nodes carry correct modelId', () => {
      const result = normalizeSpatialStructure(exampleRawStructure, 'm1');

      const walk = (node: TreeNode) => {
        expect(node.modelId).toBe('m1');
        for (const child of node.children) {
          walk(child);
        }
      };

      walk(result);
    });
  });

  describe('deterministic and unique ids', () => {
    it('every node has a unique id within the tree', () => {
      const result = normalizeSpatialStructure(exampleRawStructure, 'm1');
      const ids = new Set<string>();

      const walk = (node: TreeNode) => {
        expect(ids.has(node.id)).toBe(false); // Not seen before.
        ids.add(node.id);
        for (const child of node.children) {
          walk(child);
        }
      };

      walk(result);
      expect(ids.size).toBeGreaterThan(0);
    });

    it('ids remain stable across multiple normalizations of the same input', () => {
      const result1 = normalizeSpatialStructure(exampleRawStructure, 'm1');
      const result2 = normalizeSpatialStructure(exampleRawStructure, 'm1');

      const collectIds = (node: TreeNode): string[] => {
        const ids = [node.id];
        for (const child of node.children) {
          ids.push(...collectIds(child));
        }
        return ids;
      };

      expect(collectIds(result1)).toEqual(collectIds(result2));
    });

    it('item node #36 id includes its localId', () => {
      const result = normalizeSpatialStructure(exampleRawStructure, 'm1');
      const item34 = result.children[0];
      const site = item34.children[0];
      const item35 = site.children[0];
      const storey = item35.children[0];
      const item36 = storey.children[0];
      expect(item36.id).toContain('loc:36');
    });

    it('category node id includes the category code', () => {
      const result = normalizeSpatialStructure(exampleRawStructure, 'm1');
      const item34 = result.children[0];
      const site = item34.children[0];
      expect(site.id).toContain('cat:IFCSITE');
    });
  });

  describe('null/undefined children handling', () => {
    it('treats null children as empty array', () => {
      const input: RawSpatialNode = {
        localId: null,
        category: 'IFCPROJECT',
        children: null,
      };
      const result = normalizeSpatialStructure(input, 'm1');
      expect(result.children).toEqual([]);
    });

    it('treats undefined children as empty array', () => {
      const input: RawSpatialNode = {
        localId: null,
        category: 'IFCPROJECT',
        // children is undefined
      };
      const result = normalizeSpatialStructure(input, 'm1');
      expect(result.children).toEqual([]);
    });

    it('handles deeply nested structure with mixed null/undefined', () => {
      const input: RawSpatialNode = {
        localId: null,
        category: 'IFCPROJECT',
        children: [
          {
            localId: 1,
            category: null,
            children: undefined,
          },
          {
            localId: 2,
            category: null,
            children: null,
          },
        ],
      };
      const result = normalizeSpatialStructure(input, 'm1');
      expect(result.children).toHaveLength(2);
      expect(result.children[0].children).toEqual([]);
      expect(result.children[1].children).toEqual([]);
    });
  });

  describe('category label conversion', () => {
    it('IFCPROJECT → Project', () => {
      const input: RawSpatialNode = {
        localId: null,
        category: 'IFCPROJECT',
        children: [],
      };
      const result = normalizeSpatialStructure(input, 'm1');
      expect(result.label).toBe('Project');
    });

    it('IFCSITE → Site', () => {
      const input: RawSpatialNode = {
        localId: null,
        category: 'IFCSITE',
        children: [],
      };
      const result = normalizeSpatialStructure(input, 'm1');
      expect(result.label).toBe('Site');
    });

    it('IFCBUILDINGSTOREY → Building Storey', () => {
      const input: RawSpatialNode = {
        localId: null,
        category: 'IFCBUILDINGSTOREY',
        children: [],
      };
      const result = normalizeSpatialStructure(input, 'm1');
      expect(result.label).toBe('Building Storey');
    });

    it('IFCDOORTYPE → Door Type', () => {
      const input: RawSpatialNode = {
        localId: null,
        category: 'IFCDOORTYPE',
        children: [],
      };
      const result = normalizeSpatialStructure(input, 'm1');
      expect(result.label).toBe('Door Type');
    });

    it('IFCRELATIONSHIP → Relationship', () => {
      const input: RawSpatialNode = {
        localId: null,
        category: 'IFCRELATIONSHIP',
        children: [],
      };
      const result = normalizeSpatialStructure(input, 'm1');
      expect(result.label).toBe('Relationship');
    });

    it('handles lowercase "ifc" prefix (case-insensitive)', () => {
      const input: RawSpatialNode = {
        localId: null,
        category: 'ifcProject',
        children: [],
      };
      const result = normalizeSpatialStructure(input, 'm1');
      // Case-insensitive removal of "ifc", then title case.
      expect(result.label).toBe('Project');
    });
  });

  describe('modelName override', () => {
    it('uses modelName as root label when provided', () => {
      const result = normalizeSpatialStructure(exampleRawStructure, 'm1', {}, 'E_AIH_68_INS-KLI_HOM_Klimaat');
      expect(result.label).toBe('E_AIH_68_INS-KLI_HOM_Klimaat');
    });

    it('preserves root category and children when modelName overrides label', () => {
      const result = normalizeSpatialStructure(exampleRawStructure, 'm1', {}, 'MyModel');
      expect(result.category).toBe('IFCPROJECT');
      expect(result.children).toHaveLength(1);
    });

    it('falls back to category label when modelName is undefined', () => {
      const result = normalizeSpatialStructure(exampleRawStructure, 'm1', {}, undefined);
      expect(result.label).toBe('Project');
    });
  });

  describe('different model IDs', () => {
    it('different modelIds produce different node ids', () => {
      const result1 = normalizeSpatialStructure(exampleRawStructure, 'm1');
      const result2 = normalizeSpatialStructure(exampleRawStructure, 'm2');

      expect(result1.id).not.toBe(result2.id);
      expect(result1.id).toContain('m1');
      expect(result2.id).toContain('m2');
    });

    it('every node in m2 tree has modelId "m2"', () => {
      const result = normalizeSpatialStructure(exampleRawStructure, 'm2');
      const walk = (node: TreeNode) => {
        expect(node.modelId).toBe('m2');
        for (const child of node.children) {
          walk(child);
        }
      };
      walk(result);
    });
  });
});
