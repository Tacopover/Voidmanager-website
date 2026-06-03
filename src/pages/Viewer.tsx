/**
 * Viewer page — /viewer route.
 *
 * Layout: 3D view placeholder on top, void datagrid below (stacked).
 * Read-only v1: DB loading, project selector, read-only void grid.
 * Write-back (status editing, close/reopen) deferred to M2+.
 *
 * M6: IndexedDB config caching — save/restore session without re-picking files.
 */

import { useCallback, useState, useRef, useEffect } from 'react';
import DbLoader from '../features/viewer/DbLoader';
import ThreeDViewer, { type ThreeDViewerHandle } from '../features/viewer/ThreeDViewer';
import VoidGrid from '../features/voids/VoidGrid';
import { createLocalRepository } from '../data/sqlEngine';
import type { VoidRepository, VoidRow, ProjectSummary } from '../data/VoidRepository';
import { saveConfig, getMostRecent } from '../features/config/configStore';
import styles from './Viewer.module.css';

// ---------------------------------------------------------------------------
// Viewer state machine
// ---------------------------------------------------------------------------

type ViewerPhase =
  | { tag: 'needsDb' }
  | { tag: 'loading' }
  | { tag: 'ready'; repo: VoidRepository; canWriteBack: boolean };

// ---------------------------------------------------------------------------
// Viewer component
// ---------------------------------------------------------------------------

