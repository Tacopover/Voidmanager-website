import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import './Home.css';

import logoUrl from '../assets/home/logo.png';
import hero3dUrl from '../assets/home/hero-3d.png';
import shotTableUrl from '../assets/home/shot-table.png';

// ---------------------------------------------------------------------------
// Icons (stroked, 24×24) — inlined so the page has no icon-font dependency.
// ---------------------------------------------------------------------------
const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
} as const;

const IconClash = () => (
  <svg viewBox="0 0 24 24" {...stroke}>
    <circle cx="12" cy="12" r="7" />
    <path d="M12 1v4M12 19v4M1 12h4M19 12h4" />
  </svg>
);
const IconVoid = () => (
  <svg viewBox="0 0 24 24" {...stroke}>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const IconSync = () => (
  <svg viewBox="0 0 24 24" {...stroke}>
    <path d="M4 9a8 8 0 0 1 14-5l2 2M20 15a8 8 0 0 1-14 5l-2-2" />
    <path d="M18 2v4h-4M6 22v-4h4" />
  </svg>
);
const IconShield = () => (
  <svg viewBox="0 0 24 24" {...stroke}>
    <path d="M12 3l8 4v5c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V7z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);
const IconLayers = () => (
  <svg viewBox="0 0 24 24" {...stroke}>
    <path d="M12 2l9 5-9 5-9-5 9-5z" />
    <path d="M3 12l9 5 9-5M3 17l9 5 9-5" />
  </svg>
);
const IconWindow = () => (
  <svg viewBox="0 0 24 24" {...stroke}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18M9 21V9" />
  </svg>
);

// Window-bar brand mark — replaces the macOS "traffic-light" dots (Void Manager
// ships on Windows / Revit, so the Apple controls were misleading). It echoes
// the logo: a blue ring (structure) around a green core (the void).
const WinGlyph = () => (
  <svg className="win-glyph" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
    <circle cx="8" cy="8" r="6.4" fill="none" stroke="#4a8fd6" strokeWidth="1.6" />
    <circle cx="8" cy="8" r="2.5" fill="#54c46a" />
  </svg>
);

// ---------------------------------------------------------------------------
// "Anatomy of a coordinated void" — signature diagram.
// A structural host wall (hatched concrete, in elevation) with MEP penetrations
// cut through it. Each void is highlighted and dimensioned; green = mechanical,
// blue = services — the logo's two colours, standing in for the disciplines
// that have to be coordinated. Pure SVG so it scales crisply and themes itself.
// ---------------------------------------------------------------------------
const VoidAnatomy = () => (
  <svg
    className="anatomy__svg"
    viewBox="0 0 760 440"
    role="img"
    aria-label="Section of a structural wall with three coordinated void openings cut where MEP services penetrate it: a green mechanical duct void, a blue services void and a smaller mechanical void — each highlighted and dimensioned, marked approved."
  >
    <defs>
      <pattern id="vmHatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="10" height="10" fill="#eef2f6" />
        <line x1="0" y1="0" x2="0" y2="10" stroke="#c2cdd8" strokeWidth="1.3" />
      </pattern>
      <linearGradient id="vmDuct" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#5bc46a" />
        <stop offset="1" stopColor="#2c8038" />
      </linearGradient>
      <linearGradient id="vmPipe" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#5b9fe0" />
        <stop offset="1" stopColor="#275f9e" />
      </linearGradient>
    </defs>

    {/* structural host wall — hatched concrete in elevation */}
    <rect x="64" y="34" width="632" height="362" rx="4" fill="url(#vmHatch)" stroke="#9fb0c0" strokeWidth="1.5" />

    {/* slow scan line for a little life */}
    <g className="vm-scan">
      <line x1="380" y1="40" x2="380" y2="390" stroke="#38a34a" strokeWidth="2" opacity="0.14" />
    </g>

    {/* VOID 1 — mechanical duct penetration (green) */}
    <g>
      <rect x="150" y="104" width="176" height="128" rx="16" fill="#e7edf3" stroke="#b9c5d2" strokeWidth="1.5" />
      <rect x="176" y="130" width="124" height="76" rx="9" fill="url(#vmDuct)" />
      <rect x="190" y="144" width="96" height="48" rx="5" fill="none" stroke="#ffffff" strokeWidth="1.4" opacity="0.5" />
      <rect className="vm-ring" x="140" y="94" width="196" height="148" rx="20" fill="none" stroke="#38a34a" strokeWidth="2.2" strokeDasharray="7 6" />
    </g>

    {/* VOID 2 — round services penetration (blue) */}
    <g>
      <circle cx="540" cy="246" r="74" fill="#e7edf3" stroke="#b9c5d2" strokeWidth="1.5" />
      <circle cx="540" cy="246" r="46" fill="url(#vmPipe)" />
      <circle cx="540" cy="246" r="31" fill="none" stroke="#ffffff" strokeWidth="1.4" opacity="0.5" />
      <circle className="vm-ring" cx="540" cy="246" r="86" fill="none" stroke="#3278c8" strokeWidth="2.2" strokeDasharray="7 6" />
    </g>

    {/* VOID 3 — smaller mechanical, hints "every penetration" */}
    <g>
      <circle cx="300" cy="332" r="30" fill="#e7edf3" stroke="#b9c5d2" strokeWidth="1.5" />
      <circle cx="300" cy="332" r="14" fill="url(#vmDuct)" />
      <circle className="vm-ring" cx="300" cy="332" r="40" fill="none" stroke="#38a34a" strokeWidth="2" strokeDasharray="6 6" />
    </g>

    {/* annotations */}
    <g fontSize="12.5" letterSpacing="0.04em">
      <text x="146" y="82" fill="#2c8038">Ø300 · DUCT VOID</text>
      <line x1="612" y1="158" x2="588" y2="184" stroke="#9fb0c0" strokeWidth="1" />
      <text x="696" y="150" textAnchor="end" fill="#275f9e">Ø200 · SERVICES VOID</text>
      <text x="80" y="378" fill="#56657a">HOST · STRUCTURAL WALL</text>
      <text x="680" y="58" textAnchor="end" fill="#56657a">3 PENETRATIONS · 1 HOST</text>
    </g>

    {/* approved badge */}
    <g>
      <rect x="470" y="350" width="186" height="30" rx="15" fill="#ecf7ef" stroke="#38a34a" strokeWidth="1.2" />
      <circle cx="488" cy="365" r="6.5" fill="#38a34a" />
      <path d="M485 365 l2.2 2.3 l4-4.6" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <text x="503" y="369" fontSize="11.5" fill="#2c8038" letterSpacing="0.06em">STATUS · APPROVED</text>
    </g>

    {/* legend */}
    <g fontSize="11" fill="#56657a" letterSpacing="0.05em">
      <rect x="64" y="410" width="14" height="14" fill="url(#vmHatch)" stroke="#9fb0c0" strokeWidth="1" />
      <text x="86" y="421">STRUCTURE</text>
      <circle cx="214" cy="417" r="6" fill="#38a34a" />
      <text x="226" y="421">MECHANICAL</text>
      <circle cx="356" cy="417" r="6" fill="#3278c8" />
      <text x="368" y="421">SERVICES</text>
      <text x="476" y="421" fill="#2c8038">= COORDINATED</text>
    </g>
  </svg>
);

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------
interface Feature {
  icon: ReactNode;
  title: string;
  desc: string;
  accent?: boolean;
}

const FEATURES: Feature[] = [
  {
    icon: <IconClash />,
    title: 'Automated clash detection',
    desc: 'Clash structural and architectural models against MEP, with a tolerance you control. Every intersection found in one run.',
  },
  {
    icon: <IconVoid />,
    title: 'Precise void placement',
    desc: 'Generate correctly-sized void families at every penetration at once — no manual modeling of openings.',
    accent: true,
  },
  {
    icon: <IconSync />,
    title: 'Shared database sync',
    desc: 'Push and pull voids to a central database so every discipline works from one source of truth.',
  },
  {
    icon: <IconShield />,
    title: 'Review & approval',
    desc: 'Open voids for review, assign reviewers and track every opening from request to approval.',
  },
  {
    icon: <IconLayers />,
    title: 'Host & section management',
    desc: 'Manage host elements and advanced sequence numbering across levels and buildings.',
  },
  {
    icon: <IconWindow />,
    title: 'Plugin plus a 3D web viewer',
    desc: 'Use Void Manager as a Revit plugin, and review openings in the browser with the 3D web viewer — no Revit required.',
  },
];

interface Step {
  icon: ReactNode;
  num: string;
  title: string;
  desc: string;
  accent?: boolean;
}

const STEPS: Step[] = [
  {
    icon: <IconClash />,
    num: 'STEP 01 — DETECT',
    title: 'Select the models to clash',
    desc: 'Choose your host models and the MEP that runs through them. Void Manager clashes everything visible in your model, at your chosen tolerance.',
  },
  {
    icon: <IconVoid />,
    num: 'STEP 02 — PLACE',
    title: 'Voids appear at every clash',
    desc: 'Run detection and a correctly-sized void family is created at each penetration — instantly, across the whole model, ready to coordinate.',
    accent: true,
  },
  {
    icon: <IconShield />,
    num: 'STEP 03 — REVIEW',
    title: 'Review & approve — anywhere',
    desc: 'Each void is listed with level, thickness, host and status. Assign reviewers and approve in the plugin or in the 3D web viewer, no Revit needed.',
  },
];

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------
export default function Home() {
  const [atTop, setAtTop] = useState(true);
  const [sent, setSent] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Header: dark + transparent over the hero, solid light after scrolling.
  useEffect(() => {
    const onScroll = () => setAtTop(window.scrollY <= 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Reveal-on-scroll.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>('.reveal'));
    els.forEach((el, i) => {
      el.style.transitionDelay = `${Math.min(i, 3) * 60}ms`;
    });
    const io = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            obs.unobserve(e.target);
          }
        });
      },
      { threshold: 0.06, rootMargin: '0px 0px -4% 0px' },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  // Smooth-scroll to an in-page section. We can't use plain `#hash` anchors
  // because HashRouter would treat them as routes.
  const scrollToId = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 84;
    window.scrollTo({ top, behavior: 'smooth' });
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!e.currentTarget.checkValidity()) {
      e.currentTarget.reportValidity();
      return;
    }
    setSent(true);
  };

  const headerClass = `site-header${atTop ? ' on-dark b-top' : ''}`;

  return (
    <div className="vm-home js-reveal" ref={rootRef}>
      {/* ============ HEADER ============ */}
      <header className={headerClass}>
        <div className="container">
          <nav className="nav">
            <Link className="brand" to="/">
              <img src={logoUrl} alt="Void Manager logo" /> Void Manager
            </Link>
            <div className="nav-links">
              <a href="#features" onClick={scrollToId('features')}>Features</a>
              <a href="#how" onClick={scrollToId('how')}>How it works</a>
              <Link to="/viewer">Viewer</Link>
              <a href="#about" onClick={scrollToId('about')}>About</a>
              <a href="#quote" onClick={scrollToId('quote')}>Request a quote</a>
            </div>
            <div className="nav-actions">
              <a className="link" href="#quote" onClick={scrollToId('quote')}>Log in</a>
              <a className="btn btn-grad btn-sm" href="#quote" onClick={scrollToId('quote')}>Sign up</a>
            </div>
          </nav>
        </div>
      </header>

      {/* ============ HERO ============ */}
      <section className="heroB" data-screen-label="Hero">
        <div className="heroB__inner">
          <span className="eyebrow eyebrow--plain on-ink">Void coordination platform</span>
          <h1 className="h1">
            Find every clash.<br />Place every <span className="accent">void</span>.<br />Track every approval.
          </h1>
          <p className="lede">
            Void Manager turns coordination conflicts between structure and MEP into accurate, documented
            openings — detected, placed, reviewed and approved across your whole team.
          </p>
          <div className="heroB__cta">
            <a href="#quote" onClick={scrollToId('quote')} className="btn btn-grad btn-lg">
              Request a quote <span className="arrow">→</span>
            </a>
            <a href="#how" onClick={scrollToId('how')} className="btn btn-ghost-light btn-lg">
              See how it works
            </a>
          </div>
          <div className="heroB__avail">
            <span className="avail-pill"><span className="led" /> Available as a Revit plugin</span>
            <Link className="avail-pill" to="/viewer">
              <span className="led" style={{ background: 'var(--blue)' }} /> 3D web viewer — open it →
            </Link>
          </div>
        </div>

        <div className="heroB__shot">
          <div className="window">
            <div className="window__bar">
              <WinGlyph />
              <span className="title">3D view — voids placed at every penetration</span>
              <span className="win-tag">Revit · 3D</span>
            </div>
            <img src={hero3dUrl} alt="Revit 3D view: MEP services penetrating structure with void openings placed at each clash" />
          </div>
          <div className="heroB__stat">
            <span className="ring" />
            <div>
              <div className="big">73</div>
              <div className="lbl">voids placed</div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ ANATOMY ============ */}
      <section className="section anatomy blueprint" id="anatomy" data-screen-label="Anatomy">
        <div className="container anatomy__grid">
          <div className="reveal">
            <span className="eyebrow">The whole idea, in one drawing</span>
            <h2 className="h2" style={{ marginTop: 16 }}>Anatomy of a coordinated void.</h2>
            <p className="lede" style={{ marginTop: 18 }}>
              Wherever MEP services cross structure, Void Manager cuts a correctly-sized opening — dimensioned,
              hosted and tracked — so every discipline builds from the same set of penetrations.
            </p>
            <ul className="anatomy__points">
              <li>
                <span className="k b"><IconClash /></span>
                <div><h4>Penetrations</h4><p>Every clash between MEP and structure, found automatically across the whole model.</p></div>
              </li>
              <li>
                <span className="k g"><IconVoid /></span>
                <div><h4>Voids</h4><p>A correctly-sized opening at each penetration — round or rectangular, exactly to size.</p></div>
              </li>
              <li>
                <span className="k b"><IconLayers /></span>
                <div><h4>Coordination</h4><p>Structure, architecture and MEP working from one trusted, approved set of openings.</p></div>
              </li>
            </ul>
          </div>
          <div className="anatomy__panel reveal">
            <div className="anatomy__cap"><span className="sw" /> Section · host wall × MEP penetrations</div>
            <VoidAnatomy />
          </div>
        </div>
      </section>

      {/* ============ FEATURES ============ */}
      <section className="section" id="features" data-screen-label="Features">
        <div className="container featB">
          <div className="featB__head reveal">
            <span className="eyebrow">What it does</span>
            <h2 className="h2" style={{ marginTop: 16 }}>One workflow, from clash to coordinated opening.</h2>
            <p className="lede" style={{ marginTop: 18 }}>
              Void Manager replaces hours of manual penetration modeling and spreadsheet tracking with a
              single, repeatable process built on the models you already have.
            </p>
            <a href="#quote" onClick={scrollToId('quote')} className="btn btn-primary" style={{ marginTop: 26 }}>
              Request a quote <span className="arrow">→</span>
            </a>
          </div>
          <div className="featB__list">
            {FEATURES.map((f) => (
              <div key={f.title} className={`feature-card reveal${f.accent ? ' accent' : ''}`}>
                <div className="feature-ico">{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ HOW IT WORKS ============ */}
      <section className="section bg-paper-2" id="how" data-screen-label="How it works">
        <div className="container">
          <div className="section-head reveal" style={{ marginInline: 'auto', textAlign: 'center' }}>
            <span className="eyebrow eyebrow--plain">How it works</span>
            <h2 className="h2" style={{ marginTop: 14 }}>Clash. Place. Review.</h2>
            <p className="lede" style={{ marginTop: 16 }}>
              A three-step loop that turns coordination conflicts into documented, approved openings.
            </p>
          </div>

          <div className="stepper reveal">
            <div className="stepper__line" />
            {STEPS.map((s) => (
              <div key={s.num} className={`step${s.accent ? ' step--accent' : ''}`}>
                <div className="step__node">{s.icon}</div>
                <div className="step__num">{s.num}</div>
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
              </div>
            ))}
          </div>

          <div className="stepper__media reveal">
            <div className="window">
              <div className="window__bar">
                <WinGlyph />
                <span className="title">Void Manager — overview &amp; review</span>
                <span className="win-tag">Web viewer</span>
              </div>
              <img src={shotTableUrl} alt="Void Manager overview table listing voids with level, status, thickness and host element" />
            </div>
          </div>
        </div>
      </section>

      {/* ============ ABOUT ============ */}
      <section className="section aboutB" id="about" data-screen-label="About">
        <div className="container aboutB__grid">
          <div className="reveal">
            <span className="eyebrow eyebrow--plain on-ink">Who we are</span>
            <h2 className="h2" style={{ marginTop: 16 }}>Built by people who coordinate buildings for a living.</h2>
            <p className="lede" style={{ marginTop: 18 }}>
              Void Manager comes from a small team of BIM specialists and structural engineers who spent too
              many years placing penetrations by hand and reconciling them in spreadsheets. We build the tool
              we always wanted: precise, fast and built to fit how your team already works.
            </p>
            <p className="lede" style={{ marginTop: 16 }}>
              <strong style={{ color: '#fff', fontWeight: 600 }}>Our mission:</strong> make void coordination
              the easiest part of a project — not the bottleneck. Every opening detected, sized and approved
              with confidence, so structural, architectural and MEP teams build from one trusted set of
              penetrations.
            </p>
            <div className="aboutB__chips">
              <span className="chip dark"><span className="led" /> BIM coordination</span>
              <span className="chip dark"><span className="led" style={{ background: 'var(--blue)' }} /> Structural &amp; MEP</span>
              <span className="chip dark"><span className="led" style={{ background: 'var(--green-400)' }} /> Plugin &amp; web</span>
            </div>
          </div>
          <div className="aboutB__stats reveal">
            <div className="aboutB__stat"><div className="n">2</div><div className="t">ways to work — plugin &amp; web</div></div>
            <div className="aboutB__stat"><div className="n">1</div><div className="t">source of truth for every void</div></div>
            <div className="aboutB__stat"><div className="n">100<span>%</span></div><div className="t">clash-driven placement</div></div>
            <div className="aboutB__stat"><div className="n">2-way</div><div className="t">model ↔ database sync</div></div>
          </div>
        </div>
      </section>

      {/* ============ REQUEST A QUOTE ============ */}
      <section className="section blueprint" id="quote" data-screen-label="Request a quote">
        <div className="container quote">
          <div className="quote__aside reveal">
            <span className="eyebrow">Request a quote</span>
            <h2 className="h2" style={{ marginTop: 16 }}>Let&rsquo;s size Void Manager to your team.</h2>
            <p className="lede" style={{ marginTop: 18 }}>
              Tell us about your projects and how your team works. We&rsquo;ll get back to you with licensing
              options and a tailored quote.
            </p>
            <ul>
              <li>
                <span className="ic">
                  <svg viewBox="0 0 24 24" {...stroke} width="18" height="18"><path d="M22 6l-10 7L2 6" /><rect x="2" y="5" width="20" height="14" rx="2" /></svg>
                </span>
                <div><h4>Direct from the team</h4><p>You&rsquo;ll talk to the people who build Void Manager — no call-centre runaround.</p></div>
              </li>
              <li>
                <span className="ic">
                  <svg viewBox="0 0 24 24" {...stroke} width="18" height="18"><path d="M12 2v20M2 12h20" /></svg>
                </span>
                <div><h4>Flexible licensing</h4><p>Per-seat or team licensing for the plugin and the 3D web viewer, with a trial to evaluate.</p></div>
              </li>
              <li>
                <span className="ic">
                  <svg viewBox="0 0 24 24" {...stroke} width="18" height="18"><path d="M12 8v4l3 2" /><circle cx="12" cy="12" r="9" /></svg>
                </span>
                <div><h4>Fast response</h4><p>We typically reply within one business day with next steps.</p></div>
              </li>
            </ul>
          </div>

          <div className="quote__form reveal">
            {!sent ? (
              <form onSubmit={onSubmit} noValidate>
                <div className="form-grid">
                  <div className="field"><label htmlFor="name">Full name</label><input id="name" name="name" type="text" placeholder="Jane Engineer" required /></div>
                  <div className="field"><label htmlFor="company">Company</label><input id="company" name="company" type="text" placeholder="Firm or contractor" required /></div>
                  <div className="field"><label htmlFor="email">Work email</label><input id="email" name="email" type="email" placeholder="jane@firm.com" required /></div>
                  <div className="field"><label htmlFor="role">Your role</label>
                    <select id="role" name="role" defaultValue="BIM coordinator">
                      <option>BIM coordinator</option>
                      <option>MEP contractor</option>
                      <option>Structural engineer</option>
                      <option>Architect</option>
                      <option>Other</option>
                    </select>
                  </div>
                  <div className="field"><label htmlFor="seats">Team size (seats)</label>
                    <select id="seats" name="seats" defaultValue="1–5"><option>1–5</option><option>6–15</option><option>16–50</option><option>50+</option></select>
                  </div>
                  <div className="field"><label htmlFor="version">How you&rsquo;ll use it</label>
                    <select id="version" name="version" defaultValue="Revit plugin"><option>Revit plugin</option><option>Web viewer</option><option>Both</option></select>
                  </div>
                  <div className="field full"><label htmlFor="msg">What are you coordinating?</label><textarea id="msg" name="msg" placeholder="A few words about your projects and timeline…" /></div>
                </div>
                <button type="submit" className="btn btn-primary btn-lg" style={{ marginTop: 22, width: '100%' }}>
                  Request a quote <span className="arrow">→</span>
                </button>
                <p className="form-note">By submitting you agree to be contacted about Void Manager. This is a demo form — no data is sent.</p>
              </form>
            ) : (
              <div className="sent">
                <div className="ok">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} width="26" height="26"><path d="M5 12l4 4L19 6" /></svg>
                </div>
                <h3 className="h3">Thanks — request received.</h3>
                <p style={{ color: 'var(--ink-2)', marginTop: 8 }}>We&rsquo;ll be in touch within one business day with a tailored quote.</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer className="site-footer" data-screen-label="Footer">
        <div className="container">
          <div className="footer-grid">
            <div>
              <Link className="brand" to="/"><img src={logoUrl} alt="" style={{ width: 30 }} /> Void Manager</Link>
              <p className="footer-blurb">
                Automated, clash-driven void coordination — detect, place, review and approve every opening.
                Available as a Revit plugin, with a 3D web viewer in the browser.
              </p>
              <div className="versions" style={{ marginTop: 20 }}>
                <span className="ver-badge" style={{ background: 'transparent', color: 'rgba(255,255,255,.7)', borderColor: 'rgba(255,255,255,.2)' }}>Revit plugin</span>
                <span className="ver-badge" style={{ background: 'transparent', color: 'rgba(255,255,255,.7)', borderColor: 'rgba(255,255,255,.2)' }}>3D web viewer</span>
              </div>
            </div>
            <div className="footer-col">
              <h4>Product</h4>
              <a href="#features" onClick={scrollToId('features')}>Features</a>
              <a href="#how" onClick={scrollToId('how')}>How it works</a>
              <Link to="/viewer">3D Viewer</Link>
              <a href="#quote" onClick={scrollToId('quote')}>Request a quote</a>
              <a href="#" onClick={(e) => e.preventDefault()}>Pricing <span className="soon">Soon</span></a>
            </div>
            <div className="footer-col">
              <h4>Company</h4>
              <a href="#about" onClick={scrollToId('about')}>About</a>
              <a href="#quote" onClick={scrollToId('quote')}>Contact</a>
              <a href="#" onClick={(e) => e.preventDefault()}>Careers <span className="soon">Soon</span></a>
            </div>
            <div className="footer-col">
              <h4>Account</h4>
              <a href="#quote" onClick={scrollToId('quote')}>Log in</a>
              <a href="#quote" onClick={scrollToId('quote')}>Sign up</a>
              <a href="#" onClick={(e) => e.preventDefault()}>Projects <span className="soon">Soon</span></a>
            </div>
          </div>
          <div className="footer-bottom">
            <span>© 2026 Void Manager. All rights reserved.</span>
            <span style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.04em' }}>Works with Autodesk Revit® · not affiliated with Autodesk</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
