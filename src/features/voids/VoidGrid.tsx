/**
 * VoidGrid — AG Grid Community datagrid rendering VoidRow data.
 *
 * Read-only v1: no status editing, no write-back.
 *
 * AG Grid 35 setup:
 *  - AllCommunityModule registered once (covers ClientSideRowModel, TextFilter,
 *    NumberFilter, RowSelection, ColumnApi, etc.)
 *  - Theming via themeQuartz.withParams for dark palette
 *  - rowSelection object form: { mode: 'multiRow' }
 *  - Column visibility toggled via gridRef.current.api.applyColumnState()
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type CellValueChangedEvent,
  type ColDef,
  type GetRowIdParams,
  type GridReadyEvent,
  type IRowNode,
  type SelectionChangedEvent,
} from 'ag-grid-community';
import type { VoidRow } from '../../data/VoidRepository';
import { APPROVAL_STATUSES, type ApprovalStatus } from '../../data/schema';
import { setSelection, useSelection, type SelectionRef } from '../../store/selectionStore';
import { mergeDirty } from './statusEdit';
import styles from './VoidGrid.module.css';

// Register all community modules once (safe to call multiple times).
ModuleRegistry.registerModules([AllCommunityModule]);

// ---------------------------------------------------------------------------
// Garbage-size guard: values over 100 000 mm are legacy ProjectStartUp artefacts.
// ---------------------------------------------------------------------------
const MAX_COORD = 100_000;

function guardNum(value: number | null | undefined): string {
  if (value == null) return '—';
  if (!isFinite(value) || Math.abs(value) > MAX_COORD) return '—';
  return String(value);
}

function guardCoord(value: number | null | undefined): string {
  return guardNum(value);
}

// ---------------------------------------------------------------------------
// Dark theme matching global.css palette
// ---------------------------------------------------------------------------
const darkTheme = themeQuartz.withParams({
  backgroundColor: '#0f1117',
  foregroundColor: '#e2e8f0',
  borderColor: '#2d3748',
  chromeBackgroundColor: '#161b22',
  oddRowBackgroundColor: '#161b22',
  rowHoverColor: '#1e2736',
  selectedRowBackgroundColor: 'rgba(56, 189, 248, 0.15)',
  headerBackgroundColor: '#161b22',
  headerTextColor: '#94a3b8',
  fontSize: 13,
  rowHeight: 34,
  headerHeight: 36,
});

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

/** All column IDs that are hidden by default. */
const HIDDEN_BY_DEFAULT = new Set(['id', 'externalId']);

/** Human-readable label for each column ID (used in column chooser). */
export const COLUMN_LABELS: Record<string, string> = {
  sequenceName: 'Seq',
  type: 'Type',
  status: 'Status',
  assignedTo: 'Assigned To',
  level: 'Level',
  host: 'Host',
  size: 'Size',
  thickness: 'Thickness',
  locX: 'Location X',
  locY: 'Location Y',
  locZ: 'Location Z',
  id: 'ID',
  externalId: 'External ID',
};

