# VoidManager Website + Web IFC Void Viewer — Implementation Plan

> This plan lives at `C:\Users\taco\.claude\plans\i-would-like-to-crispy-pebble.md`.
> It is **self-contained** so it can be referenced from a fresh session in the *new website repo*.
> **Start with Milestone 0 — a throwaway visual playground prototype for feedback** (see Milestones). Only after that feedback do we copy this file into the new repo as `docs/PLAN.md` and begin building.

---

## Context — why this is being built

The VoidManager Revit add-in (repos `VoidManageRevit` + sibling `VoidManager`) lets engineers place, review, and approve structural voids in Revit. Reviewers and external parties without Revit currently have no way to view voids or change their approval status.

Goal: a **static website** (GitHub Pages, auto-deploy on push to `main`) with:
1. A plain info page about the VoidManager application.
2. A browser **3D IFC viewer** that loads local IFC files + the project's VoidManager `.db` file, shows a void datagrid like the Revit add-in, lets the user **change approval status**, and **selects/highlights the matching element in the 3D view** when grid rows are selected.
3. Persistence of an **IFC configuration** so the same IFC set reopens quickly.

The stack must be **ready to grow** into: cloud-hosted database, user authentication, and project management — so persistence and data access are abstracted behind interfaces from day one.

---

## What we confirmed from the existing code

Data lives in a **SQLite `.db`** in `%LOCALAPPDATA%\VoidManager`, accessed via raw `System.Data.SQLite` (NOT Entity Framework). So the browser can read/write it directly with **sql.js** (SQLite compiled to WASM).

Domain model (from `VoidManagerCore.dll`, namespace `VoidManagerCore`):
- Hierarchy: `Project` → `Building` → `Story` → (`VoidCircle`[], `VoidRectangle`[]). Voids link to their `Story` via `HostID`.
- `VoidGeneric` (base) → `VoidCircle` (adds `Diameter`, `Tolerance`) / `VoidRectangle` (adds `Width`, `Height`, tolerances, `Normal`).
- Shared void fields: `ID`, `Location` (Point3D X/Y/Z, mm), `Direction` (Vector3D), `Thickness`, `StatusOfApproval`, `ExternalId`, `SequenceName`, `AssignedTo` (User), `HostID`, plus `SuperSubHostIntersections[]` holding `HostElementSuper` and `HostElementSub`, each with their own `ExternalId`, `Name`, `Category`, `Model`.
- **Approval status** strings (the exact values stored in the DB): `concept`, `open for review`, `approved`, `rejected`, `released for execution`, `executed` (enum also has internal `unset`, excluded from the editable list).

**Identifier semantics (critical for selection):**
- The **void's own `ExternalId`** is used by the Revit add-in's "Select in Revit" (`ManageVoidsViewModel.SelectInRevit` → `RevitService.SetRevitSelection` → `RevitUtils/Selection.cs`), which does `Convert.ToInt64/Int32(ExternalId)` → `ElementId`. So in some paths it is a Revit **ElementId integer**; other code paths create `Guid.NewGuid()` external ids. **The real value must be confirmed against a sample `.db`.**
- **Host element `ExternalId`** (`HostElementSuper`/`HostElementSub`) is the Revit **UniqueId** (confirmed: `Model.IsExistingVoid` matches `HostElement.ExternalID == clash.Element.UniqueId`).

Datagrid reference (to mirror in the web grid): `VoidManage.Revit.SharedProject/ManageVoids/ManageVoidsWindow.xaml` (Status column = editable ComboBox bound to `Statuses`) and the `VMDataRow` model in `.../ManageVoids/Controls/VoidManageDatagrid.cs`. The non-Revit harness `VmoViewer` (in the `VoidManager` repo) already drives the same grid without Revit and is the closest analog to the web app.

---

## Recommended stack

