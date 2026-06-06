# PLAN_v2 — VoidManager Web Viewer (round 2: selection, camera, browser, editing)

> This is the round-2 implementation plan, approved before any code was written. It builds on the
> read-only v1 (`docs/STATUS.md`, `docs/PLAN.md`) and the spec in `docs/VIEWER_SPEC.md`.

## Context

A read-only v1 viewer is built and all-green on `feat/scaffold` (86 Vitest, 21 Playwright,
clean tsc + build). It loads the VoidManager `.db` (sql.js, dictionary-decoded reads), shows a
project selector + AG Grid void list, renders DB voids as fallback THREE meshes (the fixture IFC
is the MEP model and does not contain the voids), and highlights/fits the camera when grid rows
are selected. This round adds the interaction layer the reviewers actually need: a real
bidirectional selection model, click-to-pick in 3D, camera framing controls, a spatial model
browser, more screen for the 3D view, and status editing (visual only this round). The hard
write-back to the mutation-versioned `.db` stays deferred.

## Decisions locked this session

| # | Decision | Choice |
|---|---|---|
| Item 9 | Status write-back | **In-memory / visual only.** Edits update the grid + a "dirty/unsaved" indicator; nothing is written to the `.db`. A stubbed `updateVoidStatus()` is added to the `VoidRepository` seam so the real write drops in later. |
| Item 6 | Nav relocation / layout | **Single slim merged top bar** (~34px) replacing the two stacked bars, **+ draggable 3D/grid divider** with the 3D pane dominant. |
| Item 2 | Selection store | **Zero-dep external store** via React `useSyncExternalStore` (no Zustand). |
| Item 7 | Model browser | **Custom React tree** from `model.getSpatialStructure()` — **no new dependency** (resolved by spike below). |

## Spike findings (resolved before build)

All verified against current pinned versions via Context7 (`@thatopen/components` 3.4.6 /
`@thatopen/fragments` 3.4.5 / AG Grid 35) and a trace of the existing code.

1. **Spatial structure is available as plain data.** `model.getSpatialStructure()` returns a
   recursive `{ localId, category, children[] }` tree (IFCPROJECT → IFCSITE → IFCBUILDINGSTOREY →
   element localIds). Nodes alternate between a *category* node (`category` set, `localId` null)
   and an *item* node (`localId` set, `category` null). A custom React tree consumes this directly
   → no `@thatopen/ui` (Lit web components + React-glue + a heavy new dep) needed. **Decision: custom tree.**
2. **3D picking API confirmed.** `model.raycast({ camera: world.camera.three, mouse, dom: renderer.three.domElement })`
   → `{ localId, ... } | null`. Void fallback meshes are plain `THREE.Mesh` in a group, so they need a
   separate `THREE.Raycaster`. Picking must run **both** and choose the nearest hit (heuristic below).
3. **Camera API confirmed.** `world.camera.controls` is yomotsu **CameraControls** — `fitToSphere`,
   `fitToBox`, `setTarget`, `setOrbitPoint`, `setLookAt` are all available (existing code already uses
   `fitToSphere`). OBC also exposes `camera.fit(meshes, offset)` and `camera.fitToItems()`. We keep the
   explicit bounding-box → `fitToSphere` approach (already in `world.ts`) because it can include the
   void meshes, which `fitToItems()` may not.
4. **AG Grid (Community) confirmed.** `agSelectCellEditor` + `cellEditorParams.values` gives the status
   dropdown (Community, covered by `AllCommunityModule`). Programmatic selection for 3D→grid uses
   `api.getRowNode(id).setSelected(true)` — **requires a stable `getRowId`** (use `void.id`). Bulk edit
   uses `node.setDataValue('status', value)` per selected node.
5. **Item 1 root cause (code trace).** The wiring already exists: `Viewer` `voids` state →
   `ThreeDViewer` prop → `useEffect([voids])` → `ctrl.setVoids()` rebuilds meshes. So meshes **do**
   rebuild on project switch. What is missing: `setVoids()` never refits the camera and never clears
   the prior selection, so visually the 3D "doesn't change." Fix is small (see M8). A confirm-spike is
   still in the plan because this is a behavior claim, not a guess to ship on.

## Architecture additions

