/**
 * Playwright E2E — void mesh + selection sync (M2 Stage B2).
 *
 * Skips gracefully when fixtures/sample.db is absent.
 *
 * Strategy:
 * - Load DB via data-testid="db-file-input" (bypasses showDirectoryPicker).
 * - Assert data-testid="void-mesh-status" shows voids > 0 (meshes built from
 *   DB data alone — no IFC needed).
 * - Select a grid row via checkbox and assert selected count > 0 in the status.
 * - Assert ZERO console errors throughout.
 *
 * NOTE: WebGL visual correctness is not asserted — we only check DOM + status.
 */

import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const DB_FIXTURE = path.resolve('fixtures/sample.db');
const IFC_FIXTURE = path.resolve('fixtures/E_AIH_68_INS-KLI_HOM_Klimaat.ifc');
const DB_EXISTS = fs.existsSync(DB_FIXTURE);
const IFC_EXISTS = fs.existsSync(IFC_FIXTURE);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Navigate to /#/viewer, load the fixture DB, wait for the grid and the
 * void-mesh-status badge to appear.  Returns an error collector.
 */
async function setupViewer(page: Page): Promise<{ errors: string[] }> {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('/#/viewer');

  // Load DB
  const dbInput = page.getByTestId('db-file-input');
  await expect(dbInput).toBeVisible({ timeout: 10_000 });
  await dbInput.setInputFiles(DB_FIXTURE);

  // Wait for ifc-status (means 3D viewer mounted)
  await expect(page.getByTestId('ifc-status')).toBeVisible({ timeout: 20_000 });

  // Wait for void-mesh-status badge
  await expect(page.getByTestId('void-mesh-status')).toBeVisible({ timeout: 10_000 });

  return { errors };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Void mesh + selection sync (M2 Stage B2)', () => {
  test.setTimeout(120_000);

  test('void-mesh-status shows voids > 0 after DB load (no IFC needed)', async ({ page }) => {
    test.skip(!DB_EXISTS, 'no DB fixture');
    await setupViewer(page);

    // Wait for the 3D world to initialise (may take up to 60s in headless Chromium).
    await expect(page.getByTestId('ifc-status')).toContainText('Ready', { timeout: 60_000 });

    // Wait for the 3D world to initialise and setVoids to run.
    // The badge text is "voids: N · selected: M"
    await expect(page.getByTestId('void-mesh-status')).not.toContainText(
      'voids: 0',
      { timeout: 30_000 },
    );

    const statusText = await page.getByTestId('void-mesh-status').textContent();
    expect(statusText).toBeTruthy();

    // Extract mesh count and assert > 0
    const match = statusText?.match(/voids:\s*(\d+)/);
    expect(match, `void-mesh-status text was: "${statusText}"`).not.toBeNull();
    const meshCount = parseInt(match![1], 10);
    expect(meshCount).toBeGreaterThan(0);
  });

  test('selecting a grid row updates selected count in void-mesh-status', async ({ page }) => {
    test.skip(!DB_EXISTS, 'no DB fixture');
    await setupViewer(page);

    // Wait for the 3D world to be ready (may take up to 60s in headless Chromium)
    await expect(page.getByTestId('ifc-status')).toContainText('Ready', { timeout: 60_000 });

    // Wait for at least 1 grid row to appear
    await page.waitForFunction(
      () => document.querySelectorAll('.ag-row').length > 0,
      { timeout: 20_000 },
    );

    // Wait for void meshes to be built
    await page.waitForFunction(
      () => {
        const badge = document.querySelector('[data-testid="void-mesh-status"]');
        if (!badge) return false;
        const match = badge.textContent?.match(/voids:\s*(\d+)/);
        return match ? parseInt(match[1], 10) > 0 : false;
      },
      { timeout: 30_000 },
    );

    // Click a checkbox in the first grid row to select it
    const firstRowCheckbox = page.locator('.ag-row').first().locator('.ag-checkbox-input').first();
    await firstRowCheckbox.click({ timeout: 10_000 });

    // The selected count in void-mesh-status should become > 0
    await page.waitForFunction(
      () => {
        const badge = document.querySelector('[data-testid="void-mesh-status"]');
        if (!badge) return false;
        const match = badge.textContent?.match(/selected:\s*(\d+)/);
        return match ? parseInt(match[1], 10) > 0 : false;
      },
      { timeout: 10_000 },
    );

    const statusText = await page.getByTestId('void-mesh-status').textContent();
    const selMatch = statusText?.match(/selected:\s*(\d+)/);
    expect(selMatch).not.toBeNull();
    expect(parseInt(selMatch![1], 10)).toBeGreaterThan(0);
  });

  test('zero console errors during DB load + void mesh build', async ({ page }) => {
    test.skip(!DB_EXISTS, 'no DB fixture');
    const { errors } = await setupViewer(page);

    // Wait for viewer ready (may take up to 60s in headless Chromium)
    await expect(page.getByTestId('ifc-status')).toContainText('Ready', { timeout: 60_000 });

    // Allow brief settle time for async mesh build
    await page.waitForTimeout(500);

    expect(errors, `Console errors:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('zero console errors after loading IFC + DB together', async ({ page }) => {
    test.skip(!DB_EXISTS || !IFC_EXISTS, 'missing DB or IFC fixture');
    const { errors } = await setupViewer(page);

    // Wait for viewer ready, then load IFC
    await expect(page.getByTestId('ifc-status')).toContainText('Ready', { timeout: 30_000 });

    const ifcInput = page.getByTestId('ifc-file-input');
    await expect(ifcInput).toBeVisible({ timeout: 10_000 });
    await ifcInput.setInputFiles(IFC_FIXTURE);

    // Wait for IFC load to complete (generous timeout for large model)
    await expect(page.getByTestId('ifc-status')).toContainText('Loaded', { timeout: 120_000 });

    // Void meshes should still be present
    const statusText = await page.getByTestId('void-mesh-status').textContent();
    const match = statusText?.match(/voids:\s*(\d+)/);
    expect(match).not.toBeNull();
    expect(parseInt(match![1], 10)).toBeGreaterThan(0);

    expect(errors, `Console errors:\n${errors.join('\n')}`).toHaveLength(0);
  });
});
