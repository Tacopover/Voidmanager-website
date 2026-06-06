/* TEMP debug harness — not a real test. Gathers runtime evidence for issues 2/3/4. */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const DB = path.resolve('fixtures/sample.db');
const IFC = path.resolve('fixtures/E_AIH_68_INS-KLI_HOM_Klimaat.ifc');

async function dbg(page: Page, tag: string) {
  const info = await page.evaluate(() => (window as unknown as { __debug?: () => unknown }).__debug?.());
  const badge = await page.getByTestId('void-mesh-status').textContent().catch(() => '?');
  console.log(`\n=== ${tag} ===\nbadge: ${badge}\ndebug: ${JSON.stringify(info)}`);
}

test('DEBUG runtime evidence', async ({ page }) => {
  test.skip(!fs.existsSync(DB), 'no db fixture');
  test.setTimeout(180_000);
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('[world]') || t.includes('[ThreeDViewer]') || m.type() === 'error') {
      console.log(`[browser:${m.type()}] ${t}`);
    }
  });

  await page.goto('/#/viewer');
  const workerLen = await page.evaluate(async () => {
    const res = await fetch('/Voidmanager-website/fragments-worker.mjs');
    const buf = await res.arrayBuffer();
    return buf.byteLength;
  });
  console.log(`\nSERVED WORKER BYTES: ${workerLen}`);
  await page.getByTestId('db-file-input').setInputFiles(DB);
  await expect(page.getByTestId('ifc-status')).toContainText('Ready', { timeout: 60_000 });
  await expect(page.getByTestId('void-mesh-status')).not.toContainText('voids: 0', { timeout: 30_000 });
  const canvasInfo = await page.evaluate(() =>
    Array.from(document.querySelectorAll('canvas')).map((c) => {
      const r = c.getBoundingClientRect();
      return { left: r.left, top: r.top, w: r.width, h: r.height, vis: c.offsetParent !== null };
    }),
  );
  console.log(`\nCANVAS COUNT: ${canvasInfo.length} -> ${JSON.stringify(canvasInfo)}`);
  await dbg(page, 'AFTER DB LOAD (All projects)');

  // Switch to Project2
  await page.getByTestId('project-select').selectOption('Project2');
  await page.waitForTimeout(1500);
  await dbg(page, 'AFTER switch -> Project2');

  // Switch to MEP_R23.rvt
  await page.getByTestId('project-select').selectOption('MEP_R23.rvt');
  await page.waitForTimeout(1500);
  await dbg(page, 'AFTER switch -> MEP_R23.rvt');

  // Back to All
  await page.getByTestId('project-select').selectOption('');
  await page.waitForTimeout(1500);
  await dbg(page, 'AFTER switch -> All');

  // Projection-based void pick diagnostic (bypasses client->NDC conversion).
  const diag = (await page.evaluate(() => (window as unknown as { __diagVoidPick?: () => unknown }).__diagVoidPick?.())) as
    | { computedClient?: [number, number] }
    | undefined;
  console.log(`\nDIAG VOID PICK: ${JSON.stringify(diag)}`);

  // Targeted pick at the void's exact projected screen position.
  if (diag?.computedClient) {
    const [tx, ty] = diag.computedClient;
    const targeted = await page.evaluate(
      ([x, y]) => (window as unknown as { __pickRaw?: (x: number, y: number) => Promise<unknown> }).__pickRaw?.(Math.round(x), Math.round(y)),
      [tx, ty],
    );
    console.log(`TARGETED PICK at (${Math.round(tx)},${Math.round(ty)}) -> ${JSON.stringify(targeted)}`);
  }

  // Pick at canvas center (void test)
  const canvas = page.locator('canvas').first();
  const box = (await canvas.boundingBox())!;
  const cx = Math.round(box.x + box.width / 2);
  const cy = Math.round(box.y + box.height / 2);
  const pickCenter = await page.evaluate(
    ([x, y]) => (window as unknown as { __pickRaw?: (x: number, y: number) => Promise<unknown> }).__pickRaw?.(x, y),
    [cx, cy],
  );
  console.log(`\nPICK center (${cx},${cy}) -> ${JSON.stringify(pickCenter)}`);

  // Sample a 5x5 grid of picks across the canvas to see if ANY void mesh is hit.
  const hits: string[] = [];
  for (let i = 1; i <= 5; i++) {
    for (let j = 1; j <= 5; j++) {
      const x = Math.round(box.x + (box.width * i) / 6);
      const y = Math.round(box.y + (box.height * j) / 6);
      const r = await page.evaluate(
        ([px, py]) => (window as unknown as { __pickRaw?: (x: number, y: number) => Promise<unknown> }).__pickRaw?.(px, py),
        [x, y],
      );
      if (r) hits.push(`(${i},${j})=${JSON.stringify(r)}`);
    }
  }
  console.log(`\nGRID PICK hits (${hits.length}/25): ${hits.join(' ; ')}`);

  // Now load IFC and inspect
  if (fs.existsSync(IFC)) {
    await page.getByTestId('ifc-file-input').setInputFiles(IFC);
    await expect(page.getByTestId('ifc-status')).toContainText('Loaded', { timeout: 120_000 });
    await page.waitForTimeout(3500);
    await dbg(page, 'AFTER IFC LOAD');

    // H2: move the camera (drag) after load to see if meshes stream in.
    const cbox = (await page.locator('canvas').first().boundingBox())!;
    await page.mouse.move(cbox.x + cbox.width / 2, cbox.y + cbox.height / 2);
    await page.mouse.down();
    await page.mouse.move(cbox.x + cbox.width / 2 + 120, cbox.y + cbox.height / 2 + 80, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(1500);
    await dbg(page, 'AFTER CAMERA DRAG');

    // H2b: also try an explicit zoom-to-fit which forces fitToSphere + updates.
    await page.getByTestId('zoom-to-fit').click();
    await page.waitForTimeout(1500);
    await dbg(page, 'AFTER ZOOM TO FIT');
  }
});
