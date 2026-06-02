import { Link } from 'react-router-dom';

export default function Home() {
  return (
    <section className="home">
      <h1>VoidManager</h1>
      <p className="home__lead">
        Place, review, and approve structural voids — now in the browser. VoidManager is a Revit
        add-in for managing penetrations and openings across building models.
      </p>
      <p>
        The web viewer lets reviewers and external parties without Revit open a project, inspect
        voids in 3D, and change their approval status — fully in the browser, no install required.
      </p>
      <Link className="btn btn--primary" to="/viewer">
        Open the 3D viewer →
      </Link>
    </section>
  );
}
