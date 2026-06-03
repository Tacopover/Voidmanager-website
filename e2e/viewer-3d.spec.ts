/**
 * Playwright E2E — 3D IFC viewer (Milestone 2 Stage A).
 *
 * Tests skip gracefully when either fixture is absent.
 *
 * Strategy:
 * - Load DB via data-testid="db-file-input" (bypasses showDirectoryPicker).
 * - Load IFC via data-testid="ifc-file-input" (bypasses showOpenFilePicker).
 * - Assert canvas exists with non-zero size, element count > 0 via
 *   data-testid="ifc-status", and zero console errors during load.
 * - WebGL: Playwright's bundled Chromium supports WebGL via SwiftShader in
 *   headless mode. We do NOT do pixel checks; we check DOM + status element.
 */

import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const DB_FIXTURE = path.resolve('fixtures/sample.db');
const IFC_FIXTURE = path.resolve('fixtures/E_AIH_68_INS-KLI_HOM_Klimaat.ifc');
const DB_EXISTS = fs.existsSync(DB_FIXTURE);
const IFC_EXISTS = fs.existsSync(IFC_FIXTURE);
const BOTH_EXIST = DB_EXISTS && IFC_EXISTS;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Navigate to /#/viewer and load the fixture DB so the 3D pane becomes visible.
 * Returns an error-collector array for later assertion.
 */
async function loadDb(page: Page): Promise<{ errors: string[] }> {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('/#/viewer');

  // Wait for DB loader input
  const dbInput = page.getByTestId('db-file-input');
  await expect(dbInput).toBeVisible({ timeout: 10_000 });
  await dbInput.setInputFiles(DB_FIXTURE);

  // Wait until the 3D pane has mounted (ThreeDViewer replaces the grid pane
  // after DB load — wait for the ifc-status badge to appear)
  await expect(page.getByTestId('ifc-status')).toBeVisible({ timeout: 20_000 });

  return { errors };
}

/**
 * Load an IFC file into the 3D viewer via the file input.
 * Waits for the status to change to "Loaded N elements".
 */
async function loadIfc(page: Page): Promise<void> {
  const ifcInput = page.getByTestId('ifc-file-input');
  await expect(ifcInput).toBeVisible({ timeout: 10_000 });
  await ifcInput.setInputFiles(IFC_FIXTURE);

  // Wait until status shows "Loaded N elements" — generous timeout for large model
  await expect(page.getByTestId('ifc-status')).toContainText('Loaded', { timeout: 120_000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('3D Viewer — IFC loading (M2 Stage A)', () => {
  // Each test in this suite gets its own generous timeout.
  // OBC world init + IFC parsing take significant time in headless Chromium.
  test.setTimeout(180_000);

  test('ThreeDViewer mounts and shows status badge after DB load', async ({ page }) => {
    test.skip(!DB_EXISTS, 'no DB fixture');
    await loadDb(page);

    const statusBadge = page.getByTestId('ifc-status');
    await expect(statusBadge).toBeVisible();
    // Should show either "Ready" or "Initializing" while setting up
    const text = await statusBadge.textContent();
    expect(text).toBeTruthy();
  });

  test('ifc-file-input is present and reachable', async ({ page }) => {
    test.skip(!DB_EXISTS, 'no DB fixture');
    await loadDb(page);

    const ifcInput = page.getByTestId('ifc-file-input');
    await expect(ifcInput).toBeVisible({ timeout: 10_000 });
    await expect(ifcInput).toHaveAttribute('accept', '.ifc');
  });

  test('canvas is present with non-zero dimensions after DB load', async ({ page }) => {
    test.skip(!DB_EXISTS, 'no DB fixture');
    await loadDb(page);

    // Wait for "ready" state (world initialized)
    await expect(page.getByTestId('ifc-status')).toContainText('Ready', { timeout: 30_000 });

    // A <canvas> element should exist inside the 3D pane
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 10_000 });

    // Canvas dimensions should be non-zero
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
  });

  test('loading fixture IFC reports > 0 elements', async ({ page }) => {
    test.skip(!BOTH_EXIST, 'missing DB or IFC fixture');
    const { errors } = await loadDb(page);

    // Wait for the viewer to initialise
    await expect(page.getByTestId('ifc-status')).toContainText('Ready', { timeout: 30_000 });

    // Load the IFC
    await loadIfc(page);

    // Status should report element count > 0
    const statusText = await page.getByTestId('ifc-status').textContent();
    expect(statusText).toMatch(/Loaded \d+ elements/);

    // Extract and assert count > 0
    const match = statusText?.match(/Loaded (\d+) elements/);
    expect(match).not.toBeNull();
    const count = parseInt(match![1], 10);
    expect(count).toBeGreaterThan(0);

    // Verify canvas still present
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box!.width).toBeGreaterThan(0);

    // No console errors during entire flow
    expect(errors, `Console errors:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('zero console errors during DB load + viewer init', async ({ page }) => {
    test.skip(!DB_EXISTS, 'no DB fixture');
    const { errors } = await loadDb(page);

    // Wait for viewer to be ready
    await expect(page.getByTestId('ifc-status')).toContainText('Ready', { timeout: 30_000 });

    expect(errors, `Console errors:\n${errors.join('\n')}`).toHaveLength(0);
  });
});