| Concern | Choice | Why |
|---|---|---|
| Framework | **React + Vite + TypeScript** | Static build for GH Pages; TS safety; grows into a real app |
| Routing | **React Router** (`HashRouter` for GH Pages, see pitfalls) | `/`, `/viewer`, future `/projects`, `/login` |
| Server-state cache | **TanStack Query** | Local-file today, cloud API later — same query/mutation API |
| Client state | **Zustand** | Lightweight, scales; holds viewer/selection/grid state |
| 3D / IFC | **`@thatopen/components` (OBC) + `@thatopen/fragments` (FRAGS) + `web-ifc`** | Current maintained successor to IFC.js; loads IFC in-browser, converts to compact Fragments, raycast + highlight |
| SQLite | **sql.js** | Read AND write the `.db` fully client-side |
| Datagrid | **AG Grid Community** (MIT) | Editable cell (status ComboBox), row selection events, column show/hide — matches the WPF grid's behaviour with little code |
| Local persistence | **IndexedDB** (via `idb`) | Cache fragments + db bytes + IFC config for fast reopen, cross-browser |
| File write-back | **File System Access API** (Chromium) with **download fallback** | Write the edited `.db` back to the same file the user opened |
| Deploy | **GitHub Actions → GitHub Pages** | Auto-publish on push to `main` |

---

## Architecture (future-proofed for cloud + auth)

```
src/
  app/                # routing, providers (QueryClient, Auth, theme)
  pages/
    Home.tsx          # static info page
    Viewer.tsx        # 3D viewer + datagrid
  features/
    viewer/           # OBC world setup, IfcImporter, Highlighter, selection sync
    voids/            # void grid, status editing, row<->element mapping
    config/           # IFC configuration save/load (IndexedDB)
  data/
    VoidRepository.ts        # INTERFACE — getProjects, getVoids, updateVoidStatus...
    LocalDbRepository.ts     # sql.js implementation (today)
    CloudRepository.ts       # REST implementation (future, stub now)
    schema.ts                # table/column constants, status enum
  auth/
    AuthProvider.tsx         # stub now (no-op user); real provider later
  lib/
    revitGuid.ts             # Revit UniqueId -> IfcGuid conversion
    ifcIndex.ts              # build GlobalId/Tag/UniqueId index from loaded model
  store/                # zustand stores (selection, models, config)
```

**The key abstraction is `VoidRepository`.** All UI talks to the interface only. Today it is backed by `LocalDbRepository` (sql.js over a user-picked `.db`). When the DB moves to the cloud, add `CloudRepository` behind the same interface plus real `AuthProvider` + project-management pages — **no UI rewrite**. The C# DB-write example the user has should be mirrored exactly inside `LocalDbRepository.updateVoidStatus()` (same UPDATE statement / table / column / value casing).

---

## Feature breakdown

### 0. Confirm real schema (do this first)
Open a real `.db` from `%LOCALAPPDATA%\VoidManager` in a SQLite browser. Record exact **table names and column names** for `Project`/`Building`/`Story`/`VoidCircle`/`VoidRectangle`/host-element tables, and how Point3D/Vector3D are stored (separate X/Y/Z columns). Capture the user's **C# example** of editing the local DB to mirror the write path. Put findings in `src/data/schema.ts`.

### 1. Static info page (`Home.tsx`)
Plain marketing/info content + a prominent link/route to `/viewer`. No dynamic data.

### 2. 3D viewer setup (`features/viewer`)
Initialize an OBC `World` (scene/camera/renderer), `FragmentsManager` with the worker, and `IfcLoader`/`IfcImporter` with `web-ifc` WASM pinned to a fixed version (e.g. `web-ifc@0.0.77`). Add a `Highlighter` (or fragments raycast) for selection.

### 3. Load IFC from local computer
File `<input accept=".ifc">` → `URL.createObjectURL` → `IfcImporter.process({bytes})` → `fragments.load(...)` → add to scene (pattern confirmed from That Open docs). Support **multiple IFCs** (host model + the IFC containing void geometry). On load, build an **element index** (`ifcIndex.ts`): map `GlobalId`, any Revit `UniqueId`/`Tag`/`ElementId` carried in property sets, and express IDs, per model.

