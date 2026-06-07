/**
 * Playwright E2E — round-2 features (PLAN_v2).
 *
 * Covers: slim merged bar + resizable divider (M8), project-switch mesh rebuild
 * (M9), Zoom to / Zoom to Fit buttons + orbit (M12), model browser tree + element
 * selection routed through the unified store (M13/M11), and in-memory status
 * editing with the unsaved indicator (M14).
 *
 * WebGL correctness is only proxied: canvas exists + non-zero size + zero console
 * errors. Selection/UI behaviour is asserted via DOM + the status badges.
 *
 * Fixture-backed tests skip gracefully when fixtures/ is absent.
 */

import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const DB_FIXTURE = path.resolve('fixtures/sample.db');
const IFC_FIXTURE = path.resolve('fixtures/E_AIH_68_INS-KLI_HOM_Klimaat.ifc');
const DB_EXISTS = fs.existsSync(DB_FIXTURE);
const IFC_EXISTS = fs.existsSync(IFC_FIXTURE);

/** Load the fixture DB and wait for the 3D viewer to be ready. Returns an error collector. */
async function setupViewer(page: Page): Promise<{ errors: string[] }> {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto('/#/viewer');
  const dbInput = page.getByTestId('db-file-input');
  await expect(dbInput).toBeVisible({ timeout: 10_000 });
  await dbInput.setInputFiles(DB_FIXTURE);
  await expect(page.getByTestId('ifc-status')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('ifc-status')).toContainText('Ready', { timeout: 60_000 });
  await expect(page.getByTestId('void-mesh-status')).not.toContainText('voids: 0', {
    timeout: 30_000,
  });
  return { errors };
}

// ---------------------------------------------------------------------------
// M8 — layout (no fixtures needed)
// ---------------------------------------------------------------------------