```
src/
  store/
    selectionStore.ts        # NEW — zero-dep useSyncExternalStore selection model (item 2)
  features/
    viewer/
      world.ts               # +zoomToSelection(), +zoomToFit(), +setOrbitToSelection(), +pickAt(), refit on rebuild
      ThreeDViewer.tsx        # subscribe to selectionStore; canvas pointer handler; toolbar buttons
      voidMeshes.ts           # unchanged (calibration seam stays)
    browser/
      ModelBrowser.tsx        # NEW — custom spatial tree (items 7/8)
      spatialTree.ts          # NEW — pure normalizer for getSpatialStructure() output
    voids/
      VoidGrid.tsx            # getRowId, editable status col, bulk-status toolbar, store subscribe
  data/
    VoidRepository.ts         # + updateVoidStatus() (stub seam, item 9)
  pages/
    Viewer.tsx                # slim merged bar, resizable split, browser toggle, dirty indicator
  App.tsx + styles/global.css # slim-bar layout (item 6)
```

**`SelectionRef`** is the shared vocabulary for the two object kinds:

```ts
type SelectionRef =
  | { kind: 'void'; voidId: number }                       // DB void fallback mesh
  | { kind: 'element'; modelId: string; localId: number }; // IFC element (fragments)
```

Stable string key per ref (`void:123`, `elem:<modelId>:456`) → the store holds a `Set<string>` +
the originating `source` (`'grid' | 'viewer' | 'browser' | 'api'`). Each consumer's effect skips
applying a change whose `source` is itself → no feedback loops.

## Milestones

Each milestone ends green on the self-verification cycle (`tsc --noEmit`, `vitest`, `build`,
`test:e2e`) per CLAUDE.md. WebGL/canvas correctness is only ever proxied (canvas exists, non-zero
size, zero console errors, plus status-badge text); this is called out where it bites.

### M7 — Unified selection store (foundation; build first)
- **Approach.** `src/store/selectionStore.ts`: a ~40-line external store (`subscribe`, `getSnapshot`,
  `setSelection(refs, source)`, `toggle(ref, source)`, `clear(source)`) + a `useSelection()` hook
  over `useSyncExternalStore`. Refactor the existing path onto it: `VoidGrid` writes
  `setSelection(rows→void refs, 'grid')`; `ThreeDViewer` reads the store instead of the
  `selectedVoidIds` prop. Delete the `selectedVoidIds` prop plumbing from `Viewer`/`ThreeDViewer`.
- **Key APIs.** React `useSyncExternalStore`.
- **Risks.** Feedback loops (mitigate: source tag + key-set equality check before applying). Stale
  refs after a project change (M8 clears selection on void reload).
- **Tests.** Vitest pure-logic: ref encode/decode, set add/toggle/clear, source gating. No browser.
  Existing selection E2E still passes (now driven through the store).

### M8 — Layout: slim merged bar + resizable split (item 6)
- **Approach.** Replace the global `app-nav` + the viewer `topBar` with one ~34px bar inside
  `/viewer`: brand + Home/Viewer links on the left, project selector + Save session + Zoom buttons +
  write-back/dirty badges + Columns/browser toggles on the right. Non-viewer routes keep the normal
  nav. Make the 3D/grid split a draggable divider (3D `flex` dominant, grid resizable, min-heights);
  persist the ratio in `localStorage`. Mostly `App.tsx`, `global.css`, `Viewer.tsx`,
  `Viewer.module.css`; the 3D pane stops being a fixed 420px.
- **Key APIs.** Pointer events for the drag handle; `react-router` `useMatch('/viewer')` already gates
  layout in `App.tsx`.
- **Risks.** AG Grid + the WebGL canvas must resize cleanly on divider drag (the renderer already
  listens for container resize via OBC `SimpleRenderer`; verify it re-fits the viewport).
- **Tests.** E2E: on `/viewer` assert the global nav bar is absent and the merged bar + canvas are
  present; drag the divider and assert canvas still has non-zero size + zero console errors.

### M9 — Project switch rebuilds 3D voids (item 1)
- **Spike (cheap, run during build).** Add an E2E step: load DB, record `void-mesh-status` count for
  "All projects", switch the project selector, assert the count changes. Confirms meshes rebuild.
- **Fix.** In `world.setVoids()`: after rebuilding, when the call is a *dataset change* (not a
  selection refresh), refit the camera to the new void group's bounds so the change is visible; and
  in `Viewer.handleProjectChange` clear the selection (`selectionStore.clear('api')`) before reload so
  stale highlights/rows don't linger. Guard the refit so it does **not** fire on every unrelated
  `voids` identity change (only on project/db change).
