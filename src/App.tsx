import { lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate, NavLink, useMatch } from 'react-router-dom';
import Home from './pages/Home';

// Code-split: the viewer pulls in the heavy 3D/IFC/grid/sql.js libs (~1.4 MB).
// Lazy-load it so the Home route stays light and loads fast.
const Viewer = lazy(() => import('./pages/Viewer'));

function NavBar() {
  return (
    <header className="app-nav">
      <span className="app-nav__brand">VoidManager</span>
      <nav>
        <NavLink to="/" end>
          Home
        </NavLink>
        <NavLink to="/viewer">Viewer</NavLink>
      </nav>
    </header>
  );
}

/** Selects the right <main> class: full-bleed for viewer, centred for other pages. */
function AppMain() {
  const isViewer = !!useMatch('/viewer');
  return (
    <main className={isViewer ? 'app-main--viewer' : 'app-main'}>
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
      <NavBar />
      <AppMain />
    </HashRouter>
  );
}
