# IFC Findings — `fixtures/E_AIH_68_INS-KLI_HOM_Klimaat.ifc`

Reconnaissance via `scripts/inspect-ifc.mjs` (run: `node scripts/inspect-ifc.mjs "fixtures/<file>.ifc"`).
Informs M2 Stage B (selection sync + identifier matching).

## Source
- **Autodesk Revit 2025 (ENG)** export. Project **"ASML Industrial Hub"**, phase "Concept Design".
- Author org **Homij** ("Installateur") → this is the **MEP / climate ("Klimaat")** model.
- 56,541 IFC instances.

## Element types present
`IFCFLOWTERMINAL` 8 · `IFCFLOWSEGMENT` 18 · `IFCFLOWFITTING` 20 · `IFCBUILDINGELEMENTPROXY` 5 ·
`IFCOPENINGELEMENT` 1 · `IFCBUILDINGSTOREY` 3 · `IFCBUILDING` 1 · `IFCSITE` 1.

Mostly **MEP flow elements** (ducts/pipes/fittings/terminals). **No walls, slabs, columns, or beams**
(the structural hosts of the voids are not in this model).

## Identifier mapping (key for selection sync)
- **Revit ElementId → IFC `Tag`** (numeric). Confirmed: every sampled element's `Tag` is a numeric
  Revit ElementId, e.g. `8625395`, `8446659`, `2719896`. 20/20 sampled Tags numeric.
- **No** Revit `ElementId`/`UniqueId` properties in the first 200 property sets — Revit's IFC export
  puts the ElementId in `Tag`, not in a Pset.
- IFC `GlobalId` is the standard derived 22-char IfcGuid (e.g. `0ti6n8ppj4BeyjsGYLQxfi`).

## The mismatch (important)
- DB void `ExternalId`s are **6-digit** (`826492`, `826510`, …) — ElementIds from a **different**
  (structural/architectural) Revit model where the openings live.
- This MEP IFC's Tags are **7-digit** MEP ElementIds (`8xxxxxx`). They do **not** overlap.
- ⇒ **Void → element matching finds nothing against this IFC.** The voids are simply not in the
  climate model.

## Implication for Stage B
1. Build the matching infra anyway (correct for a matching structural IFC):
   - `ifcIndex`: `Tag` (ElementId int) → expressID, and `GlobalId` → expressID, per model.
   - `revitGuid.ts`: Revit UniqueId → 22-char IfcGuid (host `ExternalId` is a Revit UniqueId).
   - Match priority: void `ExternalId` == `GlobalId` → `revitGuid(UniqueId)` == `GlobalId` →
     void `ExternalId` (int) == `Tag`.
2. **Primary path for THIS dataset = fallback void meshes**: render each void as a cylinder (circle)
   / box (rectangle) from DB `Location` + size + `Direction`, in a dedicated group; highlight +
   fit-to on grid selection.
3. **Coordinate alignment** (pitfall #2): DB `Location` is Revit internal mm; IFC geometry uses its
   own units + placement. The fallback meshes need a unit scale (mm → m) and likely an offset to sit
   in the same space as the MEP model. Without a matching structural IFC, perfect overlay may need a
   one-time calibration; v1 can render voids in their own space and fit-to-void on selection.

## Pinned versions (WASM ↔ glue must match — plan pitfall #3)
- `web-ifc@0.0.77` (pinned exact), `three@0.184.0`, `@thatopen/components@3.4.6`,
  `@thatopen/fragments@3.4.5`.
- Single-threaded web-ifc only (GH Pages can't set COOP/COEP). WASM served from `public/wasm/`,
  fragments worker from `public/fragments-worker.mjs`.