export default function Viewer() {
  const [phase, setPhase] = useState<ViewerPhase>({ tag: 'needsDb' });

  // Projects + selected project
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

  // Voids for the selected project
  const [voids, setVoids] = useState<VoidRow[]>([]);
  const [voidsLoading, setVoidsLoading] = useState(false);
  const [voidsError, setVoidsError] = useState<string | null>(null);

  // Inline error banner for DB-load failures (replaces alert())
  const [dbError, setDbError] = useState<string | null>(null);

  // Include-closed toggle (lifted here so it can trigger a reload)
  const [includeClosed, setIncludeClosed] = useState(false);

  // Badge: FS Access vs fallback
  const [canWriteBack, setCanWriteBack] = useState(false);

  // Selected void IDs (grid → 3D sync)
  const [selectedVoidIds, setSelectedVoidIds] = useState<number[]>([]);

  // M6: retain dbBytes so we can bundle them into a saved config
  const dbBytesRef = useRef<Uint8Array | null>(null);
  const dbNameRef = useRef<string>('session');

  // M6: ref to the ThreeDViewer imperative handle
  const viewerRef = useRef<ThreeDViewerHandle>(null);

  // M6: config operation status
  const [configStatus, setConfigStatus] = useState<string>('');

  // M6: whether a saved config was found on mount (drives restore affordance)
  const [savedConfigName, setSavedConfigName] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  // M6: fragment models awaiting restore once the 3D viewer is mounted + ready.
  const [pendingModels, setPendingModels] = useState<{ id: string; bytes: Uint8Array }[]>([]);

  // -------------------------------------------------------------------------
  // M6: Check for a saved config on mount
  // -------------------------------------------------------------------------
  useEffect(() => {
    (async () => {
      try {
        const cfg = await getMostRecent();
        if (cfg) {
          setSavedConfigName(cfg.name);
        }
      } catch (e) {
        console.warn('[Viewer] getMostRecent failed:', e);
      }
    })();
  }, []);

  // -------------------------------------------------------------------------
  // M6: load pending fragment models once the 3D viewer is mounted (phase ready)
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (phase.tag !== 'ready' || pendingModels.length === 0) return;
    const viewer = viewerRef.current;
    if (!viewer) return;
    let cancelled = false;
    void (async () => {
      try {
        for (const m of pendingModels) {
          if (cancelled) return;
          await viewer.loadFragments(m.id, m.bytes);
        }
        if (!cancelled) setConfigStatus(`Restored ${pendingModels.length} model(s)`);
      } catch (e) {
        if (!cancelled) {
          setConfigStatus(`Model restore failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      } finally {
        if (!cancelled) setPendingModels([]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.tag, pendingModels]);

  // -------------------------------------------------------------------------
  // Load voids for a project
  // -------------------------------------------------------------------------
  async function loadVoids(repo: VoidRepository, projectName: string | null, closed: boolean) {
    setVoidsLoading(true);
    setVoidsError(null);
    try {
      const rows = await repo.listVoids({
        projectName: projectName ?? undefined,
        includeClosed: closed,
      });
      setVoids(rows);
    } catch (e) {
      setVoidsError(e instanceof Error ? e.message : String(e));
      setVoids([]);
    } finally {
      setVoidsLoading(false);
    }
  }

  // -------------------------------------------------------------------------
  // DB loaded callback (from DbLoader)
  // -------------------------------------------------------------------------
  const handleDbLoaded = useCallback(async (bytes: Uint8Array, wb: boolean, name?: string) => {
    setPhase({ tag: 'loading' });
    setCanWriteBack(wb);
    // M6: retain bytes + name for config save
    dbBytesRef.current = bytes;
    dbNameRef.current = name ?? 'session';
    try {
      const repo = await createLocalRepository(bytes);
      const projs = await repo.listProjects();
      setProjects(projs);
      // Default to "all projects" (null) so the grid is never empty on first load.
      setSelectedProject(null);
      setPhase({ tag: 'ready', repo, canWriteBack: wb });
      await loadVoids(repo, null, false);
    } catch (e) {
      // Fall back to needsDb with an inline error banner (no alert()).
      console.error('[Viewer] DB load failed', e);
      setDbError(`Failed to open database: ${e instanceof Error ? e.message : String(e)}`);
      setPhase({ tag: 'needsDb' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------------
  // M6: Restore session from saved config
  // -------------------------------------------------------------------------
  async function handleRestoreConfig() {
    if (!savedConfigName) return;
    setRestoring(true);
    setConfigStatus('Restoring…');
    try {
      const cfg = await getMostRecent();
      if (!cfg) {
        setConfigStatus('No saved session found.');
        setRestoring(false);
        return;
      }

      // Restore DB
      setPhase({ tag: 'loading' });
      dbBytesRef.current = cfg.dbBytes;
      dbNameRef.current = cfg.name;
      const repo = await createLocalRepository(cfg.dbBytes);
      const projs = await repo.listProjects();
      setProjects(projs);
      setSelectedProject(null);
      setPhase({ tag: 'ready', repo, canWriteBack: false });
      await loadVoids(repo, null, false);

      // Restore 3D models: hand them to the effect below, which fires once the
      // 'ready' phase has rendered the 3D pane and attached the viewer ref.
      // loadFragments() itself awaits world init, so there is no timing race.
      if (cfg.models.length > 0) {
        setConfigStatus(`Restoring ${cfg.models.length} model(s) from "${cfg.name}"…`);
        setPendingModels(cfg.models);
      } else {
        setConfigStatus(`Restored DB from "${cfg.name}" (no models saved)`);
      }
    } catch (e) {
      console.error('[Viewer] restore failed', e);
      setConfigStatus(`Restore failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRestoring(false);
    }
  }

  // -------------------------------------------------------------------------
  // M6: Save current session configuration
  // -------------------------------------------------------------------------
  async function handleSaveConfig() {
    const dbBytes = dbBytesRef.current;
    if (!dbBytes) return;

    // Prompt user for a config name (v1: simple prompt)
    const defaultName = dbNameRef.current || 'session';
    const name = window.prompt('Save configuration as:', defaultName);
    if (!name) return; // user cancelled

    setConfigStatus('Saving…');
    try {
      const viewer = viewerRef.current;
      const models = viewer ? await viewer.exportModels() : [];
      await saveConfig({ name, dbBytes, models, lastOpened: Date.now() });
      setSavedConfigName(name);
      setConfigStatus(`Saved "${name}" (${models.length} model(s))`);
    } catch (e) {
      console.error('[Viewer] save config failed', e);
      setConfigStatus(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // -------------------------------------------------------------------------
  // Project selector change
  // -------------------------------------------------------------------------
  async function handleProjectChange(name: string) {
    // Empty string means "All projects" (no filter).
    const project = name === '' ? null : name;
    setSelectedProject(project);
    if (phase.tag === 'ready') {
      await loadVoids(phase.repo, project, includeClosed);
    }
  }

  // -------------------------------------------------------------------------
  // Include-closed toggle
  // -------------------------------------------------------------------------
  async function handleIncludeClosedChange(v: boolean) {
    setIncludeClosed(v);
    if (phase.tag === 'ready') {
      await loadVoids(phase.repo, selectedProject, v);
    }
  }

  // -------------------------------------------------------------------------
  // Selection change (grid → 3D)
  // -------------------------------------------------------------------------
  function handleVoidSelectionChange(rows: VoidRow[]) {
    const ids = rows.map((r) => r.id);
    setSelectedVoidIds(ids);
    console.debug('[Viewer] void selection changed', ids.length, 'rows');
  }

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  if (phase.tag === 'needsDb') {
    return (
      <div className={styles.viewerShell}>
        <h1 className={styles.srOnly}>Viewer</h1>

        {/* Inline DB-load error banner (replaces alert()) */}
        {dbError && (
          <div className={styles.errorBannerDismissible} role="alert" data-testid="db-error-banner">
            <span>{dbError}</span>
            <button
              type="button"
              className={styles.errorDismiss}
              aria-label="Dismiss error"
              onClick={() => setDbError(null)}
            >
              ✕
            </button>
          </div>
        )}

        {/* M6: Restore affordance — shown when a saved config exists */}
        {savedConfigName && (
          <div className={styles.restoreBanner}>
            <span>Session &ldquo;{savedConfigName}&rdquo; was saved.</span>
            <button
              type="button"
              className={styles.restoreBtn}
              data-testid="restore-config-btn"
              disabled={restoring}
              onClick={() => void handleRestoreConfig()}
            >
              {restoring ? 'Restoring…' : 'Restore last session'}
            </button>
            {configStatus && (
              <span className={styles.configStatus} data-testid="config-status">
                {configStatus}
              </span>
            )}
          </div>
        )}
        <DbLoader onLoaded={(bytes, wb) => void handleDbLoaded(bytes, wb)} />
      </div>
    );
  }

  if (phase.tag === 'loading') {
    return (
      <div className={styles.viewerShell}>
        <h1 className={styles.srOnly}>Viewer</h1>
        <div className={styles.loadingOverlay}>
          <span className={styles.spinner} aria-hidden="true" />
          <p className={styles.loadingLabel}>Opening database…</p>
        </div>
      </div>
    );
  }

  // phase.tag === 'ready'
  return (
    <div className={styles.viewerShell}>
      {/* Visually-hidden page heading for accessibility and test selectors */}
      <h1 className={styles.srOnly}>Viewer</h1>

      {/* Top bar: project selector + write-back badge + M6 config controls */}
      <div className={styles.topBar}>
        {projects.length > 0 && (
          <label className={styles.projectLabel}>
            <span>Project</span>
            <select
              className={styles.projectSelect}
              value={selectedProject ?? ''}
              onChange={(e) => void handleProjectChange(e.target.value)}
            >
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <span
          className={canWriteBack ? styles.badgeWritable : styles.badgeReadonly}
          title={
            canWriteBack
              ? 'Connected via File System Access API — write-back will be available'
              : 'Read-only mode — write-back requires Chromium browser with folder access'
          }
        >
          {canWriteBack ? 'Writable' : 'Read-only'}
        </span>

        {/* M6: Save configuration button */}
        <button
          type="button"
          className={styles.configBtn}
          data-testid="save-config-btn"
          onClick={() => void handleSaveConfig()}
          title="Save current DB + 3D models to IndexedDB for quick restore"
        >
          Save session
        </button>

        {/* M6: Config status message */}
        {configStatus && (
          <span className={styles.configStatus} data-testid="config-status">
            {configStatus}
          </span>
        )}
      </div>

      {/* 3D viewer — M2 Stage B2 */}
      <div className={styles.threeDPane}>
        <ThreeDViewer ref={viewerRef} voids={voids} selectedVoidIds={selectedVoidIds} />
      </div>

      {/* Void grid */}
      <div className={styles.gridPane}>
        {voidsError ? (
          <div className={styles.errorBanner}>{voidsError}</div>
        ) : !voidsLoading && projects.length === 0 ? (
          <div className={styles.emptyState}>
            <span className={styles.emptyIcon} aria-hidden="true">📂</span>
            <p className={styles.emptyTitle}>No projects found</p>
            <p className={styles.emptyDesc}>
              The database was opened successfully but contains no projects yet.
            </p>
          </div>
        ) : !voidsLoading && voids.length === 0 ? (
          <div className={styles.emptyState}>
            <span className={styles.emptyIcon} aria-hidden="true">🔲</span>
            <p className={styles.emptyTitle}>No voids in this project</p>
            <p className={styles.emptyDesc}>
              {selectedProject
                ? `"${selectedProject}" has no voids matching the current filter.`
                : 'This project has no voids yet, or all voids are closed (try enabling "Include closed voids").'}
            </p>
          </div>
        ) : (
          <VoidGrid
            rows={voids}
            loading={voidsLoading}
            includeClosed={includeClosed}
            onIncludeClosedChange={(v) => void handleIncludeClosedChange(v)}
            onVoidSelectionChange={handleVoidSelectionChange}
          />
        )}
      </div>
    </div>
  );
}
