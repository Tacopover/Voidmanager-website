/**
 * The viewer engine (world.ts) on its own, without a .db: proves the pinned That Open
 * packages, the Fragments worker and the web-ifc WASM in public/ work together in a real browser.
 *
 * Fixtures (gitignored, tests skip when absent):
 *   fixtures/E_AIH_68_INS-E_HOM_Elektrotechnisch.ifc  any IFC works; this one is IFC2x3 MEP
 *   fixtures/frag/elektro.3.4.5.frag                  made with @thatopen/fragments 3.4.5:
 *     node scripts/frag-tool.mjs convert <ifc> <frag> (with 3.4.5 installed)
 */
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const IFC_FIXTURE = path.resolve('fixtures/E_AIH_68_INS-E_HOM_Elektrotechnisch.ifc');
const OLD_FRAG_FIXTURE = path.resolve('fixtures/frag/elektro.3.4.5.frag');

/** Serve a local file to the page at /__fixture/<name>. */
async function serveFixture(page: Page, file: string): Promise<string> {
  const name = path.basename(file);
  await page.route(`**/__fixture/${name}`, (route) => route.fulfill({ body: fs.readFileSync(file) }));
  return `/__fixture/${name}`;
}

/** Create a viewer on the home page and load one file with it. Returns the element count. */
async function loadInViewer(page: Page, url: string, kind: 'ifc' | 'frag'): Promise<number> {
  await page.goto('./');
  return page.evaluate(
    async ({ url, kind, worldModule }) => {
      const container = document.createElement('div');
      container.style.cssText = 'position:fixed;inset:0;width:800px;height:600px';
      document.body.append(container);
      const world = await import(/* @vite-ignore */ worldModule);
      const controller = await world.createWorldController(container);
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
      const model = kind === 'ifc' ? await controller.loadIfc(bytes, 'model') : await controller.loadFragmentModel('model', bytes);
      return model.elementCount as number;
    },
    // Vite's dev server serves the TypeScript source as a module.
    { url, kind, worldModule: new URL('src/features/viewer/world.ts', page.url()).pathname },
  );
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

test.describe('Viewer engine (no .db)', () => {
  test('converts and shows an IFC in the browser', async ({ page }) => {
    test.skip(!fs.existsSync(IFC_FIXTURE), 'no IFC fixture');
    const errors = collectErrors(page);

    const count = await loadInViewer(page, await serveFixture(page, IFC_FIXTURE), 'ifc');

    expect(count).toBeGreaterThan(0);
    expect(errors, errors.join('\n')).toHaveLength(0);
  });

  test('loads a .frag made with Fragments 3.4.5', async ({ page }) => {
    test.skip(!fs.existsSync(OLD_FRAG_FIXTURE), 'no 3.4.5 .frag fixture');
    const errors = collectErrors(page);

    const count = await loadInViewer(page, await serveFixture(page, OLD_FRAG_FIXTURE), 'frag');

    expect(count).toBeGreaterThan(0);
    expect(errors, errors.join('\n')).toHaveLength(0);
  });
});
