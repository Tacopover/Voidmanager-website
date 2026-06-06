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
import { sphereFromBox, unionBoxes } from './boxUtils';
import { chooseNearestHit, type VoidHit, type ElementHit } from './pick';
import { buildIfcIndex, resolveVoidToElement } from '../../lib/ifcIndex';
import type { IfcIndex } from '../../lib/ifcIndex';
import type { SelectionRef } from '../../store/selectionStore';
import type { RawSpatialNode } from '../browser/spatialTree';
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
  /**
   * Create a horizontal section plane at the top-Y of the selected void meshes.
   * Replaces any existing section plane. No-op if no voidIds resolve to a mesh.
   */
  sectionToVoidTops(voidIds: number[]): void;
  /** Remove the active section plane. No-op if none active. */
  clearSectionPlane(): void;
  /** True when a section plane is currently active. */
  hasSectionPlane(): boolean;
  /** Load an IFC file from raw bytes. Returns info about the loaded model. */
  loadIfc(bytes: Uint8Array, name: string, onProgress?: (p: LoadProgress) => void): Promise<LoadedModel>;
  /**
   * Serialize all currently-loaded fragment models to their .frag byte buffers.
   * Used by M6 config caching to avoid re-parsing IFC on restore.
   * Returns an empty array if no models are loaded.
   */
  exportLoadedModels(): Promise<{ id: string; bytes: Uint8Array }[]>;
  /**
   * Load a pre-converted fragments buffer directly (NO IFC re-parse).
   * Adds the model to the scene, fits the camera, and rebuilds the IfcIndex —
   * same post-conditions as loadIfc.
   */
  loadFragmentModel(id: string, bytes: Uint8Array): Promise<LoadedModel>;
  /**
   * Set (or replace) the void meshes in the scene.
   * Clears any previously built group, builds new meshes, and adds them.
   * If an IFC model is loaded, also refreshes the IfcIndex and precomputes
   * void→element matches.
   */
  setVoids(voids: VoidRow[]): Promise<void>;
  /**
   * Sync the 3D highlight to a unified selection (void meshes + IFC elements).
   * - Void refs that resolve to a matched IFC element highlight that element.
   * - Unmatched void refs highlight their fallback mesh.
   * - Element refs (from picking / model browser) highlight that element directly.
   * Un-highlights the previous selection. Does NOT move the camera; it only sets
   * the orbit pivot to the selection center (framing is the explicit Zoom buttons).
   */
  setSelection(refs: SelectionRef[]): Promise<void>;
  /** Fit the camera to the bounding sphere of the current selection (Zoom to). */
  zoomToSelection(): Promise<void>;
  /** Fit the camera to all visible objects — models + void group (Zoom to Fit). */
  zoomToFit(): Promise<void>;
  /**
   * Raycast at viewport client coordinates against both the void meshes and the
   * loaded IFC model; return the nearest hit as a SelectionRef, or null on a miss.
   * Does not mutate selection — the caller writes the result to the store.
   */
  pickAt(clientX: number, clientY: number): Promise<SelectionRef | null>;
  /**
   * Raw spatial structure(s) of the loaded model(s) for the model browser tree,
   * with a localId→Name map so the tree can show real element names.
   * Returns [] when no model is loaded.
   */
  getSpatialStructures(): Promise<
    { modelId: string; name: string; structure: RawSpatialNode; names: Record<number, string> }[]
  >;
  /**
   * Fetch all IFC attributes for a single element.
   * Returns a flat string record; empty object if model not found or call fails.
   */
  getElementProperties(modelId: string, localId: number): Promise<Record<string, string>>;
  /** TEMP diagnostic — scene/camera state snapshot for debugging. */
  debugInfo(): Record<string, unknown>;
  /** TEMP diagnostic — project first void to screen + raycast it. */
  diagVoidPick(): Record<string, unknown>;
  /** Number of void meshes currently in the scene (0 until setVoids is called). */
  getVoidMeshCount(): number;
  /** Returns true if at least one fragment model is currently loaded. */
  hasModels(): boolean;
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
  // 6. Clipper (section plane)
  // ------------------------------------------------------------------
  const casters = components.get(OBC.Raycasters);
  casters.get(world);
  const clipper = components.get(OBC.Clipper);
  clipper.enabled = true;
  // Per-material clipping: planes are NOT pushed into renderer.three.clippingPlanes
  // (global list). This prevents the section gizmo and plane visual from being
  // clipped by the very plane they represent when the arrow is flipped upward.
  // OBC handles fragment materials automatically; void mesh materials are managed
  // manually via _applyClippingToVoids below.
  clipper.localClippingPlanes = true;
  world.renderer.three.localClippingEnabled = true;

  /** UUID of the active section plane, or null when none is active. */
  let currentPlane: string | null = null;

  function sectionToVoidTops(voidIds: number[]): void {
    if (currentPlane) {
      void clipper.delete(world, currentPlane);
      currentPlane = null;
    }
    if (voidIds.length === 0) return;
    if (voidGroup) voidGroup.updateMatrixWorld(true);
    let topY = -Infinity;
    for (const voidId of voidIds) {
      const mesh = voidMeshMap.get(voidId);
      if (!mesh) continue;
      const box = new THREE.Box3().setFromObject(mesh);
      if (box.max.y > topY) topY = box.max.y;
    }
    if (!isFinite(topY)) return;
    // Normal (0, -1, 0): THREE.Plane clips where dot(n, p) + d < 0.
    // With n=(0,-1,0) and d=topY: clips where -y + topY < 0 → y > topY.
    // Everything above topY is discarded; user looks down into void openings.
    const normal = new THREE.Vector3(0, -1, 0);
    const point = new THREE.Vector3(0, topY, 0);
    currentPlane = clipper.createFromNormalAndCoplanarPoint(world, normal, point);
    // Rotate the helper so the drag arrow points UP (toward the clipped half-space).
    // SimplePlane.update() only uses helper.position (not rotation) for the THREE.Plane
    // equation, so clipping direction is unchanged — only the gizmo flips.
    const simplePlane = clipper.list.get(currentPlane);
    if (simplePlane) {
      simplePlane.helper.rotateX(Math.PI);
    }
    _applyClippingToVoids(currentPlane);
  }

  function clearSectionPlane(): void {
    if (currentPlane) {
      _applyClippingToVoids(null);
      void clipper.delete(world, currentPlane);
      currentPlane = null;
    }
  }

  function hasSectionPlane(): boolean {
    return currentPlane !== null;
  }

  /** Apply (or remove) the active section plane from all void mesh materials. */
  function _applyClippingToVoids(planeId: string | null): void {
    if (!voidGroup) return;
    const simplePlane = planeId ? clipper.list.get(planeId) : undefined;
    const planes: THREE.Plane[] = simplePlane ? [simplePlane.three] : [];
    voidGroup.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.Material | THREE.Material[];
      if (!mat) return;
      if (Array.isArray(mat)) {
        for (const m of mat) m.clippingPlanes = planes;
      } else {
        mat.clippingPlanes = planes;
      }
    });
  }

  // ------------------------------------------------------------------
  // 8. Stage B2 state
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

  /** Map from fragments model id → human-readable name (filename without extension). */
  const loadedModels = new Map<string, string>();

  /** Which model the current voidToElement map resolves against (null if none). */
  let voidMatchModelId: string | null = null;

  /**
   * Translation offset applied by OBC's Coordinator when the first IFC model is
   * loaded with coordinate=true. Void meshes use raw Revit mm→m coordinates; after
   * coordination the IFC model is shifted by this vector, so the void group must be
   * shifted by the same amount to stay aligned.
   * Null until the first model is loaded.
   */
  let coordinationOffset: THREE.Vector3 | null = null;

  /** Current IfcIndex (null until an IFC is loaded). */
  let ifcIndex: IfcIndex | null = null;

  /** IFC element localIds currently highlighted, keyed by modelId (for un-highlight on next call). */
  let highlightedElements = new Map<string, number[]>();
  /** Void fallback-mesh ids currently highlighted (for un-highlight on next call). */
  let highlightedMeshVoidIds: number[] = [];

  // ------------------------------------------------------------------
  // Controller implementation
  // ------------------------------------------------------------------
  async function loadIfc(
    bytes: Uint8Array,
    name: string,
    onProgress?: (p: LoadProgress) => void,
  ): Promise<LoadedModel> {
    // coordinate: true — OBC Coordinator aligns all models to the same reference
    // frame (offsets computed from the first model are reused for every subsequent
    // model). Required for federated IFC files from the same project to overlay.
    const model = await ifcLoader.load(bytes, true, name, {
      processData: {
        progressCallback: (percent: number) => {
          onProgress?.({ percent });
        },
      },
    });

    const modelId = model.modelId ?? name;
    loadedModels.set(modelId, name);

    // On the first model, record the web-ifc coordination matrix translation so
    // void meshes can be shifted by the same amount. web-ifc bakes a coordination
    // matrix (R_x(-π/2) + translation) directly into vertex geometry during IFC
    // parsing — model.object.matrix is identity. model.getCoordinates() returns
    // [px,py,pz,...] where (px,py,pz) is the translation column of that matrix
    // already in Three.js Y-up world space.
    if (loadedModels.size === 1) {
      try {
        const coords = await (model as unknown as { getCoordinates(): Promise<number[]> }).getCoordinates();
        coordinationOffset = new THREE.Vector3(coords[0], coords[1], coords[2]);
      } catch (e) {
        console.warn('[world] getCoordinates() failed, falling back to model.object.matrix:', e);
        model.object.updateMatrixWorld(true);
        const pos = new THREE.Vector3();
        model.object.matrix.decompose(pos, new THREE.Quaternion(), new THREE.Vector3());
        coordinationOffset = pos.clone();
      }
      console.debug('[world] coordinationOffset:', coordinationOffset);
      if (voidGroup) voidGroup.position.copy(coordinationOffset);
    }

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
      voidMatchModelId = modelId;
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
    highlightedElements = new Map();
    highlightedMeshVoidIds = [];

    // Keep a copy for later resolution
    _currentVoids.length = 0;
    _currentVoids.push(...voids);

    const { group, byVoidId, skippedCount } = buildVoidMeshes(voids);
    console.debug(
      `[world] setVoids: ${byVoidId.size} meshes built, ${skippedCount} garbage skipped`,
    );

    voidGroup = group;
    voidMeshMap = byVoidId;
    // Apply coordination offset so void meshes stay co-located with IFC geometry.
    if (coordinationOffset) voidGroup.position.copy(coordinationOffset);
    world.scene.three.add(voidGroup);

    // Precompute void→element matches if an IFC model is already loaded
    if (ifcIndex) {
      _refreshVoidElementMatches();
    }

    // M9: a setVoids call is always a dataset change (db load / project switch /
    // include-closed toggle).  Refit the camera to the new void group so the 3D
    // view visibly reflects the change instead of staying put.
    if (voidMeshMap.size > 0) {
      try {
        voidGroup.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(voidGroup);
        const sphere = sphereFromBox(box);
        if (sphere) {
          await world.camera.controls.fitToSphere(sphere, true);
        }
      } catch (e) {
        console.warn('[world] setVoids camera refit failed:', e);
      }
    }
    // New void group — re-apply any active section plane to the fresh materials.
    if (currentPlane) {
      _applyClippingToVoids(currentPlane);
    }
  }

  /** Amber highlight material for IFC elements. */
  const ELEMENT_HIGHLIGHT: FRAGS.MaterialDefinition = {
    color: new THREE.Color(0xfbbf24), // amber-400
    renderedFaces: FRAGS.RenderedFaces.TWO,
    opacity: 0.85,
    transparent: true,
  };

  /**
   * Resolve a unified selection into per-model element localId lists and the fallback
   * void-mesh ids that should be highlighted.
   */
  function _resolveSelection(
    refs: SelectionRef[],
  ): { elementsByModel: Map<string, number[]>; meshVoidIds: number[] } {
    const elementsByModel = new Map<string, number[]>();
    const meshVoidIds: number[] = [];

    const addElement = (modelId: string, localId: number) => {
      const ids = elementsByModel.get(modelId);
      if (ids) ids.push(localId);
      else elementsByModel.set(modelId, [localId]);
    };

    for (const ref of refs) {
      if (ref.kind === 'element') {
        if (loadedModels.has(ref.modelId)) addElement(ref.modelId, ref.localId);
      } else {
        const matched = voidToElement.get(ref.voidId);
        if (matched !== undefined && voidMatchModelId) {
          addElement(voidMatchModelId, matched);
        } else {
          meshVoidIds.push(ref.voidId);
        }
      }
    }
    return { elementsByModel, meshVoidIds };
  }

  async function setSelection(refs: SelectionRef[]): Promise<void> {
    const { elementsByModel, meshVoidIds } = _resolveSelection(refs);

    // --- Un-highlight the previous selection ---
    for (const [modelId, ids] of highlightedElements) {
      if (ids.length === 0) continue;
      const model = fragments.list.get(modelId);
      if (model) {
        try {
          await model.resetHighlight(ids);
        } catch (e) {
          console.warn('[world] resetHighlight failed:', e);
        }
      }
    }
    for (const vid of highlightedMeshVoidIds) {
      const mesh = voidMeshMap.get(vid);
      if (mesh) setVoidHighlight(mesh, false);
    }

    // --- Highlight the new selection ---
    for (const [modelId, ids] of elementsByModel) {
      if (ids.length === 0) continue;
      const model = fragments.list.get(modelId);
      if (model) {
        try {
          await model.highlight(ids, ELEMENT_HIGHLIGHT);
        } catch (e) {
          console.warn('[world] model.highlight failed:', e);
        }
      }
    }
    for (const vid of meshVoidIds) {
      const mesh = voidMeshMap.get(vid);
      if (mesh) setVoidHighlight(mesh, true);
    }
    fragments.core.update(true);

    highlightedElements = new Map(elementsByModel);
    highlightedMeshVoidIds = meshVoidIds;

    // M12: orbit around the selection without moving the camera. Framing is the
    // explicit Zoom buttons (zoomToSelection / zoomToFit).
    await _setOrbitToSelection();
  }

  /** Combined world-space bounding box of the current selection (or null if empty). */
  async function _selectionBox(): Promise<THREE.Box3 | null> {
    const boxes: THREE.Box3[] = [];
    if (highlightedElements.size > 0) {
      const modelIdMap: Record<string, Set<number>> = {};
      for (const [modelId, ids] of highlightedElements) {
        if (ids.length > 0) modelIdMap[modelId] = new Set(ids);
      }
      if (Object.keys(modelIdMap).length > 0) {
        try {
          boxer.list.clear();
          await boxer.addFromModelIdMap(modelIdMap);
          const b = boxer.get();
          boxer.list.clear();
          if (!b.isEmpty()) boxes.push(b.clone());
        } catch (e) {
          console.warn('[world] boxer.addFromModelIdMap failed:', e);
        }
      }
    }
    for (const vid of highlightedMeshVoidIds) {
      const mesh = voidMeshMap.get(vid);
      if (mesh) {
        const mb = new THREE.Box3().setFromObject(mesh);
        if (!mb.isEmpty()) boxes.push(mb);
      }
    }
    const u = unionBoxes(boxes);
    return u.isEmpty() ? null : u;
  }

  /** Set the orbit pivot to the selection center (no camera transition). */
  async function _setOrbitToSelection(): Promise<void> {
    const box = await _selectionBox();
    if (!box) return;
    const c = box.getCenter(new THREE.Vector3());
    try {
      world.camera.controls.setOrbitPoint(c.x, c.y, c.z);
    } catch (e) {
      console.warn('[world] setOrbitPoint failed:', e);
    }
  }

  async function zoomToSelection(): Promise<void> {
    const box = await _selectionBox();
    const sphere = box ? sphereFromBox(box) : null;
    if (!sphere) return;
    try {
      await world.camera.controls.fitToSphere(sphere, true);
    } catch (e) {
      console.warn('[world] zoomToSelection failed:', e);
    }
  }

  async function zoomToFit(): Promise<void> {
    const boxes: THREE.Box3[] = [];
    // All loaded fragment models.
    try {
      boxer.list.clear();
      boxer.addFromModels();
      const b = boxer.get();
      boxer.list.clear();
      if (!b.isEmpty()) boxes.push(b.clone());
    } catch (e) {
      console.warn('[world] zoomToFit addFromModels failed:', e);
    }
    // The void group.
    if (voidGroup && voidMeshMap.size > 0) {
      voidGroup.updateMatrixWorld(true);
      const vb = new THREE.Box3().setFromObject(voidGroup);
      if (!vb.isEmpty()) boxes.push(vb);
    }
    const sphere = sphereFromBox(unionBoxes(boxes));
    if (!sphere) return;
    try {
      await world.camera.controls.fitToSphere(sphere, true);
    } catch (e) {
      console.warn('[world] zoomToFit failed:', e);
    }
  }

  async function pickAt(clientX: number, clientY: number): Promise<SelectionRef | null> {
    const dom = world.renderer?.three.domElement;
    if (!dom) return null;
    const rect = dom.getBoundingClientRect();

    // Void fallback meshes via a plain THREE raycaster (NDC coordinates).
    let voidHit: VoidHit | null = null;
    if (voidGroup && voidGroup.children.length > 0) {
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, world.camera.three);
      const hits = ray.intersectObjects(voidGroup.children, false);
      if (hits.length > 0) {
        const voidId = hits[0].object.userData.voidId as number | undefined;
        if (typeof voidId === 'number') {
          voidHit = { kind: 'void', voidId, distance: hits[0].distance };
        }
      }
    }

    // IFC elements via the fragments raycast (expects raw client coordinates + dom).
    // Try all loaded models; keep the nearest hit.
    let elementHit: ElementHit | null = null;
    let elementHitModelId: string | null = null;
    for (const [modelId] of loadedModels) {
      const model = fragments.list.get(modelId);
      if (!model) continue;
      try {
        const result = (await model.raycast({
          camera: world.camera.three,
          mouse: new THREE.Vector2(clientX, clientY),
          dom,
        })) as { localId?: number; distance?: number; point?: THREE.Vector3 } | null;
        if (result && typeof result.localId === 'number') {
          const dist =
            result.distance ??
            (result.point ? world.camera.three.position.distanceTo(result.point) : Infinity);
          if (!elementHit || dist < elementHit.distance) {
            elementHit = { kind: 'element', localId: result.localId, distance: dist };
            elementHitModelId = modelId;
          }
        }
      } catch (e) {
        console.warn('[world] fragments raycast failed:', e);
      }
    }

    const chosen = chooseNearestHit(voidHit, elementHit);
    if (!chosen) return null;
    if (chosen.kind === 'void') return { kind: 'void', voidId: chosen.voidId };
    return { kind: 'element', modelId: elementHitModelId as string, localId: chosen.localId };
  }

  async function getElementProperties(
    modelId: string,
    localId: number,
  ): Promise<Record<string, string>> {
    const model = fragments.list.get(modelId);
    if (!model) return {};
    try {
      const data = await model.getItemsData([localId]);
      const item = data[0] as Record<string, unknown> | undefined;
      if (!item) return {};
      const result: Record<string, string> = {};
      for (const [key, raw] of Object.entries(item)) {
        const val =
          raw != null && !Array.isArray(raw)
            ? (raw as { value?: unknown }).value
            : undefined;
        if (val != null) result[key] = String(val);
      }
      return result;
    } catch (e) {
      console.warn('[world] getElementProperties failed:', e);
      return {};
    }
  }

  function debugInfo(): Record<string, unknown> {
    const scene = world.scene.three;
    // Use the first loaded model for diagnostic info (multi-model: all ids shown below).
    const firstModelId = [...loadedModels.keys()][0] ?? null;
    const model = firstModelId ? fragments.list.get(firstModelId) : undefined;
    const modelObj = (model as unknown as { object?: THREE.Object3D } | undefined)?.object;
    let modelBox: number[] | null = null;
    try {
      boxer.list.clear();
      boxer.addFromModels();
      const b = boxer.get();
      boxer.list.clear();
      if (!b.isEmpty()) modelBox = [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z];
    } catch (e) {
      console.warn('[world.debug] modelBox failed', e);
    }
    let voidBox: number[] | null = null;
    if (voidGroup) {
      voidGroup.updateMatrixWorld(true);
      const vb = new THREE.Box3().setFromObject(voidGroup);
      if (!vb.isEmpty()) voidBox = [vb.min.x, vb.min.y, vb.min.z, vb.max.x, vb.max.y, vb.max.z];
    }
    const camPos = world.camera.three.position;
    const tgt = new THREE.Vector3();
    try {
      world.camera.controls.getTarget(tgt);
    } catch {
      /* ignore */
    }
    let sceneMeshCount = 0;
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) sceneMeshCount++;
    });
    let modelMeshCount = 0;
    let modelDescendants = 0;
    const modelChildTypes: string[] = [];
    if (modelObj) {
      modelObj.traverse((o) => {
        modelDescendants++;
        if ((o as THREE.Mesh).isMesh) modelMeshCount++;
      });
      modelObj.children.forEach((c) => modelChildTypes.push(c.type));
    }
    // What the fragments core itself reports rendering.
    let coreModelCount = -1;
    try {
      const core = fragments.core as unknown as { models?: { list?: Map<string, unknown> } };
      coreModelCount = core.models?.list?.size ?? -1;
    } catch {
      /* ignore */
    }
    return {
      coordinationOffset: coordinationOffset ? [coordinationOffset.x, coordinationOffset.y, coordinationOffset.z] : null,
      loadedModels: Object.fromEntries(loadedModels),
      firstModelId,
      hasModel: !!model,
      modelObjInScene: modelObj ? scene.children.includes(modelObj) : false,
      modelObjChildren: modelObj?.children.length ?? -1,
      modelMeshCount,
      modelDescendants,
      modelChildTypes,
      coreModelCount,
      sceneMeshCount,
      modelBox,
      voidGroupInScene: voidGroup ? scene.children.includes(voidGroup) : false,
      voidGroupChildren: voidGroup?.children.length ?? -1,
      voidBox,
      sceneChildren: scene.children.length,
      camPos: [camPos.x, camPos.y, camPos.z],
      camTarget: [tgt.x, tgt.y, tgt.z],
    };
  }

  function diagVoidPick(): Record<string, unknown> {
    if (!voidGroup || voidGroup.children.length === 0) return { err: 'no voids' };
    const dom = world.renderer?.three.domElement;
    if (!dom) return { err: 'no dom' };
    const rect = dom.getBoundingClientRect();
    const mesh = voidGroup.children[0] as THREE.Mesh;
    mesh.updateWorldMatrix(true, false);
    const wp = new THREE.Vector3();
    mesh.getWorldPosition(wp);
    const cam = world.camera.three;
    cam.updateMatrixWorld();
    const ndc = wp.clone().project(cam);
    const clientX = rect.left + (ndc.x * 0.5 + 0.5) * rect.width;
    const clientY = rect.top + (-ndc.y * 0.5 + 0.5) * rect.height;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), cam);
    const hits = ray.intersectObjects(voidGroup.children, false);
    return {
      camType: cam.type,
      dom: [rect.left, rect.top, rect.width, rect.height],
      canvasWH: [dom.width, dom.height],
      meshWorld: [wp.x, wp.y, wp.z],
      ndc: [ndc.x, ndc.y, ndc.z],
      computedClient: [clientX, clientY],
      directNdcHits: hits.length,
      firstHitVoidId: (hits[0]?.object as THREE.Object3D | undefined)?.userData?.voidId ?? null,
    };
  }

  async function getSpatialStructures(): Promise<
    { modelId: string; name: string; structure: RawSpatialNode; names: Record<number, string> }[]
  > {
    if (loadedModels.size === 0) return [];
    const results: { modelId: string; name: string; structure: RawSpatialNode; names: Record<number, string> }[] = [];

    for (const [modelId, humanName] of loadedModels) {
      const model = fragments.list.get(modelId);
      if (!model) continue;
      try {
        const structure = (await model.getSpatialStructure()) as RawSpatialNode;
        // getSpatialStructure only yields localId + category; fetch each item's
        // Name attribute so the tree shows real element names, not "#<id>".
        const ids: number[] = [];
        const walk = (n: RawSpatialNode) => {
          if (typeof n.localId === 'number') ids.push(n.localId);
          n.children?.forEach((c) => c && walk(c));
        };
        walk(structure);

        const names: Record<number, string> = {};
        const BATCH = 500;
        for (let i = 0; i < ids.length; i += BATCH) {
          const batch = ids.slice(i, i + BATCH);
          try {
            const data = await model.getItemsData(batch, {
              attributesDefault: false,
              attributes: ['Name'],
            });
            for (let j = 0; j < batch.length; j++) {
              const entry = (data[j] as Record<string, unknown> | undefined)?.Name;
              const value =
                entry && !Array.isArray(entry)
                  ? (entry as { value?: unknown }).value
                  : undefined;
              if (typeof value === 'string' && value.length > 0) names[batch[j]] = value;
            }
          } catch (e) {
            console.warn('[world] getItemsData(Name) batch failed:', e);
          }
        }
        results.push({ modelId, name: humanName, structure, names });
      } catch (e) {
        console.warn('[world] getSpatialStructure failed for', modelId, e);
      }
    }
    return results;
  }

  async function exportLoadedModels(): Promise<{ id: string; bytes: Uint8Array }[]> {
    const result: { id: string; bytes: Uint8Array }[] = [];
    for (const [modelId] of loadedModels) {
      try {
        const model = fragments.list.get(modelId);
        if (!model) continue;
        // API confirmed via Context7: model.getBuffer(false) → ArrayBuffer (compressed)
        const buffer = await model.getBuffer(false);
        result.push({ id: modelId, bytes: new Uint8Array(buffer) });
      } catch (e) {
        console.warn('[world] exportLoadedModels failed for', modelId, e);
      }
    }
    return result;
  }

  async function loadFragmentModel(id: string, bytes: Uint8Array): Promise<LoadedModel> {
    // API confirmed via Context7: fragments.core.load(ArrayBuffer, { modelId })
    // The fragments.list.onItemSet handler wires scene attachment + camera.
    const model = await fragments.core.load(bytes.buffer as ArrayBuffer, { modelId: id });

    const resolvedId = model.modelId ?? id;
    loadedModels.set(resolvedId, id);

    // Fragment models (cache restore) have the coordination offset baked into their
    // vertex geometry — read it via getCoordinates() the same way loadIfc does.
    if (loadedModels.size === 1 && !coordinationOffset) {
      try {
        const coords = await (model as unknown as { getCoordinates(): Promise<number[]> }).getCoordinates();
        coordinationOffset = new THREE.Vector3(coords[0], coords[1], coords[2]);
      } catch {
        model.object.updateMatrixWorld(true);
        const pos = new THREE.Vector3();
        model.object.matrix.decompose(pos, new THREE.Quaternion(), new THREE.Vector3());
        coordinationOffset = pos.clone();
      }
      if (voidGroup) voidGroup.position.copy(coordinationOffset);
    }

    let elementCount = 0;
    try {
      const localIds = await model.getLocalIds();
      elementCount = localIds.length;
    } catch {
      elementCount = model.object.children.length;
    }

    // Rebuild IfcIndex for void→element resolution
    try {
      ifcIndex = await buildIfcIndex(model);
      voidMatchModelId = resolvedId;
      console.debug('[world] IfcIndex rebuilt from frag:', ifcIndex.byGlobalId.size, 'globalIds');
    } catch (e) {
      console.warn('[world] buildIfcIndex (frag) failed:', e);
      ifcIndex = null;
    }

    // Refresh void→element matches if voids already loaded
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
      console.warn('[world] camera fit (frag) failed:', e);
    }

    return { id, elementCount };
  }

  function getVoidMeshCount(): number {
    return voidMeshMap.size;
  }

  function hasModels(): boolean {
    return [...loadedModels.keys()].some((id) => fragments.list.get(id) !== undefined);
  }

  function dispose(): void {
    loadedModels.clear();
    highlightedElements.clear();
    // Capture the canvas before tearing components down.
    const canvasEl = world.renderer?.three.domElement ?? null;
    try {
      components.dispose();
    } catch (e) {
      console.warn('[world] dispose error', e);
    }
    // Ensure the <canvas> is removed from the DOM. OBC's dispose does not always
    // detach it, which leaves an orphaned canvas on React StrictMode double-mount
    // / hot-reload (two stacked canvases — see PLAN_v2 debugging).
    if (canvasEl && canvasEl.parentElement) {
      canvasEl.parentElement.removeChild(canvasEl);
    }
  }

  return {
    sectionToVoidTops,
    clearSectionPlane,
    hasSectionPlane,
    loadIfc,
    exportLoadedModels,
    loadFragmentModel,
    setVoids,
    setSelection,
    zoomToSelection,
    zoomToFit,
    pickAt,
    getSpatialStructures,
    getElementProperties,
    debugInfo,
    diagVoidPick,
    getVoidMeshCount,
    hasModels,
    dispose,
  };
}