function buildColumnDefs(): ColDef<VoidRow>[] {
  return [
    {
      colId: 'sequenceName',
      headerName: 'Seq',
      field: 'sequenceName',
      valueFormatter: ({ value }: { value: string | null }) => value ?? '—',
      width: 110,
      filter: 'agTextColumnFilter',
      floatingFilter: true,
      sortable: true,
    },
    {
      colId: 'type',
      headerName: 'Type',
      field: 'type',
      width: 70,
      valueFormatter: ({ value }: { value: 'circle' | 'rectangle' }) =>
        value === 'circle' ? '○ circle' : '▭ rect',
      filter: 'agTextColumnFilter',
      floatingFilter: true,
      sortable: true,
    },
    {
      colId: 'status',
      headerName: 'Status',
      field: 'status',
      width: 170,
      // Plain text — no color pills (per VIEWER_SPEC).
      // M14: the ONLY inline-editable column — a fixed-value select dropdown.
      editable: true,
      cellEditor: 'agSelectCellEditor',
      cellEditorParams: { values: [...APPROVAL_STATUSES] },
      filter: 'agTextColumnFilter',
      floatingFilter: true,
      sortable: true,
    },
    {
      colId: 'assignedTo',
      headerName: 'Assigned To',
      field: 'assignedTo',
      valueFormatter: ({ value }: { value: string | null }) => value ?? '—',
      width: 180,
      filter: 'agTextColumnFilter',
      floatingFilter: true,
      sortable: true,
    },
    {
      colId: 'level',
      headerName: 'Level',
      width: 160,
      valueGetter: ({ data }: { data?: VoidRow }) => {
        if (!data?.story) return null;
        const { name, elevation } = data.story;
        if (elevation == null) return name;
        const m = (elevation / 1000).toFixed(3);
        return `${name} (+${m} m)`;
      },
      filter: 'agTextColumnFilter',
      floatingFilter: true,
      sortable: true,
    },
    {
      colId: 'host',
      headerName: 'Host',
      field: 'host',
      valueFormatter: ({ value }: { value: string | null }) => value ?? '—',
      width: 180,
      filter: 'agTextColumnFilter',
      floatingFilter: true,
      sortable: true,
    },
    {
      colId: 'size',
      headerName: 'Size',
      width: 120,
      valueGetter: ({ data }: { data?: VoidRow }) => {
        if (!data) return '—';
        if (data.type === 'circle') {
          const d = data.sizeMm.diameter;
          return d != null && isFinite(d) && d <= MAX_COORD ? `Ø ${d} mm` : '—';
        } else {
          const w = data.sizeMm.width;
          const h = data.sizeMm.height;
          if (w != null && h != null && isFinite(w) && isFinite(h) && w <= MAX_COORD && h <= MAX_COORD) {
            return `${w} × ${h} mm`;
          }
          return '—';
        }
      },
      filter: 'agTextColumnFilter',
      floatingFilter: true,
      sortable: true,
    },
    {
      colId: 'thickness',
      headerName: 'Thickness',
      width: 110,
      valueGetter: ({ data }: { data?: VoidRow }) => {
        if (!data?.thicknessMm) return '—';
        const t = data.thicknessMm;
        return isFinite(t) && t <= MAX_COORD ? `${t} mm` : '—';
      },
      filter: 'agTextColumnFilter',
      floatingFilter: true,
      sortable: true,
    },
    {
      colId: 'locX',
      headerName: 'Location X',
      width: 110,
      valueGetter: ({ data }: { data?: VoidRow }) => guardCoord(data?.location?.x),
      filter: 'agNumberColumnFilter',
      floatingFilter: true,
      sortable: true,
    },
    {
      colId: 'locY',
      headerName: 'Location Y',
      width: 110,
      valueGetter: ({ data }: { data?: VoidRow }) => guardCoord(data?.location?.y),
      filter: 'agNumberColumnFilter',
      floatingFilter: true,
      sortable: true,
    },
    {
      colId: 'locZ',
      headerName: 'Location Z',
      width: 110,
      valueGetter: ({ data }: { data?: VoidRow }) => guardCoord(data?.location?.z),
      filter: 'agNumberColumnFilter',
      floatingFilter: true,
      sortable: true,
    },
    {
      colId: 'id',
      headerName: 'ID',
      field: 'id',
      width: 80,
      hide: true,
      filter: 'agNumberColumnFilter',
      floatingFilter: true,
      sortable: true,
    },
    {
      colId: 'externalId',
      headerName: 'External ID',
      field: 'externalId',
      valueFormatter: ({ value }: { value: string | null }) => value ?? '—',
      width: 220,
      hide: true,
      filter: 'agTextColumnFilter',
      floatingFilter: true,
      sortable: true,
    },
  ];
}

// ---------------------------------------------------------------------------
// Summary line
// ---------------------------------------------------------------------------

