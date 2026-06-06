import { Link } from 'react-router-dom';
import styles from './Home.module.css';

// ---------------------------------------------------------------------------
// Feature cards
// ---------------------------------------------------------------------------

interface Feature {
  icon: string;
  title: string;
  desc: string;
}

const FEATURES: Feature[] = [
  {
    icon: '🧱',
    title: '3D IFC viewer',
    desc: 'Render full building models in the browser using open IFC standards — no plug-ins.',
  },
  {
    icon: '📋',
    title: 'Void datagrid',
    desc: 'Search, sort, and filter all penetrations by level, host, status, size, and more.',
  },
  {
    icon: '✅',
    title: 'Approval status',
    desc: 'See at a glance which voids are concept, open for review, approved, or released.',
  },
  {
    icon: '🔗',
    title: 'Grid ↔ 3D sync',
    desc: 'Select a row to highlight the matching void in the 3D view, and vice versa.',
  },
  {
    icon: '💾',
    title: 'Session caching',
    desc: 'Your DB and models are saved in IndexedDB — reopen the viewer without re-picking files.',
  },
  {
    icon: '🔒',
    title: '100% client-side',
    desc: 'Files never leave your machine. No server, no login, no upload.',
  },
];

// ---------------------------------------------------------------------------
// How-to steps
// ---------------------------------------------------------------------------

interface Step {
  title: string;
  detail: string;
}

const STEPS: Step[] = [
  {
    title: 'Open the viewer',
    detail: 'Click "Open the 3D viewer" above or in the navigation bar.',
  },
  {
    title: 'Connect your VoidManager data',
    detail:
      'On Chromium (Edge / Chrome): click "Connect VoidManager folder" and grant access to ' +
      'your %LOCALAPPDATA%\\VoidManager folder — the app finds the .db automatically. ' +
      'On other browsers: use "choose a .db file" to pick the file directly.',
  },
  {
    title: 'Load an IFC model (optional)',
    detail:
      'Pick a matching .ifc file to see voids rendered in 3D. ' +
      'The datagrid works without an IFC if you only need the table view.',
  },
  {
    title: 'Browse, filter, and inspect',
    detail:
      'Use the datagrid to search by status, host, or level. ' +
      'Click a row to highlight the void in the 3D view.',
  },
];

// ---------------------------------------------------------------------------
// Home component
// ---------------------------------------------------------------------------

export default function Home() {
  return (
    <div className={styles.page}>
      {/* ── Hero ────────────────────────────────────────────── */}
      <section className={styles.hero}>
        <span className={styles.heroEyebrow}>Revit add-in companion</span>
        <h1 className={styles.heroTitle}>VoidManager</h1>
        <p className={styles.heroTagline}>
          Review and approve structural voids in the browser — no Revit required.
        </p>
        <Link className={styles.heroCta} to="/viewer">
          Open the 3D viewer →
        </Link>
      </section>

      {/* ── What it is ──────────────────────────────────────── */}
      <section className={`${styles.section} ${styles.whatItIs}`}>
        <h2 className={styles.sectionTitle}>What is VoidManager?</h2>
        <p>
          VoidManager is a Revit add-in for placing, tracking, and approving structural voids —
          the penetrations and openings cut through walls, floors, and beams to route pipes,
          ducts, cables, and other services. In complex buildings these can number in the
          thousands, each requiring coordination between structural engineers, MEP consultants,
          and contractors.
        </p>
        <p>
          The add-in stores all voids, their geometry, host elements, and approval history in a
          local database file. This web viewer reads that file directly in the browser so
          reviewers and external parties who don&apos;t have Revit installed can still inspect
          the full void set: view them in 3D, check approval status, filter by level or sequence,
          and correlate rows in the datagrid with elements in the model.
        </p>
        <p>
          Everything runs client-side. Your database and IFC files are opened locally and never
          uploaded to any server. The viewer works offline once the page has loaded.
        </p>
      </section>

      {/* ── Features ────────────────────────────────────────── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Features</h2>
        <div className={styles.featuresGrid}>
          {FEATURES.map((f) => (
            <div key={f.title} className={styles.featureCard}>
              <span className={styles.featureIcon} aria-hidden="true">
                {f.icon}
              </span>
              <div className={styles.featureText}>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── How to use ──────────────────────────────────────── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>How to use</h2>
        <ol className={styles.stepList}>
          {STEPS.map((s, i) => (
            <li key={s.title} className={styles.step}>
              <span className={styles.stepNum} aria-hidden="true">
                {i + 1}
              </span>
              <span className={styles.stepBody}>
                <strong>{s.title}. </strong>
                {s.detail}
              </span>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Footer note ─────────────────────────────────────── */}
      <footer className={styles.footer}>
        <strong>Note:</strong> This is a read-only preview. Approval status write-back is coming
        in a future release and will require a Chromium-based browser (Chrome or Edge) for direct
        file access. The IFC viewer renders best in Chromium. Firefox and Safari display the
        datagrid but may show limited 3D support.
      </footer>
    </div>
  );
}
