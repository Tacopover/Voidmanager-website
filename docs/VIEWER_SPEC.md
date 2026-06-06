# VoidManager Web Viewer — `/viewer` Page Spec

Locked design + feature direction for the real React `/viewer` page, derived from the
Milestone-0 playground (`playground/viewer-playground.html`) and user feedback.
See `docs/PLAN.md` for the full implementation plan and architecture.

---

## Chosen layout & styling (from playground)

- **3D view on TOP, void grid BELOW** (stacked layout).
- **Compact grid**, ~34px row height.
- **Status as plain text** — no color-coded pills.
- **Subtle panel corners**, 4px radius.
- **Location X / Location Y / Location Z** columns shown by default.

## Fixed facts (NOT design choices — these must hold)

- Six approval status values, **case-sensitive, lowercase with spaces**, exact:
  `concept`, `open for review`, `approved`, `rejected`, `released for execution`, `executed`.
  Must match the VoidManager Revit add-in exactly or edits won't be recognized.
- **Status is the only inline-editable column.**
- Selecting one or more grid rows **highlights the matching 3D element(s)** and triggers a
  **fit-to-element camera move**.
- **Fully client-side.** Loads a local `.ifc` model + the local SQLite `.db`. Write-back uses
  the File System Access API (Chromium) with a download fallback on other browsers.

---

## Feature requirements (from feedback)

1. **No "Load .db" button.** There is exactly one VoidManager `.db` per local AppData folder
   (`%LOCALAPPDATA%\VoidManager`). The app loads that single db without a dedicated per-load
   toolbar button. Browser security still requires a one-time grant — a directory handle via the
   File System Access API on Chromium, or a one-time file pick fallback elsewhere — but there is
   **no recurring "Load .db" action** in the UI. After the first grant, the db is auto-loaded.

2. **Project navigation.** A project selector listing every project found in the db; choosing one
   loads its `Building → Story → Voids` and populates the grid. Mirrors
   `VoidManager.GetProjectNames` + `PullFromDatabase(projectName)` from VMServices.cs.

3. **Close / Reopen voids.** Toolbar/context actions on the selected void(s) to **Close** or
   **Reopen** them (mirrors VMServices `CloseSelectedVoids` / `ReopenSelectedVoids`). Provide a
   show/hide-closed filter; closed voids are tracked, not deleted.

4. **Multi-edit status.** Select multiple rows → set the approval status for **all selected rows at
   once** (bulk status change), in addition to single-cell inline edit. Bulk edit must write the
   same exact status string to every selected void.

5. **Per-column search + sortable columns.** Every column has its own filter/search input (floating
   filter) and is sortable by clicking the header.

6. **Add / remove columns.** The user can show/hide any column via a column chooser.
   > Note: AG Grid **Community** has no built-in columns tool-panel (that's Enterprise). Implement a
   > custom column-visibility menu using the Community column API (`columnApi.setColumnVisible`).

## Loading model (UX)

- **Load IFC** — still a button; supports multiple IFCs (host model + void-geometry model).
- **.db** — auto-loaded, see #1. Not a button.
- **Save configuration** — cache the loaded model set (fragments) + db reference for quick reopen.
- **Save changes** — write edited statuses back to the `.db` (FS Access API write-back / download
  fallback) with a clear saved/downloaded status indicator.

## Deferred / out of scope for v1

- `MergeSelectedVoids` exists in VMServices — **not** requested for v1; future/optional.
- `Reviewer[]` per void — optional column, future.
- **Real SQLite schema** (table/column names for read + write-back) must be read from an actual
  `.db`; `VoidManagerCore.dll` hides it behind `Pull/PushFromDatabase`. Milestone-3 task before
  any write path is final.

---

## Updated copy-out prompt (playground choices + feedback)

> Build the `/viewer` page with the following design. Layout: place the 3D view on **top** and the
> void grid **below** it (stacked). Use a **compact grid** (~34px rows) with **plain-text status**
> (no color pills) and **subtle 4px** panel corners. Show the **Location X / Y / Z** columns by
> default.
>
> The six exact approval status values (case-sensitive, lowercase with spaces) are: `concept`,
> `open for review`, `approved`, `rejected`, `released for execution`, `executed` — they must match
> the VoidManager Revit add-in exactly. The **Status column is the only inline-editable column**.
> Selecting one or more grid rows must **highlight the matching 3D element(s)** and trigger a
> **fit-to-element** camera move. The app is fully client-side: it loads a local `.ifc` and a local
> SQLite `.db` via the File System Access API (Chromium) with a download fallback for other
> browsers.
>
> Additional behavior:
> - **No "Load .db" button** — there is one VoidManager `.db` per `%LOCALAPPDATA%\VoidManager`
>   folder; load it automatically after a one-time access grant (directory handle on Chromium,
>   one-time file pick fallback). Keep a **Load IFC** button (supports multiple IFCs).
> - **Project navigation:** a project selector listing the projects in the db; selecting one loads
>   its Building → Story → Voids into the grid.
> - **Close / Reopen voids:** actions on the selected rows to close or reopen voids, plus a
>   show/hide-closed filter.
> - **Multi-edit status:** select multiple rows and set the approval status for all at once, in
>   addition to single-cell editing.
> - **Per-column search + sortable columns:** each column has its own filter input and is sortable.
> - **Add/remove columns:** a column chooser to show/hide any column (custom menu — AG Grid
>   Community has no columns tool-panel).
