/**
 * world.ts — OBC Components / World setup for the 3D IFC viewer.
 *
 * Design notes:
 * - Single-threaded web-ifc only (no SharedArrayBuffer / multithreaded WASM)
 *   because GitHub Pages cannot set COOP/COEP headers.
 * - WASM files are served from public/wasm/ (copied from node_modules/web-ifc
 *   at install time via the vite.config.ts copy plugin).  The path respects
 *   import.meta.env.BASE_URL so it works both at / (dev) and at
 *   /Voidmanager-website/ (GH Pages).
 * - The fragments worker is served from public/fragments-worker.mjs and is
 *   loaded as a classic Worker (no module worker needed) via URL.createObjectURL
 *   trick in the init call.
 * - Cleanup: call WorldController.dispose() on unmount to tear down
 *   the renderer, scene, camera, and fragment models.
 */

import * as THREE from 'three';
import * as OBC from '@thatopen/components';
import type { VoidRow } from '../../data/VoidRepository';
import { buildVoidMeshes, setVoidHighlight } from './voidMeshes';
import { buildIfcIndex, resolveVoidToElement } from '../../lib/ifcIndex';
import type { IfcIndex } from '../../lib/ifcIndex';
import * as FRAGS from '@thatopen/fragments';

export interface LoadedModel {
  /** The fragments model id (set as the `name` parameter to ifcLoader.load) */
  id: string;
  /** Number of IFC items in the model */
  elementCount: number;
}

export interface LoadProgress {
  /** 0–100 */
  percent: number;
}

