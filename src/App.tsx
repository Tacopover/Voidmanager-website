import { lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate, useMatch } from 'react-router-dom';
import Home from './pages/Home';

// Code-split: the viewer pulls in the heavy 3D/IFC/grid/sql.js libs (~1.4 MB).
// Lazy-load it so the Home route stays light and loads fast.
const Viewer = lazy(() => import('./pages/Viewer'));

/**
 * Selects the right <main> class: full-bleed for both the marketing Home page
 * (which carries its own header/footer) and the viewer (its own slim bar).
 * The old global nav bar was removed — each route now owns its own chrome.
 */
function AppMain() {
  const isViewer = !!useMatch('/viewer');
  return (
    <main className={isViewer ? 'app-main--viewer' : 'app-main--home'}>
      <Suspense fallback={<div className="route-loading">Loading viewer…</div>}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/viewer" element={<Viewer />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </main>
  );
}

export default function App() {
  return (
    <HashRouter>
      <AppMain />
    </HashRouter>
  );
}