- **Key APIs.** existing `buildVoidMeshes`; `camera.controls.fitToSphere` over the group `Box3`.
- **Risks.** Over-eager auto-fit feels jarring — gate it to project/db change only.
- **Tests.** E2E above + zero console errors. Reuse the `void-mesh-status` badge.

### M10 — 3D picking → selection (viewer → store; item 2 first half)
- **Approach.** Canvas pointer handler in `ThreeDViewer`: on click, run `model.raycast(...)` for the
  loaded fragment model **and** a `THREE.Raycaster` against the void group; pick the nearest hit.
  **Heuristic:** if both hit, prefer the **void mesh** (the domain object the grid maps to) unless the
  IFC hit is meaningfully closer; document this. Translate to a `SelectionRef` and
  `setSelection([ref], 'viewer')` (shift/ctrl-click → `toggle`); click on empty space → `clear`.
- **Key APIs.** `model.raycast({camera, mouse, dom})`; `THREE.Raycaster.setFromCamera` (NDC, computed
  from the canvas `getBoundingClientRect`); `world.camera.three`; `renderer.three.domElement`.
- **Risks.** Two raycast coordinate conventions (fragments wants DOM/client coords; THREE wants NDC).
  Comparable depth between the two systems — if fragments' result distance isn't directly comparable,
  fall back to the documented "prefer void" heuristic. WebGL picking can't be asserted by exact
  element in headless Chromium.
- **Tests.** Vitest: pure `chooseNearestHit()` chooser. E2E: expose a dev-only `window.__pickAt(x,y)`
  hook so a test can drive a deterministic pick and assert `selection-status` updates + zero errors;
  plus a plain canvas-center click asserting no console errors.

### M11 — Bidirectional sync wiring (grid ↔ 3D ↔ browser; item 2 second half + item 8)
- **Approach.** All three consumers subscribe to the store and apply changes whose `source` ≠ self:
  - **store → grid:** select matching rows via `api.getRowNode(String(voidId)).setSelected()` (needs
    `getRowId`); element-only refs with no matching void simply select nothing in the grid.
  - **store → 3D:** highlight (existing logic moved into a store subscription) — matched void → IFC
    highlight, unmatched void → fallback-mesh material swap, directly-picked element → IFC highlight.
  - **browser → store:** handled in M13.
- **Risks.** Mixed-kind selections; echo loops (source gating). Keep highlight + camera concerns
  separate (camera in M12).
- **Tests.** E2E: existing grid→3D test stays green; add a viewer-source selection (via the
  `window.__pickAt`/`__select` hook) → assert the matching grid row gets `.ag-row-selected`.

### M12 — Zoom to / Zoom to Fit / orbit pivot (items 3, 4, 5)
- **Approach.** Extract the combined-bounding-box logic already inside `setSelectedVoids` into
  `world.zoomToSelection()` (Box3 over selected IFC elements via `BoundingBoxer.addFromModelIdMap` +
  void meshes via `Box3.setFromObject`) → `fitToSphere(sphere, true)`. Add `world.zoomToFit()` (Box3
  over all fragment models via `BoundingBoxer.addFromModels` + the whole void group). Wire both to
  slim-bar buttons ("Zoom to" enabled only when something is selected; "Zoom to Fit" always).
  **Orbit pivot (item 5):** on a non-empty selection set `camera.controls.setOrbitPoint(cx,cy,cz)` to
  the selection center so orbit rotates around it without re-zooming; on clear, reset the orbit point
  to the model/scene center. Decouple auto-fit from selection: selecting **highlights + sets orbit
  point** but does not yank the camera; framing is the explicit "Zoom to" button (see open question).
- **Key APIs.** `camera.controls.fitToSphere` / `fitToBox` / `setOrbitPoint` / `setTarget`;
  `BoundingBoxer.addFromModelIdMap` / `addFromModels`.
- **Risks.** Ortho vs perspective fit differences (OrthoPerspectiveCamera handles both); degenerate
  boxes (existing `radius < 0.01` guard kept); `setOrbitPoint` vs `setTarget` interaction with a
  pending `fitToSphere` transition.
- **Tests.** Vitest: pure `unionBoxes()` / sphere-from-box helper (three runs in node). E2E: click
  Zoom to Fit and Zoom to, assert canvas intact + zero console errors (visual correctness not
  assertable).

