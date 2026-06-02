# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Static website for the VoidManager Revit add-in. Deployed to GitHub Pages (auto-deploy on push to `main`).

Two pages: a plain info/marketing page and a 3D IFC viewer with a void datagrid. The viewer lets users load local `.ifc` files + a VoidManager `.db` file, view voids in 3D, change approval status, and sync selection between grid rows and 3D elements — all fully client-side (no backend).

Full implementation plan: `C:\Users\taco\.claude\plans\Void manager website plan.md`

## Stack (once scaffolded)

| Concern | Library |
|---|---|
| Build | Vite + React + TypeScript |
| Routing | React Router (`HashRouter` for GH Pages) |
| 3D / IFC | `@thatopen/components` + `@thatopen/fragments` + `web-ifc` |
| SQLite | `sql.js` (reads/writes local `.db` client-side) |
| Datagrid | AG Grid Community |
| Server-state | TanStack Query |
| Client state | Zustand |
| Local cache | IndexedDB via `idb` |
| File write-back | File System Access API (Chromium) + download fallback |

## Commands (once scaffolded)

```bash
npm run dev          # dev server
npm run build        # production build → dist/
npm run preview      # serve dist/ locally
npm run test         # Vitest unit tests
npm run test:e2e     # Playwright E2E tests (requires dev server running)
npx tsc --noEmit     # type-check without emitting
```

## Testing strategy

**Vitest** — unit tests for pure logic (no browser needed):
- `revitGuid.ts` conversion (test against known UniqueId→IfcGuid pairs)
- `schema.ts` / status enum validation
- `LocalDbRepository` query logic (sql.js runs fine in Node)
- `ifcIndex` lookup logic with mock data

**Playwright** — E2E for all UI behavior:
- Route navigation (`/`, `/#/viewer`)
- File inputs: inject fixture `.db` bytes via `page.setInputFiles` (avoids `showOpenFilePicker` browser security block)
- AG Grid row selection, status dropdown editing, cell value assertions
- Status write-back flow (download triggered or file handle saved)
- IndexedDB config save → page reload → restore without re-picking files

**What cannot be automated:**
- 3D canvas visual correctness (WebGL) — assert canvas exists + nonzero dimensions + zero console errors as a proxy
- `window.showOpenFilePicker()` — use `setInputFiles` fallback path in all E2E tests

## Self-verification cycle

Before asking the user to review any milestone, run all of the following and fix failures:

1. `npx tsc --noEmit` — zero type errors
2. `npm run build` — clean production build
3. `npm run test` — all Vitest unit tests pass
4. Start dev server + `npm run test:e2e` — all Playwright tests pass
5. Check browser console during key E2E flows — zero unhandled errors
6. Report to user with Playwright HTML report (`playwright-report/index.html`) as evidence

## Architecture

```
src/
  app/            # routing, QueryClient, Auth, theme providers
  pages/          # Home.tsx, Viewer.tsx
  features/
    viewer/       # OBC World setup, IfcImporter, Highlighter, selection sync
    voids/        # void datagrid, status editing, row↔element mapping
    config/       # IFC configuration save/load (IndexedDB)
  data/
    VoidRepository.ts      # interface — all UI code talks to this only
    LocalDbRepository.ts   # sql.js implementation (current)
    CloudRepository.ts     # REST stub (future swap-in)
    schema.ts              # table/column constants and status enum
  auth/
    AuthProvider.tsx       # no-op stub now; real OAuth/JWT later
  lib/
    revitGuid.ts           # Revit UniqueId → IfcGuid 22-char base64 conversion
    ifcIndex.ts            # GlobalId / Tag / UniqueId index built from loaded model
  store/                   # Zustand stores: selection, models, config
```

**`VoidRepository` is the key abstraction.** `LocalDbRepository` backs it today. When the DB moves to the cloud, `CloudRepository` replaces it behind the same interface — no UI rewrite needed.

## Domain model (VoidManagerCore)

Hierarchy: `Project → Building → Story → (VoidCircle[], VoidRectangle[])`.

Void fields relevant to the grid: `ID`, `ExternalId`, `StatusOfApproval`, `AssignedTo`, `Location` (Point3D X/Y/Z mm), `Direction` (Vector3D), `Thickness`, `Width`/`Height`/`Diameter`, `HostID`, `SequenceName`, plus `SuperSubHostIntersections` → `HostElementSuper`/`HostElementSub` (each has `ExternalId`, `Name`, `Category`, `Model`).

**Approval status exact strings** (must match precisely — VmoViewer/Revit add-in won't recognize edits otherwise):
`concept`, `open for review`, `approved`, `rejected`, `released for execution`, `executed`

## Critical pitfalls

- **Identifier semantics are tricky.** Void `ExternalId` may be a Revit ElementId int *or* a GUID depending on code path. Host `ExternalId` is the Revit UniqueId. IFC `GlobalId` is a derived 22-char IfcGuid (not the raw UniqueId). Resolve against a real `.db` + matching IFC before assuming any match strategy.
- **`SharedArrayBuffer` / cross-origin isolation.** GitHub Pages can't set COOP/COEP headers. Use single-threaded `web-ifc` or `coi-serviceworker`. Pin `web-ifc` WASM version so worker and WASM match.
- **File write-back.** Only Chromium (File System Access API) can truly overwrite the original `.db`. Other browsers get a download. The UI must make this clear.
- **SPA routing.** Use `HashRouter` or add a `404.html` copy of `index.html` so `/viewer` doesn't 404 on hard refresh.
- **Schema coupling.** All table/column names live in `schema.ts` only. Fail loudly on missing columns.
- **Coordinate space.** DB `Location` is Revit internal coords in mm; IFC uses its own units + placement. Fallback void meshes need unit scale + offset transform.
- **Status casing.** Status strings are lowercase with spaces — store and compare exactly as listed above.