### 4. Load the VoidManager `.db`
File `<input accept=".db">` → bytes → `sql.js` `new SQL.Database(bytes)`. `LocalDbRepository` runs SELECTs to build the Project→Building→Story→Voids tree and the flat void rows for the grid (mirror `VMDataRow` fields: `ID`, `ExternalId`, `StatusOfApproval`, `AssignedTo`, level name/elevation, `Thickness`, `Width`/`Height`/`Diameter`, host names/categories, `SequenceName`).

### 5. Datagrid (`features/voids`)
AG Grid with columns mirroring the WPF grid; **Status** column is an editable single-select cell editor with the six status values. Hidden/utility columns: `ID`, `ExternalId`. Multi-row selection enabled.

### 6. Selection sync (grid ↔ 3D)  — the core feature
On grid row-selection change, resolve each void to a 3D element using `ifcIndex` in this priority order, then **highlight + fit camera**:
1. `void.ExternalId` (or host `ExternalId`) **== IFC `GlobalId`**.
2. Revit-UniqueId → IfcGuid conversion (`revitGuid.ts`) of the stored UniqueId **== IFC `GlobalId`**. (Revit derives IfcGuid deterministically from UniqueId; implement the documented 22-char base64 algorithm.)
3. `void.ExternalId` (int) **== IFC `Tag`/Revit ElementId** property if the export carried it.
4. **Fallback** — no IFC element matched: render the void itself as a 3D mesh (circle = cylinder, rectangle = box) from DB `Location` + size + `Direction`, added to a dedicated "voids" group, and highlight that. (Coordinate alignment caveat — see pitfalls.)
Also nice-to-have: **viewer → grid** (click a 3D element → select its row).