export interface WorldController {
  /** Load an IFC file from raw bytes. Returns info about the loaded model. */
  loadIfc(bytes: Uint8Array, name: string, onProgress?: (p: LoadProgress) => void): Promise<LoadedModel>;
  /**
   * Set (or replace) the void meshes in the scene.
   * Clears any previously built group, builds new meshes, and adds them.
   * If an IFC model is loaded, also refreshes the IfcIndex and precomputes
   * void→element matches.
   */
  setVoids(voids: VoidRow[]): Promise<void>;
  /**
   * Sync 3D highlight to the given selection.
   * For voids that resolve to an IFC element: highlight the element via the
   * fragments API.  For the rest: highlight their fallback mesh.
   * Un-highlights previously selected voids.
   * Fits the camera to the bounding sphere of all highlighted objects.
   */
  setSelectedVoids(voidIds: number[]): Promise<void>;
  /** Number of void meshes currently in the scene (0 until setVoids is called). */
  getVoidMeshCount(): number;
  /** Dispose all GPU/WebGL resources and OBC components. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build the absolute URL to the WASM directory served from public/wasm/.
 * Works in dev (base='/Voidmanager-website/' → e.g. http://localhost:5173/Voidmanager-website/wasm/)
 * and in production (base='/Voidmanager-website/' → /Voidmanager-website/wasm/).
 */
function wasmDir(): string {
  // import.meta.env.BASE_URL always ends with '/'
  return `${import.meta.env.BASE_URL}wasm/`;
}

/**
 * Return a blob: URL for the fragments worker served from public/.
 * Using a blob URL avoids CORS issues when the worker is served from a
 * different path in production.
 */
async function localWorkerUrl(): Promise<string> {
  const url = `${import.meta.env.BASE_URL}fragments-worker.mjs`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch fragments worker from ${url}: ${response.status}`);
  }
  const blob = await response.blob();
  const file = new File([blob], 'fragments-worker.mjs', { type: 'text/javascript' });
  return URL.createObjectURL(file);
}

// ---------------------------------------------------------------------------
// createWorldController
// ---------------------------------------------------------------------------

/**
 * Initialise an OBC Components instance, create a World (scene + camera +
 * renderer) mounted into `container`, and wire up the IFC import pipeline.
 *
 * @param container - The <div> element the Three.js canvas will be appended to.
 */
export async function createWorldController(container: HTMLDivElement): Promise<WorldController> {
  // ------------------------------------------------------------------
  // 1. Core OBC setup
  // ------------------------------------------------------------------
  const components = new OBC.Components();
  const worlds = components.get(OBC.Worlds);

  const world = worlds.create<OBC.SimpleScene, OBC.OrthoPerspectiveCamera, OBC.SimpleRenderer>();

  world.scene = new OBC.SimpleScene(components);
  world.renderer = new OBC.SimpleRenderer(components, container);
  world.camera = new OBC.OrthoPerspectiveCamera(components);

  components.init();

  // Dark background matching the app theme (#0f172a / --bg)
  world.scene.three.background = new THREE.Color(0x0f172a);

  // Setup scene defaults (lights, etc.)
  world.scene.setup();

  // Initial camera position — will be overridden after model load
  await world.camera.controls.setLookAt(10, 10, 10, 0, 0, 0);

  // ------------------------------------------------------------------
  // 2. Floor grid for spatial reference
  // ------------------------------------------------------------------
  const grids = components.get(OBC.Grids);
  grids.create(world);

  // ------------------------------------------------------------------
  // 3. Fragments manager — use local worker instead of fetching from unpkg
  // ------------------------------------------------------------------
  const fragments = components.get(OBC.FragmentsManager);
  const workerBlobUrl = await localWorkerUrl();
  // Do NOT use classicWorker: true — the .mjs worker uses ES module syntax
  fragments.init(workerBlobUrl);

  // When a model is added, attach it to the scene and drive the animation loop
  fragments.list.onItemSet.add(({ value: model }) => {
    model.useCamera(world.camera.three);
    world.scene.three.add(model.object);
    fragments.core.update(true);
  });

  // Keep fragments updated every camera movement
  world.camera.controls.addEventListener('update', () => {
    fragments.core.update();
  });

  // ------------------------------------------------------------------
  // 4. IFC Loader — single-threaded web-ifc, pinned WASM path
  // ------------------------------------------------------------------
  const ifcLoader = components.get(OBC.IfcLoader);
  await ifcLoader.setup({
    autoSetWasm: false,
    wasm: {
      // Path to web-ifc.wasm served from public/wasm/. Must be absolute.
      path: wasmDir(),
      absolute: true,
    },
  });

  // ------------------------------------------------------------------
  // 5. Bounding-box helper (for camera fit-to-model after load)
  // ------------------------------------------------------------------
  const boxer = components.get(OBC.BoundingBoxer);

  // ------------------------------------------------------------------
  // 6. Stage B2 state
  // ------------------------------------------------------------------

  /**
   * The current void group in the scene (null before setVoids is called).
   * Replace by removing the old group and adding a new one.
   */
  let voidGroup: THREE.Group | null = null;

  /**
   * Map from void.id → mesh for the current void group.
   * Empty before setVoids is called.
   */
  let voidMeshMap = new Map<number, THREE.Mesh>();

  /**
   * Map from void.id → IFC element localId, for voids that matched.
   * Populated by setVoids when an IFC model is loaded.
   */
  let voidToElement = new Map<number, number>();

  /** The ID of the currently loaded fragments model (null if none). */
  let loadedModelId: string | null = null;

  /** Current IfcIndex (null until an IFC is loaded). */
  let ifcIndex: IfcIndex | null = null;

  /** IDs of the currently highlighted voids (for un-highlight on next call). */
  let highlightedVoidIds: number[] = [];

  // ------------------------------------------------------------------
  // Controller implementation
  // ------------------------------------------------------------------
  async function loadIfc(
    bytes: Uint8Array,
    name: string,
    onProgress?: (p: LoadProgress) => void,
  ): Promise<LoadedModel> {
    // coordinate: false — skips coordination with base model, which can hang
    // if FragmentsManager worker isn't fully ready. We only have one model at a time.
    const model = await ifcLoader.load(bytes, false, name, {
      processData: {
        progressCallback: (percent: number) => {
          onProgress?.({ percent });
        },
      },
    });

    loadedModelId = model.modelId ?? name;

    // Count elements via FragmentsModel.getLocalIds() → Promise<number[]>
    let elementCount = 0;
    try {
      const localIds = await model.getLocalIds();
      elementCount = localIds.length;
    } catch {
      // Fallback: count via visible mesh children
      elementCount = model.object.children.length;
    }

    // Build IfcIndex for void→element resolution
    try {
      ifcIndex = await buildIfcIndex(model);
      console.debug('[world] IfcIndex built:', ifcIndex.byGlobalId.size, 'globalIds,', ifcIndex.byElementId.size, 'elementIds');
    } catch (e) {
      console.warn('[world] buildIfcIndex failed:', e);
      ifcIndex = null;
    }

    // Refresh void→element matches if voids are already loaded
    if (voidMeshMap.size > 0 && ifcIndex) {
      _refreshVoidElementMatches();
    }

    // Fit camera to the loaded model
    try {
      boxer.list.clear();
      boxer.addFromModels();
      const box = boxer.get();
      boxer.list.clear();
      if (!box.isEmpty()) {
        const sphere = new THREE.Sphere();
        box.getBoundingSphere(sphere);
        if (sphere.radius > 0) {
          await world.camera.controls.fitToSphere(sphere, true);
        }
      }
    } catch (e) {
      console.warn('[world] camera fit-to-model failed:', e);
    }

    return { id: name, elementCount };
  }

  /**
   * Precompute void→element matches using the current IfcIndex.
   * Called after either loadIfc or setVoids completes.
   */
  function _refreshVoidElementMatches(): void {
    if (!ifcIndex) return;
    voidToElement.clear();
    // We iterate the mesh map keys to get the current set of void IDs,
    // but we need the VoidRow objects to resolve.  We keep a parallel
    // array of the current voids for this purpose.
    for (const [voidId, _mesh] of voidMeshMap) {
      const voidRow = _currentVoids.find((v) => v.id === voidId);
      if (!voidRow) continue;
      const elementId = resolveVoidToElement(voidRow, ifcIndex);
      if (elementId !== null) {
        voidToElement.set(voidId, elementId);
      }
    }
    console.debug('[world] void→element matches:', voidToElement.size, 'of', voidMeshMap.size);
  }

  /** Kept in sync by setVoids — needed for resolveVoidToElement lookups. */
  const _currentVoids: VoidRow[] = [];

  async function setVoids(voids: VoidRow[]): Promise<void> {
    // Remove old void group from the scene
    if (voidGroup) {
      world.scene.three.remove(voidGroup);
      voidGroup = null;
    }
    voidMeshMap = new Map();
    voidToElement = new Map();
    highlightedVoidIds = [];

    // Keep a copy for later resolution
    _currentVoids.length = 0;
    _currentVoids.push(...voids);

    const { group, byVoidId, skippedCount } = buildVoidMeshes(voids);
    console.debug(
      `[world] setVoids: ${byVoidId.size} meshes built, ${skippedCount} garbage skipped`,
    );

    voidGroup = group;
    voidMeshMap = byVoidId;
    world.scene.three.add(voidGroup);

    // Precompute void→element matches if an IFC model is already loaded
    if (ifcIndex) {
      _refreshVoidElementMatches();
    }
  }

  async function setSelectedVoids(voidIds: number[]): Promise<void> {
    // --- Un-highlight previously selected voids ---

    // Collect element localIds that were highlighted via IFC API
    const prevElementIds = highlightedVoidIds
      .map((id) => voidToElement.get(id))
      .filter((id): id is number => id !== undefined);

    // Un-highlight IFC elements
    if (prevElementIds.length > 0 && loadedModelId) {
      const model = fragments.list.get(loadedModelId);
      if (model) {
        try {
          await model.resetHighlight(prevElementIds);
          fragments.core.update(true);
        } catch (e) {
          console.warn('[world] resetHighlight failed:', e);
        }
      }
    }

    // Un-highlight fallback meshes
    for (const prevId of highlightedVoidIds) {
      if (!voidToElement.has(prevId)) {
        const mesh = voidMeshMap.get(prevId);
        if (mesh) setVoidHighlight(mesh, false);
      }
    }

    highlightedVoidIds = [...voidIds];

    if (voidIds.length === 0) return;

    // --- Highlight newly selected voids ---

    // Separate voids into "has IFC element" and "mesh-only"
    const elementIds: number[] = [];
    const meshOnlyIds: number[] = [];
    for (const id of voidIds) {
      const elemId = voidToElement.get(id);
      if (elemId !== undefined) {
        elementIds.push(elemId);
      } else {
        meshOnlyIds.push(id);
      }
    }

    // Highlight IFC elements via fragments API
    // API confirmed via Context7: model.highlight(localIds, material) + fragments.update(true)
    if (elementIds.length > 0 && loadedModelId) {
      const model = fragments.list.get(loadedModelId);
      if (model) {
        try {
          await model.highlight(elementIds, {
            color: new THREE.Color(0xfbbf24), // amber-400
            renderedFaces: FRAGS.RenderedFaces.TWO,
            opacity: 0.85,
            transparent: true,
          });
          fragments.core.update(true);
        } catch (e) {
          console.warn('[world] model.highlight failed:', e);
        }
      }
    }

    // Highlight fallback meshes
    for (const id of meshOnlyIds) {
      const mesh = voidMeshMap.get(id);
      if (mesh) setVoidHighlight(mesh, true);
    }

    // --- Fit camera to all highlighted objects ---
    try {
      const fitBox = new THREE.Box3();

      // Add bounding boxes of highlighted IFC elements
      if (elementIds.length > 0 && loadedModelId) {
        try {
          boxer.list.clear();
          const modelIdMap: Record<string, Set<number>> = {
            [loadedModelId]: new Set(elementIds),
          };
          await boxer.addFromModelIdMap(modelIdMap);
          const box = boxer.get();
          boxer.list.clear();
          if (!box.isEmpty()) fitBox.union(box);
        } catch (e) {
          console.warn('[world] boxer.addFromModelIdMap failed:', e);
        }
      }

      // Add bounding boxes of highlighted fallback meshes
      for (const id of meshOnlyIds) {
        const mesh = voidMeshMap.get(id);
        if (mesh) {
          const meshBox = new THREE.Box3().setFromObject(mesh);
          if (!meshBox.isEmpty()) fitBox.union(meshBox);
        }
      }

      if (!fitBox.isEmpty()) {
        const sphere = new THREE.Sphere();
        fitBox.getBoundingSphere(sphere);
        // Ensure the sphere is large enough to be visible
        if (sphere.radius < 0.01) sphere.radius = 0.5;
        await world.camera.controls.fitToSphere(sphere, true);
      }
    } catch (e) {
      console.warn('[world] camera fit-to-selection failed:', e);
    }
  }

  function getVoidMeshCount(): number {
    return voidMeshMap.size;
  }

  function dispose(): void {
    try {
      components.dispose();
    } catch (e) {
      console.warn('[world] dispose error', e);
    }
  }

  return { loadIfc, setVoids, setSelectedVoids, getVoidMeshCount, dispose };
}
