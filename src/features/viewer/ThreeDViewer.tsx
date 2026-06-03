/**
 * ThreeDViewer — React component wrapping the OBC 3D world.
 *
 * Responsibilities:
 * - Mount/unmount the Three.js canvas cleanly (no duplicate canvases on hot-reload).
 * - Expose a "Load IFC" button and a hidden (but reachable) file input
 *   for Playwright E2E testing.
 * - Show load progress + error states.
 * - Report element count via data-testid="ifc-status" for E2E assertions.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { createWorldController, type WorldController, type LoadedModel } from './world';
import styles from './ThreeDViewer.module.css';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ViewerStatus =
  | { tag: 'idle' }
  | { tag: 'initializing' }
  | { tag: 'ready' }
  | { tag: 'loading'; percent: number }
  | { tag: 'loaded'; model: LoadedModel }
  | { tag: 'error'; message: string };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ThreeDViewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<WorldController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<ViewerStatus>({ tag: 'idle' });
  const initPromiseRef = useRef<Promise<void> | null>(null);

  // -------------------------------------------------------------------------
  // Initialize OBC world on mount, dispose on unmount
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return;

    // Guard against double-initialization in React 18 strict mode / hot-reload
    if (initPromiseRef.current) return;

    const container = containerRef.current;
    setStatus({ tag: 'initializing' });

    initPromiseRef.current = (async () => {
      try {
        const ctrl = await createWorldController(container);
        controllerRef.current = ctrl;
        setStatus({ tag: 'ready' });
      } catch (e) {
        console.error('[ThreeDViewer] init failed', e);
        setStatus({ tag: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    })();

    return () => {
      // Dispose GPU resources on unmount
      if (controllerRef.current) {
        controllerRef.current.dispose();
        controllerRef.current = null;
      }
      initPromiseRef.current = null;
    };
    // Run only once on mount — container ref is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------------
  // Load IFC handler (shared by button and file input)
  // -------------------------------------------------------------------------
  const handleFileBytes = useCallback(async (bytes: Uint8Array, name: string) => {
    const ctrl = controllerRef.current;
    if (!ctrl) return;

    setStatus({ tag: 'loading', percent: 0 });
    try {
      const model = await ctrl.loadIfc(bytes, name, ({ percent }) => {
        setStatus({ tag: 'loading', percent });
      });
      setStatus({ tag: 'loaded', model });
    } catch (e) {
      console.error('[ThreeDViewer] IFC load failed', e);
      setStatus({ tag: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  // -------------------------------------------------------------------------
  // File input change handler
  // -------------------------------------------------------------------------
  async function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    await handleFileBytes(bytes, file.name.replace(/\.ifc$/i, ''));
    // Reset input so the same file can be re-loaded
    e.target.value = '';
  }

  // -------------------------------------------------------------------------
  // "Load IFC" button handler — triggers the hidden file input
  // -------------------------------------------------------------------------
  function handleLoadButtonClick() {
    fileInputRef.current?.click();
  }

  // -------------------------------------------------------------------------
  // Status text for data-testid="ifc-status"
  // -------------------------------------------------------------------------
  function statusText(): string {
    switch (status.tag) {
      case 'idle':
        return 'Viewer idle';
      case 'initializing':
        return 'Initializing 3D viewer…';
      case 'ready':
        return 'Ready — load an IFC file';
      case 'loading':
        return `Loading IFC… ${status.percent.toFixed(0)}%`;
      case 'loaded':
        return `Loaded ${status.model.elementCount} elements`;
      case 'error':
        return `Error: ${status.message}`;
    }
  }

  const isLoading = status.tag === 'loading' || status.tag === 'initializing';
  const canLoad = status.tag === 'ready' || status.tag === 'loaded' || status.tag === 'error';

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className={styles.viewerWrapper}>
      {/* Three.js will append a <canvas> here */}
      <div ref={containerRef} className={styles.canvas} />

      {/* Overlay toolbar */}
      <div className={styles.toolbar}>
        {/* Load IFC button */}
        <button
          className={styles.loadBtn}
          onClick={handleLoadButtonClick}
          disabled={isLoading || !canLoad}
          title="Load a local .ifc file into the 3D viewer"
        >
          {status.tag === 'loading' ? `Loading… ${status.percent.toFixed(0)}%` : 'Load IFC'}
        </button>

        {/* Visible, reachable file input for Playwright E2E + non-button access */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".ifc"
          data-testid="ifc-file-input"
          className={styles.fileInput}
          onChange={(e) => void handleFileInputChange(e)}
          aria-label="Select IFC file"
        />

        {/* Status indicator */}
        <span
          className={`${styles.statusBadge} ${status.tag === 'error' ? styles.statusError : ''}`}
          data-testid="ifc-status"
        >
          {statusText()}
        </span>
      </div>

      {/* Error overlay (in addition to status badge) */}
      {status.tag === 'error' && (
        <div className={styles.errorOverlay}>
          <span>{status.message}</span>
        </div>
      )}
    </div>
  );
}