### M13 — Model browser (items 7 + 8)
- **Approach.** `spatialTree.ts` pure normalizer: collapse the alternating category/item nodes from
  `getSpatialStructure()` into `TreeNode { label, category, localId|null, modelId, children }` (one
  root per loaded model/file). `ModelBrowser.tsx`: collapsible/expandable React tree, toggled from the
  slim bar as a left drawer in the 3D pane. Clicking a node with a `localId` →
  `setSelection([{kind:'element', modelId, localId}], 'browser')` → routed through the unified store
  (item 8) so it highlights in 3D and "Zoom to" works. v1 renders the full tree; virtualization
  deferred.
- **Key APIs.** `model.getSpatialStructure()`; `fragments.list` to enumerate models.
- **Risks.** Node-shape normalization (category-node vs item-node). Large trees (defer virtualization).
  `localId` from the structure is the same id space used by `highlight()` (confirmed).
- **Tests.** Vitest: `spatialTree.ts` normalizer against the documented JSON shape. E2E: load the MEP
  IFC (it has IfcSite/Building/Storey), open the browser, assert >0 tree nodes, click a node, assert
  `selection-status` updates + zero console errors.

### M14 — Status dropdown editing, in-memory (item 9)
- **Approach.** Status column → `editable: true`, `cellEditor: 'agSelectCellEditor'`,
  `cellEditorParams: { values: APPROVAL_STATUSES }` (exact six strings from `schema.ts`). Single-cell
  edit via `onCellValueChanged`. Bulk: slim-bar "Set status ▾" applies to all selected nodes via
  `node.setDataValue('status', value)`. Track a `dirtyVoidIds` set + an "N unsaved" indicator;
  **nothing is written to the `.db`.** Add `updateVoidStatus(voidId, status)` to the `VoidRepository`
  interface as a stub (no-op / marks dirty) so the future real write path has its seam.
- **Key APIs.** `agSelectCellEditor`, `onCellValueChanged`, `node.setDataValue`, `api.getSelectedNodes`.
- **Risks.** Edits are lost on project switch / reload (expected; surfaced via the dirty indicator and
  an optional confirm-before-switch). Must never accidentally persist. Status casing must stay exact.
- **Tests.** E2E: edit a status cell via the select editor → assert new value + dirty indicator;
  multi-select + bulk set → assert all changed. Vitest: bulk-apply pure helper + `isApprovalStatus`.

## Fixture coverage — what needs a structural IFC

| Buildable with current MEP fixture (`fixtures/`) | Needs a structural IFC (NOT this round) |
|---|---|
| M7–M12, M14, and M13 (the MEP IFC has IfcSite/Building/Storey → the tree renders), 3D picking of both void meshes and MEP elements | Validating the void↔IFC-element **match** path and overlay coordinate alignment — already dormant/deferred; out of scope here |

**No new fixture is required this round.** I'll flag immediately if M10/M13 reveal a real need (they
should not — picking and the tree work against any loaded IFC).

## Recommended build order

1. **M7** unified selection store (+ refactor existing grid↔3D onto it).
2. **M8** slim merged bar + resizable split (gives the new buttons/toggles a home).
3. **M9** project-switch fix (+ confirm-spike).
4. **M10** 3D picking → store.
5. **M11** finalize bidirectional sync.
6. **M12** Zoom to / Zoom to Fit / orbit pivot.
7. **M13** model browser → store.
8. **M14** status dropdown (in-memory).

## Open questions (defaults chosen; correct if wrong)

1. **Auto-fit on selection.** Default: selecting highlights + sets the orbit point but does **not**
   move the camera; framing is the explicit "Zoom to" button (less jarring than today's auto-fit).
   OK, or keep auto-fit on grid selection?
2. **Model browser placement.** Default: a collapsible **left drawer inside the 3D pane**, toggled
   from the slim bar. Alternative: a tab next to the grid.
3. **Unsaved edits across project switch.** Default: in-memory status edits **reset** on project
   switch / reload, with a confirm prompt if there are unsaved edits. OK?

## Verification (every milestone)

1. `npx tsc --noEmit` — zero type errors.
2. `npm run test` — Vitest green (new pure-logic specs: selection store, hit chooser, box union,
   spatial-tree normalizer, bulk-status helper).
3. `npm run build` — clean production build.
4. `npm run test:e2e` — Playwright green (new specs: layout, project-switch mesh rebuild, picking via
   `window.__pickAt` hook, sync, zoom buttons, model browser, status edit + bulk), each asserting zero
   console errors and intact non-zero canvas as the WebGL proxy.
5. Report with `playwright-report/index.html` as evidence.