test.describe('M8 — slim merged bar + layout', () => {
  test('global nav is hidden on /viewer; slim bar carries Home/Viewer', async ({ page }) => {
    await page.goto('/#/viewer');
    // The global <header class="app-nav"> must not render on the viewer route.
    await expect(page.locator('header.app-nav')).toHaveCount(0);
    // The slim bar's nav links are present even before a DB is loaded.
    await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Viewer' })).toBeVisible();
  });

  test('home route renders the marketing header (not the old global nav)', async ({ page }) => {
    await page.goto('/#/');
    // The old global app-nav is gone; Home owns its own marketing header.
    await expect(page.locator('header.app-nav')).toHaveCount(0);
    await expect(page.locator('header.site-header')).toHaveCount(1);
    // The header carries a Viewer link to the existing route.
    await expect(page.getByRole('link', { name: 'Viewer', exact: true })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Fixture-backed round-2 behaviour
// ---------------------------------------------------------------------------

test.describe('PLAN_v2 features (fixture-backed)', () => {
  test.setTimeout(120_000);

  test('M8 — divider resizes the split; canvas stays non-zero', async ({ page }) => {
    test.skip(!DB_EXISTS, 'no DB fixture');
    const { errors } = await setupViewer(page);

    const divider = page.getByTestId('split-divider');
    await expect(divider).toBeVisible();
    const box = await divider.boundingBox();
    expect(box).not.toBeNull();

    // Drag the divider up by 80px (grow the grid / shrink the 3D pane).
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2, box!.y - 80, { steps: 6 });
    await page.mouse.up();

    const canvas = page.locator('canvas').first();
    const cbox = await canvas.boundingBox();
    expect(cbox!.width).toBeGreaterThan(0);
    expect(cbox!.height).toBeGreaterThan(0);
    expect(errors, `Console errors:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('M9 — switching project rebuilds void meshes without errors', async ({ page }) => {
    test.skip(!DB_EXISTS, 'no DB fixture');
    const { errors } = await setupViewer(page);

    const select = page.getByTestId('project-select');
    // The selector may be absent if the DB has no projects — skip then.
    const present = await select.count();
    test.skip(present === 0, 'no project selector (no projects in DB)');

    const optionValues = await select.locator('option').evaluateAll((opts) =>
      opts.map((o) => (o as HTMLOptionElement).value),
    );
    const projectOption = optionValues.find((v) => v !== '');
    test.skip(!projectOption, 'DB has no named project to switch to');

    await select.selectOption(projectOption!);
    // Meshes rebuild for the project; the badge must still report a void count.
    await expect(page.getByTestId('void-mesh-status')).toBeVisible();
    // Switching back to "All projects" must also work.
    await select.selectOption('');
    await expect(page.getByTestId('void-mesh-status')).not.toContainText('voids: 0', {
      timeout: 30_000,
    });
    expect(errors, `Console errors:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('M12 — Zoom to is gated by selection; Zoom to Fit always works', async ({ page }) => {
    test.skip(!DB_EXISTS, 'no DB fixture');
    const { errors } = await setupViewer(page);

    // No selection yet → Zoom to disabled.
    await expect(page.getByTestId('zoom-to-selection')).toBeDisabled();

    // Zoom to Fit works with no selection.
    await page.getByTestId('zoom-to-fit').click();

    // Select a grid row → Zoom to becomes enabled → click it.
    await page.waitForFunction(() => document.querySelectorAll('.ag-row').length > 0, {
      timeout: 20_000,
    });
    await page.locator('.ag-row').first().locator('.ag-checkbox-input').first().click();
    await expect(page.getByTestId('zoom-to-selection')).toBeEnabled();
    await page.getByTestId('zoom-to-selection').click();

    const canvas = page.locator('canvas').first();
    const cbox = await canvas.boundingBox();
    expect(cbox!.width).toBeGreaterThan(0);
    expect(errors, `Console errors:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('M14 — bulk status edit marks rows unsaved (in-memory)', async ({ page }) => {
    test.skip(!DB_EXISTS, 'no DB fixture');
    const { errors } = await setupViewer(page);

    await page.waitForFunction(() => document.querySelectorAll('.ag-row').length > 0, {
      timeout: 20_000,
    });
    // Select two rows.
    const checkboxes = page.locator('.ag-row .ag-checkbox-input');
    await checkboxes.nth(0).click();
    await checkboxes.nth(1).click();

    // Apply a bulk status.
    await page.getByTestId('bulk-status-select').selectOption('approved');

    // The unsaved indicator appears (>= 1).
    const dirty = page.getByTestId('dirty-status');
    await expect(dirty).toBeVisible();
    await expect(dirty).toContainText('unsaved');
    expect(errors, `Console errors:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('M13/M11 — model browser node selects an IFC element (store-routed)', async ({ page }) => {
    test.skip(!DB_EXISTS || !IFC_EXISTS, 'missing DB or IFC fixture');
    const { errors } = await setupViewer(page);

    // Load the IFC so the spatial structure exists.
    await page.getByTestId('ifc-file-input').setInputFiles(IFC_FIXTURE);
    await expect(page.getByTestId('ifc-status')).toContainText('Loaded', { timeout: 120_000 });

    // Open the browser drawer.
    await page.getByTestId('toggle-browser').click();
    await expect(page.getByTestId('model-browser')).toBeVisible();
    await expect(page.getByTestId('model-browser-node').first()).toBeVisible({ timeout: 20_000 });

    // Issue #1: at least one selectable node shows a real element Name (not "#id").
    const named = page
      .locator('[data-testid="model-browser-node"][data-selectable="true"]')
      .filter({ hasNotText: /^#\d+$/ });
    await expect(named.first()).toBeVisible({ timeout: 20_000 });

    // Click a selectable item node → selects the IFC element via the store.
    const itemNode = page.locator('[data-testid="model-browser-node"][data-selectable="true"]').first();
    await expect(itemNode).toBeVisible({ timeout: 20_000 });
    await itemNode.click();

    // selection-status should report at least one element selected (e:>=1).
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="selection-status"]');
        const m = el?.textContent?.match(/e:(\d+)/);
        return m ? parseInt(m[1], 10) >= 1 : false;
      },
      { timeout: 10_000 },
    );
    expect(errors, `Console errors:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('M10 — clicking the 3D canvas does not throw', async ({ page }) => {
    test.skip(!DB_EXISTS, 'no DB fixture');
    const { errors } = await setupViewer(page);
    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.waitForTimeout(300);
    expect(errors, `Console errors:\n${errors.join('\n')}`).toHaveLength(0);
  });
});
