import { HashRouter, Routes, Route, Navigate, NavLink, useMatch } from 'react-router-dom';
import Home from './pages/Home';
import Viewer from './pages/Viewer';

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
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/viewer" element={<Viewer />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
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
