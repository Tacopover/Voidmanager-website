/**
 * DbLoader — handles the DB loading UX for the viewer page.
 *
 * Load order:
 *  1. On mount, call tryReopenSaved(). If it resolves, load silently.
 *  2. Otherwise show "Connect VoidManager folder" CTA.
 *     - hasFileSystemAccessApi() → pickDirectoryAndLocate()
 *     - else → pickFileFallback()
 *  3. Also render a visible <input type="file"> as secondary path.
 *     Testability: Playwright drives this input (data-testid="db-file-input")
 *     because showDirectoryPicker() cannot be automated.
 *
 * On any successful load, calls onLoaded(bytes, canWriteBack).
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  pickFileFallback,
  tryReopenSaved,
} from '../../data/dbLocator';
import BrandMark from '../../components/BrandMark';
import styles from './DbLoader.module.css';

type LoadPhase = 'idle' | 'checking' | 'loading' | 'error';

interface DbLoaderProps {
  onLoaded: (bytes: Uint8Array, canWriteBack: boolean) => void;
}

export default function DbLoader({ onLoaded }: DbLoaderProps) {
  const [phase, setPhase] = useState<LoadPhase>('checking');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // -------------------------------------------------------------------------
  // On mount: attempt silent reopen
  // -------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function tryReopen() {
      try {
        const result = await tryReopenSaved();
        if (cancelled) return;
        if (result) {
          onLoaded(result.bytes, result.canWriteBack);
        } else {
          setPhase('idle');
        }
      } catch {
        if (!cancelled) setPhase('idle');
      }
    }

    void tryReopen();
    return () => {
      cancelled = true;
    };
    // onLoaded is stable (defined at page level) — no need to re-run on change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------------
  // Connect button handler
  // -------------------------------------------------------------------------
  async function handleConnect() {
    setPhase('loading');
    setError(null);
    try {
      const result = await pickFileFallback();
      onLoaded(result.bytes, result.canWriteBack);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Picker cancelled → silently go back to idle.
      if (msg.toLowerCase().includes('cancel') || msg.toLowerCase().includes('abort')) {
        setPhase('idle');
      } else {
        setError(msg);
        setPhase('error');
      }
    }
  }

  // -------------------------------------------------------------------------
  // File input change (Playwright testability path)
  // -------------------------------------------------------------------------
  async function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhase('loading');
    setError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      onLoaded(bytes, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  if (phase === 'checking') {
    return (
      <div className={`${styles.loader} ${styles.blueprint}`}>
        <p className={styles.hint}>
          <span className={styles.spinner} aria-hidden="true" />
          Checking for saved database…
        </p>
      </div>
    );
  }

  return (
    <div className={`${styles.loader} ${styles.blueprint}`}>
      <div className={styles.card}>
        {/* Concentric-void-ring watermark (decorative) */}
        <svg className={styles.ringMark} viewBox="0 0 200 200" aria-hidden="true">
          <circle cx="100" cy="100" r="78" className={styles.ringDash} />
          <circle cx="100" cy="100" r="54" className={styles.ringDashSlow} />
          <circle cx="100" cy="100" r="30" className={styles.ringSolid} />
        </svg>

        <div className={styles.cardBody}>
          {/* Brand glyph in a rounded badge — echoes the logo void ring */}
          <span className={styles.glyphBadge}>
            <BrandMark size={26} />
          </span>

          <span className={styles.eyebrow}>VoidManager · Data connection</span>
          <h2 className={styles.title}>Connect your void database</h2>

          <p className={styles.desc}>
            Open your VoidManager <code className={styles.path}>.db</code> file directly. You
            can find it in <code className={styles.path}>%LOCALAPPDATA%\VoidManager</code>. No
            file is uploaded — everything stays local in your browser.
          </p>

          {/* Primary action */}
          <button
            type="button"
            className={styles.connectBtn}
            onClick={handleConnect}
            disabled={phase === 'loading'}
          >
            {phase === 'loading' ? 'Opening…' : 'Connect .db file'}
            <span className={styles.btnArrow} aria-hidden="true">→</span>
          </button>

          {/* Hidden file input — Playwright drives this via setInputFiles (data-testid) */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".db"
            data-testid="db-file-input"
            aria-label="Select VoidManager .db file"
            title="Select VoidManager .db file"
            className={styles.hiddenInput}
            onChange={handleFileInput}
          />

          {error && <p className={styles.errorMsg}>{error}</p>}
        </div>
      </div>
    </div>
  );
}