### 7. Status write-back to the local `.db`
On status edit: `LocalDbRepository.updateVoidStatus(voidId, newStatus)` runs the SQLite `UPDATE` (mirroring the user's C# example exactly), then persists the modified database bytes back to disk:
- **Primary (Chromium):** keep the `FileSystemFileHandle` from `window.showOpenFilePicker()` when the `.db` was opened, and `createWritable()` to write the edited bytes back to the *same file*.
- **Fallback (all browsers):** `db.export()` → download the updated `.db`; user drops it back into the VoidManager folder.
Surface a clear "saved / download" status so the user knows the write happened. (This is the "sync to server DB = the local .db file" requirement; the `VoidRepository` interface keeps the future cloud sync drop-in.)

### 8. Store IFC configuration for quick reopen (`features/config`)
A named "configuration" = the set of loaded models + their associated `.db`. Cache in **IndexedDB**:
- Converted **fragment bytes** per IFC (so reopen skips re-parsing the IFC).
- The `.db` bytes (or, Chromium, the stored file handle to re-read live).
- Metadata: names, transforms, last-opened.
Reopen = read fragments + db from IndexedDB, rebuild scene + grid — no manual re-pick (cross-browser). On Chromium, optionally re-validate the live file handle so edits write to the original file.

### 9. Deployment
`vite build` → static `dist/`. GitHub Actions workflow on push to `main` builds and deploys to GitHub Pages. Set Vite `base` to the repo path (or use a custom domain). Add a `404.html` copy of `index.html` (or use `HashRouter`) so client routes work on Pages.

---

## Pitfalls to watch (several are non-obvious)

1. **Identifier matching is the riskiest part.** Three different identifier semantics exist (void ElementId int, void GUID, host UniqueId) and the IFC's `GlobalId` is a *derived* 22-char IfcGuid, not the raw Revit UniqueId. Resolve against a **real `.db` + matching IFC pair early**; keep the geometry-render fallback (#6.4) so the feature degrades gracefully.
2. **Coordinate alignment for the fallback render.** DB `Location` is Revit project/internal coords in **mm**; IFC geometry uses its own units (usually metres), placement, project base point, and possible true-north rotation. Overlaid void meshes may need a unit scale + offset/rotation transform (possibly a one-time calibration). The match-existing-element path (preferred) avoids this entirely.
3. **GitHub Pages can't set COOP/COEP headers.** `web-ifc` multithreading needs `SharedArrayBuffer` (cross-origin isolation). Use **single-threaded `web-ifc`**, or inject headers via `coi-serviceworker`. Pin the `web-ifc` WASM version so the worker and WASM match.
4. **Browsers can't write to arbitrary local paths.** "Save to the local .db" only truly overwrites the original on **Chromium** (File System Access API); elsewhere it's a download. Set expectations in the UI.
5. **SPA routing on Pages** needs `404.html` fallback or `HashRouter` — direct-loading `/viewer` 404s otherwise.
6. **Schema coupling.** Reading raw SQLite couples the site to VoidManagerCore's schema; a schema change in the add-in can silently break reads. Centralize table/column names in `schema.ts` and fail loudly on missing columns.
7. **Large IFC performance/memory.** Big models are slow to parse and memory-heavy in WASM. Mitigate by caching Fragments in IndexedDB (#8) and loading fragments on reopen instead of re-parsing IFC.
8. **Status value casing must match exactly** (`open for review`, `released for execution`, …) or the Revit/VmoViewer side won't recognize edits.
9. **Concurrent edits / stale file.** If the Revit add-in and the website edit the same `.db`, last-writer-wins can clobber changes. For v1, document that the file should not be open in both at once.
10. **Privacy upside, but no central source of truth (yet).** Fully client-side means files never leave the browser — good — but also no multi-user sync until the cloud phase. The `VoidRepository` abstraction is what makes that later phase non-disruptive.

---

## Future phases (designed for, not built now)
- **Cloud DB:** add `CloudRepository` behind `VoidRepository`; swap via config/env. UI unchanged.
- **Auth:** replace stub `AuthProvider` with real auth (e.g. OAuth/JWT); add `/login`, route guards.
- **Project management:** `/projects` pages using the same TanStack Query layer.

---

## Verification (end-to-end)
1. `npm run dev` → info page renders, `/viewer` route loads.
2. Load a sample `.ifc` → model appears in 3D; load its `.db` → grid populates with voids and correct statuses.
3. Select grid rows → matching IFC elements highlight + camera fits; for unmatched voids, fallback meshes render and highlight.
4. Change a status in the grid → on Chromium the original `.db` is overwritten (reopen confirms persisted value); elsewhere a corrected `.db` downloads. Verify the written value with a SQLite browser and, ideally, by reopening in VmoViewer/the Revit add-in.
5. Save an IFC configuration, reload the page, reopen the configuration → models + grid restore from IndexedDB without re-picking files.
6. `npm run build` succeeds; push to `main` → GitHub Action deploys; the Pages URL works including a hard refresh on `/viewer`.

## Milestones (suggested order)
0. **Visual prototype first (no real implementation).** Build a self-contained HTML **playground** (via the `playground` skill) that mocks the `/viewer` layout: 3D canvas placeholder, the void datagrid with the six status values in an editable cell, row-selection → "highlight" feedback, and the load-IFC / load-db / save-config controls. Use dummy data — no IFC parsing, no sql.js. **Get user feedback on this dummy, then revise this plan before writing any production code.**
1. Repo scaffold (Vite+React+TS) + GH Pages Action + info page + routing.
2. Viewer loads local IFC(s).
3. sql.js reads `.db` → grid populated (read-only).
4. Selection sync (match + fallback render).
5. Status editing + write-back (download first, then File System Access).
6. IFC configuration caching (IndexedDB).
7. Harden: pitfalls #2/#3/#5, polish, docs.

> **Order of operations:** Milestone 0 (playground dummy + feedback) happens **before** copying this plan into the new repo and before any scaffolding. The prototype is throwaway — its only job is to validate layout/UX and surface plan changes cheaply.
