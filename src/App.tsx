import { HashRouter, Routes, Route, Navigate, NavLink } from 'react-router-dom';
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

export default function App() {
  return (
    <HashRouter>
      <NavBar />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/viewer" element={<Viewer />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </HashRouter>
  );
}
