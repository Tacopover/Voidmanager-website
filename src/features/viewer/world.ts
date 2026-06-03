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
  /** Stage B hook — TODO: highlight / fit-to elements by their IFC express IDs */
  highlightByExpressIds(_modelId: string, _expressIds: number[]): void;
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

    // Count elements via FragmentsModel.getLocalIds() → Promise<number[]>
    let elementCount = 0;
    try {
      const localIds = await model.getLocalIds();
      elementCount = localIds.length;
    } catch {
      // Fallback: count via visible mesh children
      elementCount = model.object.children.length;
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

  function highlightByExpressIds(_modelId: string, _expressIds: number[]): void {
    // TODO (Stage B): implement highlight + fit-to-elements using
    // fragments.highlight() / boxer.addFromModelIdMap() + fitToSphere
    console.debug('[world] highlightByExpressIds stub — Stage B will implement this');
  }

  function dispose(): void {
    try {
      components.dispose();
    } catch (e) {
      console.warn('[world] dispose error', e);
    }
  }

  return { loadIfc, highlightByExpressIds, dispose };
}
