/**
 * Viewer page — /viewer route.
 *
 * Layout: 3D view placeholder on top, void datagrid below (stacked).
 * Read-only v1: DB loading, project selector, read-only void grid.
 * Write-back (status editing, close/reopen) deferred to M2+.
 */

import { useCallback, useState } from 'react';
import DbLoader from '../features/viewer/DbLoader';
import ThreeDViewer from '../features/viewer/ThreeDViewer';
import VoidGrid from '../features/voids/VoidGrid';
import { createLocalRepository } from '../data/sqlEngine';
import type { VoidRepository, VoidRow, ProjectSummary } from '../data/VoidRepository';
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

  // Include-closed toggle (lifted here so it can trigger a reload)
  const [includeClosed, setIncludeClosed] = useState(false);

  // Badge: FS Access vs fallback
  const [canWriteBack, setCanWriteBack] = useState(false);

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
  const handleDbLoaded = useCallback(async (bytes: Uint8Array, wb: boolean) => {
    setPhase({ tag: 'loading' });
    setCanWriteBack(wb);
    try {
      const repo = await createLocalRepository(bytes);
      const projs = await repo.listProjects();
      setProjects(projs);
      // Default to "all projects" (null) so the grid is never empty on first load.
      setSelectedProject(null);
      setPhase({ tag: 'ready', repo, canWriteBack: wb });
      await loadVoids(repo, null, false);
    } catch (e) {
      // Fall back to needsDb with an error — surface it via alert for now.
      // TODO: nicer inline error display
      console.error('[Viewer] DB load failed', e);
      alert(`Failed to open database: ${e instanceof Error ? e.message : String(e)}`);
      setPhase({ tag: 'needsDb' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  // Selection change (grid → 3D, future M2 hook)
  // -------------------------------------------------------------------------
  function handleVoidSelectionChange(rows: VoidRow[]) {
    // TODO (M2): pass selected row IDs to the 3D viewer for highlight + fit-to-element
    console.debug('[Viewer] void selection changed', rows.length, 'rows');
  }

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  if (phase.tag === 'needsDb') {
    return (
      <div className={styles.viewerShell}>
        <h1 className={styles.srOnly}>Viewer</h1>
        <DbLoader onLoaded={handleDbLoaded} />
      </div>
    );
  }

  if (phase.tag === 'loading') {
    return (
      <div className={styles.viewerShell}>
        <h1 className={styles.srOnly}>Viewer</h1>
        <div className={styles.loadingOverlay}>
          <p>Opening database…</p>
        </div>
      </div>
    );
  }

  // phase.tag === 'ready'
  return (
    <div className={styles.viewerShell}>
      {/* Visually-hidden page heading for accessibility and test selectors */}
      <h1 className={styles.srOnly}>Viewer</h1>

      {/* Top bar: project selector + write-back badge */}
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
      </div>

      {/* 3D viewer — M2 Stage A */}
      <div className={styles.threeDPane}>
        <ThreeDViewer />
      </div>

      {/* Void grid */}
      <div className={styles.gridPane}>
        {voidsError ? (
          <div className={styles.errorBanner}>{voidsError}</div>
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
