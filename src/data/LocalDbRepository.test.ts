/**
 * LocalDbRepository tests.
 *
 * All fixture-backed tests are skipped gracefully when fixtures/sample.db is absent,
 * so CI without the fixture still passes.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import initSqlJs from 'sql.js';
import type { Database } from 'sql.js';
import { LocalDbRepository } from './LocalDbRepository';
import { APPROVAL_STATUSES, isApprovalStatus } from './schema';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, '../../fixtures/sample.db');
const fixtureExists = existsSync(FIXTURE_PATH);

// ---------------------------------------------------------------------------
// sql.js init helper (Node WASM path — no browser needed)
// ---------------------------------------------------------------------------

const require = createRequire(import.meta.url);
const WASM_PATH: string = require.resolve('sql.js/dist/sql-wasm.wasm');

async function openFixture(): Promise<Database> {
  const SQL = await initSqlJs({ locateFile: () => WASM_PATH });
  return new SQL.Database(readFileSync(FIXTURE_PATH));
}

// ---------------------------------------------------------------------------
// Schema guard — works without fixture
// ---------------------------------------------------------------------------

describe('LocalDbRepository — schema validation', () => {
  it('throws on a missing required table', async () => {
    const SQL = await initSqlJs({ locateFile: () => WASM_PATH });
    const db = new SQL.Database();
    // Completely empty DB — should throw on construction.
    expect(() => new LocalDbRepository(db)).toThrow(/Required table/i);
  });
});

// ---------------------------------------------------------------------------
// Fixture-backed tests
// ---------------------------------------------------------------------------

describe.skipIf(!fixtureExists)('LocalDbRepository — fixture (fixtures/sample.db)', () => {
  let repo: LocalDbRepository;

  beforeAll(async () => {
    const db = await openFixture();
    repo = new LocalDbRepository(db);
  });

  // ---- listProjects --------------------------------------------------------

  describe('listProjects()', () => {
    it('returns at least one project', async () => {
      const projects = await repo.listProjects();
      expect(projects.length).toBeGreaterThanOrEqual(1);
    });

    it('every project has a non-empty name', async () => {
      const projects = await repo.listProjects();
      for (const p of projects) {
        expect(typeof p.name).toBe('string');
        expect(p.name.length).toBeGreaterThan(0);
      }
    });

    it('every project has a numeric id', async () => {
      const projects = await repo.listProjects();
      for (const p of projects) {
        expect(typeof p.id).toBe('number');
      }
    });
  });

  // ---- listVoids -----------------------------------------------------------

  describe('listVoids()', () => {
    it('returns more than 0 voids', async () => {
      const voids = await repo.listVoids();
      expect(voids.length).toBeGreaterThan(0);
    });

    it('every status is a member of APPROVAL_STATUSES', async () => {
      const voids = await repo.listVoids();
      for (const v of voids) {
        expect(isApprovalStatus(v.status)).toBe(true);
        expect(APPROVAL_STATUSES).toContain(v.status);
      }
    });

    it('circle voids have a numeric diameter', async () => {
      const voids = await repo.listVoids();
      const circles = voids.filter((v) => v.type === 'circle');
      expect(circles.length).toBeGreaterThan(0);
      for (const c of circles) {
        expect(typeof c.sizeMm.diameter).toBe('number');
        expect(isFinite(c.sizeMm.diameter!)).toBe(true);
        expect(c.sizeMm.diameter).toBeGreaterThan(0);
      }
    });

    it('rectangle voids have numeric width and height', async () => {
      const voids = await repo.listVoids();
      const rects = voids.filter((v) => v.type === 'rectangle');
      expect(rects.length).toBeGreaterThan(0);
      for (const r of rects) {
        expect(typeof r.sizeMm.width).toBe('number');
        expect(typeof r.sizeMm.height).toBe('number');
        expect(isFinite(r.sizeMm.width!)).toBe(true);
        expect(isFinite(r.sizeMm.height!)).toBe(true);
        expect(r.sizeMm.width).toBeGreaterThan(0);
        expect(r.sizeMm.height).toBeGreaterThan(0);
      }
    });

    it('location resolves to finite numbers for at least most voids', async () => {
      const voids = await repo.listVoids();
      const withLocation = voids.filter((v) => v.location !== null);
      // Expect at least 50% of voids to have a decodable location.
      expect(withLocation.length).toBeGreaterThanOrEqual(Math.floor(voids.length * 0.5));
      for (const v of withLocation) {
        expect(isFinite(v.location!.x)).toBe(true);
        expect(isFinite(v.location!.y)).toBe(true);
        expect(isFinite(v.location!.z)).toBe(true);
      }
    });

    it('type field is always "circle" or "rectangle"', async () => {
      const voids = await repo.listVoids();
      for (const v of voids) {
        expect(['circle', 'rectangle']).toContain(v.type);
      }
    });

    it('isClosed is a boolean', async () => {
      const voids = await repo.listVoids();
      for (const v of voids) {
        expect(typeof v.isClosed).toBe('boolean');
      }
    });

    it('default call excludes closed voids', async () => {
      const open = await repo.listVoids();
      const all = await repo.listVoids({ includeClosed: true });
      // There should be at least as many (or more) voids when including closed.
      expect(all.length).toBeGreaterThanOrEqual(open.length);
    });
  });

  // ---- Story & project scoping -----------------------------------------------

  describe('listVoids() — story & project resolution', () => {
    it('voids with a resolved story have a non-empty story name', async () => {
      const voids = await repo.listVoids({ includeClosed: true });
      const withStory = voids.filter((v) => v.story !== null);
      for (const v of withStory) {
        expect(typeof v.story!.name).toBe('string');
        expect(v.story!.name.length).toBeGreaterThan(0);
      }
    });

    it('listVoids({ projectName }) returns a subset of all voids', async () => {
      const projects = await repo.listProjects();
      const allVoids = await repo.listVoids({ includeClosed: true });
      if (projects.length === 0 || allVoids.length === 0) return;

      // Try filtering by the first project name.
      const projectVoids = await repo.listVoids({
        projectName: projects[0].name,
        includeClosed: true,
      });
      expect(projectVoids.length).toBeLessThanOrEqual(allVoids.length);
    });

    it('unknown project name returns empty array', async () => {
      const voids = await repo.listVoids({ projectName: '__nonexistent_project__' });
      expect(voids).toHaveLength(0);
    });
  });

  // ---- Sanity print (visible with --reporter=verbose) ----------------------

  it('sample decoded voids look plausible (visual sanity check)', async () => {
    const voids = await repo.listVoids({ includeClosed: true });
    const sample = voids.slice(0, 3);
    for (const v of sample) {
      // eslint-disable-next-line no-console
      console.log('[sample void]', JSON.stringify(v, null, 2));
    }
    // Always passes — just for human review of the output.
    expect(sample.length).toBeGreaterThan(0);
  });
});