function buildSummary(rows: VoidRow[]): string {
  const total = rows.length;
  if (total === 0) return '0 voids';

  const counts = new Map<string, number>();
  for (const v of rows) {
    counts.set(v.status, (counts.get(v.status) ?? 0) + 1);
  }

  const parts: string[] = [`${total} void${total !== 1 ? 's' : ''}`];
  // Emit counts in APPROVAL_STATUSES order, skip zeros.
  for (const s of APPROVAL_STATUSES) {
    const n = counts.get(s) ?? 0;
    if (n > 0) parts.push(`${n} ${s}`);
  }
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Column chooser dropdown
// ---------------------------------------------------------------------------

interface ColumnChooserProps {
  visibleCols: Set<string>;
  onToggle: (colId: string, visible: boolean) => void;
  includeClosed: boolean;
  onIncludeClosedChange: (v: boolean) => void;
}

function ColumnChooser({ visibleCols, onToggle, includeClosed, onIncludeClosedChange }: ColumnChooserProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className={styles.chooserWrapper}>
      <button
        type="button"
        className={styles.chooserBtn}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open ? 'true' : 'false'}
        aria-haspopup="dialog"
        title="Show/hide columns"
      >
        Columns ▾
      </button>
      {open && (
        <div className={styles.chooserDropdown} role="dialog" aria-label="Column chooser">
          <div className={styles.chooserSection}>
            {Object.entries(COLUMN_LABELS).map(([colId, label]) => (
              <label key={colId} className={styles.chooserItem}>
                <input
                  type="checkbox"
                  checked={visibleCols.has(colId)}
                  onChange={(e) => onToggle(colId, e.target.checked)}
                />
                {label}
              </label>
            ))}
          </div>
          <div className={styles.chooserDivider} />
          <label className={styles.chooserItem}>
            <input
              type="checkbox"
              checked={includeClosed}
              onChange={(e) => onIncludeClosedChange(e.target.checked)}
            />
            Include closed voids
          </label>
          <button
            type="button"
            className={styles.chooserClose}
            onClick={() => setOpen(false)}
            aria-label="Close column chooser"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface VoidGridProps {
  rows: VoidRow[];
  loading: boolean;
  includeClosed: boolean;
  onIncludeClosedChange: (v: boolean) => void;
}

// ---------------------------------------------------------------------------
// VoidGrid component
// ---------------------------------------------------------------------------

export default function VoidGrid({
  rows,
  loading,
  includeClosed,
  onIncludeClosedChange,
}: VoidGridProps) {
  const gridRef = useRef<AgGridReact<VoidRow>>(null);
  const columnDefs = useMemo(() => buildColumnDefs(), []);
  const summary = useMemo(() => buildSummary(rows), [rows]);

  // Unified selection store (grid ↔ 3D ↔ browser).
  const selection = useSelection();
  // Guards the grid's selectionChanged handler while we programmatically reflect
  // an external (non-grid) selection, so reflection does not echo back to the store.
  const applyingExternalRef = useRef(false);

  // M14: ids of voids whose status was edited in-memory (not written to the .db).
  const [dirtyIds, setDirtyIds] = useState<Set<number>>(() => new Set());
  // Discard dirty edits when the dataset changes (project switch / reload).
  useEffect(() => {
    setDirtyIds(new Set());
  }, [rows]);

  // Track which columns are visible for the chooser checkboxes.
  const [visibleCols, setVisibleCols] = useState<Set<string>>(
    () =>
      new Set(
        Object.keys(COLUMN_LABELS).filter((colId) => !HIDDEN_BY_DEFAULT.has(colId)),
      ),
  );

  const defaultColDef = useMemo<ColDef>(
    () => ({
      resizable: true,
      suppressMovable: false,
      minWidth: 60,
    }),
    [],
  );

  const rowSelection = useMemo(
    () => ({ mode: 'multiRow' as const }),
    [],
  );

  const onGridReady = useCallback((_params: GridReadyEvent) => {
    // Grid is ready — nothing extra needed for read-only v1.
  }, []);

  const onSelectionChanged = useCallback((event: SelectionChangedEvent<VoidRow>) => {
    // Ignore selection events caused by our own programmatic reflection.
    if (applyingExternalRef.current) return;
    const selected = event.api.getSelectedRows();
    const refs: SelectionRef[] = selected.map((r) => ({ kind: 'void', voidId: r.id }));
    setSelection(refs, 'grid');
  }, []);

  // Reflect external (non-grid) selection changes into the grid's row selection.
  // When the change originated in the grid we skip — the grid is already in sync.
  // The store's key-set no-op guard + applyingExternalRef break any feedback loop.
  useEffect(() => {
    const api = gridRef.current?.api;
    if (!api) return;
    if (selection.source === 'grid') return;
    const wanted = new Set<number>();
    for (const ref of selection.refs) {
      if (ref.kind === 'void') wanted.add(ref.voidId);
    }
    applyingExternalRef.current = true;
    let firstWantedNode: IRowNode<VoidRow> | null = null;
    try {
      api.forEachNode((node) => {
        const id = node.data?.id;
        const shouldSelect = id != null && wanted.has(id);
        if (node.isSelected() !== shouldSelect) node.setSelected(shouldSelect);
        if (shouldSelect && !firstWantedNode) firstWantedNode = node;
      });
    } finally {
      queueMicrotask(() => {
        applyingExternalRef.current = false;
      });
    }
    if (firstWantedNode) {
      api.ensureNodeVisible(firstWantedNode, 'middle');
    }
  }, [selection]);

  // M14: mark a void dirty when its status is edited inline.
  const onCellValueChanged = useCallback((e: CellValueChangedEvent<VoidRow>) => {
    const id = e.data?.id;
    if (id != null) setDirtyIds((prev) => mergeDirty(prev, [id]));
  }, []);

  // M14: bulk-apply a status to every selected row (in-memory only).
  const handleBulkStatus = useCallback((status: ApprovalStatus) => {
    const api = gridRef.current?.api;
    if (!api) return;
    const ids: number[] = [];
    for (const node of api.getSelectedNodes()) {
      if (node.data) {
        node.setDataValue('status', status);
        ids.push(node.data.id);
      }
    }
    if (ids.length > 0) setDirtyIds((prev) => mergeDirty(prev, ids));
  }, []);

  const handleColumnToggle = useCallback(
    (colId: string, visible: boolean) => {
      const api = gridRef.current?.api;
      if (api) {
        api.applyColumnState({ state: [{ colId, hide: !visible }] });
      }
      setVisibleCols((prev) => {
        const next = new Set(prev);
        if (visible) next.add(colId);
        else next.delete(colId);
        return next;
      });
    },
    [],
  );

  return (
    <div className={styles.gridWrapper}>
      {/* Toolbar row */}
      <div className={styles.toolbar}>
        <span className={styles.summary}>{summary}</span>

        {/* M14: bulk status edit for the selected rows */}
        <select
          className={styles.bulkSelect}
          data-testid="bulk-status-select"
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (v) {
              handleBulkStatus(v as ApprovalStatus);
              e.target.value = '';
            }
          }}
          title="Set the approval status for all selected rows"
        >
          <option value="">Set status…</option>
          {APPROVAL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        {/* M14: in-memory unsaved-edits indicator (write-back deferred) */}
        {dirtyIds.size > 0 && (
          <span className={styles.dirtyBadge} data-testid="dirty-status" title="Status edits are in-memory only — not written to the .db">
            {dirtyIds.size} unsaved
          </span>
        )}

        <ColumnChooser
          visibleCols={visibleCols}
          onToggle={handleColumnToggle}
          includeClosed={includeClosed}
          onIncludeClosedChange={onIncludeClosedChange}
        />
      </div>

      {/* AG Grid */}
      <div className={styles.gridContainer}>
        <AgGridReact<VoidRow>
          ref={gridRef}
          theme={darkTheme}
          rowData={rows}
          loading={loading}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          rowSelection={rowSelection}
          getRowId={(p: GetRowIdParams<VoidRow>) => String(p.data.id)}
          onGridReady={onGridReady}
          onSelectionChanged={onSelectionChanged}
          onCellValueChanged={onCellValueChanged}
          suppressCellFocus={false}
          animateRows={false}
        />
      </div>
    </div>
  );
}
