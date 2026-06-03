# Project Status & Handoff

VoidManager web viewer — static, fully client-side site for reviewing structural voids from a
VoidManager `.db` (+ optional IFC model) in the browser. Branch: **`feat/scaffold`** (not yet
merged to `main`/deployed). Stack + architecture: see `CLAUDE.md`, `docs/PLAN.md`.

## What works today (read-only v1)

- **Home** (`/`): marketing/info page.
- **Viewer** (`/#/viewer`):
  - Load the `.db`: Chromium folder grant → auto-finds the single `.db`; `<input type=file>`
    fallback elsewhere. Session cached in IndexedDB → reload restores without re-picking.
  - **Datagrid** (AG Grid): project selector, per-column search + sort, show/hide columns,
    multi-select, status counts, include-closed toggle. Status shown as text.
  - **3D**: loads a local `.ifc` (single-thread `web-ifc`, pinned `0.0.77`); renders **fallback
    void meshes** (cylinder/box from DB Location+size+Direction). Selecting grid rows highlights
    the matching IFC element (or the void mesh) and fits the camera.
- All green: `npx tsc --noEmit`, **86** Vitest, `npm run build`, **21** Playwright E2E.

## Commands

```
npm run dev          # dev server  → http://localhost:5173/Voidmanager-website/#/viewer
npm run build        # tsc --noEmit && vite build → dist/
npm run test         # Vitest unit
npm run test:e2e     # Playwright (auto-starts dev server; needs fixtures/ for the data-backed specs)
```

Local test fixtures (gitignored, never committed): `fixtures/sample.db`,
`fixtures/E_AIH_68_INS-KLI_HOM_Klimaat.ifc`. Dev utilities: `scripts/inspect-db.mjs`,
`scripts/inspect-ifc.mjs`.

## Key code

- `src/data/` — `VoidRepository` (interface) · `LocalDbRepository` (sql.js dictionary-decode reads)
  · `dbLocator` (FS Access folder scan + fallback) · `sqlEngine` · `schema.ts`.
- `src/features/viewer/` — `ThreeDViewer` (OBC/three wrapper, imperative handle) · `world.ts`
  (World, IFC load, void meshes, selection highlight + fit, fragment export/restore) · `voidMeshes`.
- `src/features/voids/VoidGrid.tsx` · `src/features/config/configStore.ts` (IndexedDB) ·
  `src/lib/revitGuid.ts` · `src/lib/ifcIndex.ts`.

## Deferred / open items

1. **Status write-back (M5) — NOT built.** The `.db` is a dictionary-encoded, mutation-versioned
   object store; a status edit is not a simple `UPDATE` (see `docs/SCHEMA_FINDINGS.md`). Needs
   reverse-engineering the mutation write + validation against Revit/VmoViewer. UI is read-only.
2. **Identifier matching is dormant on the current data.** The fixture IFC is the MEP model; the DB
   voids belong to a different (structural) model, so void↔element matches are empty and the
   fallback meshes are shown. To validate the match path, load a **structural IFC** containing the
   project's voids/hosts. See `docs/IFC_FINDINGS.md`.
3. **`revitUniqueIdToIfcGuid` unvalidated** — compress/decompress are correct, but Revit's exporter
   XORs the element-id episode; the host-match path must be validated/fixed against a real pair.
4. **Coordinate overlay** — void meshes are rotated Revit Z-up→three Y-up to stand upright but are
   NOT position-aligned with the IFC (no shared origin). Selecting a void fits the camera to it.
   A scale/offset calibration seam exists in `voidMeshes.ts`.
5. **Bundle** — the viewer chunk is ~1.35 MB gz (three + AG Grid + sql.js + web-ifc). Home is split
   out (~75 kB gz). Could sub-split further.
6. **Named configs** — `configStore` supports multiple named sessions; the UI only auto-restores
   the most recent.

## Deploy (when ready)

Merge `feat/scaffold` → `main`. The `.github/workflows/deploy.yml` Action builds and publishes to
GitHub Pages. **One-time setup:** repo Settings → Pages → Source = "GitHub Actions". Vite `base` is
`/Voidmanager-website/`; routing uses `HashRouter` so `/#/viewer` survives hard refresh.
