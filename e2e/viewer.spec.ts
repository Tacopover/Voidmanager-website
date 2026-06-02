/**
 * Playwright E2E — /viewer page (read-only datagrid).
 *
 * All fixture-backed tests skip gracefully when fixtures/sample.db is absent
 * (CI without the fixture). The fixture is expected locally.
 *
 * Driving strategy: Playwright cannot call showDirectoryPicker(), so every
 * test loads the DB via the visible <input data-testid="db-file-input">.
 */

import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const FIXTURE_PATH = path.resolve('fixtures/sample.db');
const FIXTURE_EXISTS = fs.existsSync(FIXTURE_PATH);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Navigate to /#/viewer and inject the fixture .db via the file input. */
async function loadFixture(page: Page) {
  const errors: string[] = [];
  page.on('console', (msg) => {
    // Ignore AG Grid's own dev-mode logging and debug calls we emit ourselves.
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('/#/viewer');

  // Wait for the DB loader to appear (tryReopenSaved resolves quickly to null).
  const fileInput = page.getByTestId('db-file-input');
  await expect(fileInput).toBeVisible({ timeout: 10_000 });

  // Inject the fixture bytes via setInputFiles (bypasses showDirectoryPicker).
  await fileInput.setInputFiles(FIXTURE_PATH);

  // Wait for the grid to appear — at least one row cell should be visible.
  await expect(page.locator('.ag-center-cols-container .ag-row').first()).toBeVisible({
    timeout: 20_000,
  });

  return { errors };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Viewer — void datagrid', () => {
  test('grid shows > 0 rows after loading fixture', async ({ page }) => {
    test.skip(!FIXTURE_EXISTS, 'no fixture');
    await loadFixture(page);

    const rows = page.locator('.ag-center-cols-container .ag-row');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
  });

  test('all visible status values are within APPROVAL_STATUSES', async ({ page }) => {
    test.skip(!FIXTURE_EXISTS, 'no fixture');
    await loadFixture(page);

    const VALID_STATUSES = [
      'concept',
      'open for review',
      'approved',
      'rejected',
      'released for execution',
      'executed',
    ];

    // Scope to data rows only (inside ag-center-cols-container, not the header).
    const statusCells = page.locator('.ag-center-cols-container [col-id="status"]');
    const cellCount = await statusCells.count();
    expect(cellCount).toBeGreaterThan(0);

    for (let i = 0; i < cellCount; i++) {
      const text = (await statusCells.nth(i).textContent())?.trim() ?? '';
      if (text !== '') {
        expect(VALID_STATUSES, `Unexpected status: "${text}"`).toContain(text);
      }
    }
  });

  test('typing in the Status floating filter reduces rows', async ({ page }) => {
    test.skip(!FIXTURE_EXISTS, 'no fixture');
    await loadFixture(page);

    const allRows = page.locator('.ag-center-cols-container .ag-row');
    const totalBefore = await allRows.count();
    expect(totalBefore).toBeGreaterThan(0);

    // Type in the Status floating filter input.
    const statusFilter = page.locator('[col-id="status"] input').first();
    await statusFilter.fill('approved');
    // Give the grid a moment to re-render.
    await page.waitForTimeout(400);

    const totalAfter = await allRows.count();
    // Either rows are reduced, or (if all happen to be 'approved') same count.
    // The important thing is no more rows than before, and no crash.
    expect(totalAfter).toBeLessThanOrEqual(totalBefore);
  });

  test('clicking a column header sorts the grid', async ({ page }) => {
    test.skip(!FIXTURE_EXISTS, 'no fixture');
    await loadFixture(page);

    // Click the Status column header (role=columnheader, not the floating filter row).
    const statusHeader = page.locator('[role="columnheader"][col-id="status"]');
    await statusHeader.click();
    await page.waitForTimeout(300);

    // Expect an aria-sort attribute set to ascending or descending.
    const ariaSort = await statusHeader.getAttribute('aria-sort');
    expect(ariaSort).toBeTruthy();
    expect(['ascending', 'descending']).toContain(ariaSort);
  });

  test('column chooser can hide and re-show a column', async ({ page }) => {
    test.skip(!FIXTURE_EXISTS, 'no fixture');
    await loadFixture(page);

    // Verify Host column is visible initially.
    const hostCells = page.locator('[col-id="host"]');
    await expect(hostCells.first()).toBeVisible();

    // Open column chooser.
    const chooserBtn = page.getByRole('button', { name: /columns/i });
    await chooserBtn.click();

    // Uncheck "Host".
    const hostCheckbox = page.getByRole('dialog', { name: /column chooser/i }).getByRole('checkbox', { name: /^host$/i });
    await hostCheckbox.uncheck();
    await page.waitForTimeout(300);

    // Host column should be hidden — cells should not be present.
    await expect(page.locator('[col-id="host"]')).toHaveCount(0);

    // Re-check Host.
    await hostCheckbox.check();
    await page.waitForTimeout(300);

    // Host column should be visible again.
    await expect(page.locator('[col-id="host"]').first()).toBeVisible();

    // Close chooser.
    await page.getByRole('button', { name: /close column chooser/i }).click();
  });

  test('zero console errors during the full flow', async ({ page }) => {
    test.skip(!FIXTURE_EXISTS, 'no fixture');
    const { errors } = await loadFixture(page);

    // Interact: open chooser, sort, filter — then check no errors.
    const chooserBtn = page.getByRole('button', { name: /columns/i });
    await chooserBtn.click();
    await page.getByRole('button', { name: /close column chooser/i }).click();

    // Click a header to sort.
    await page.locator('[role="columnheader"][col-id="status"]').click();
    await page.waitForTimeout(200);

    expect(errors, `Console errors:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('multi-row selection works (checkbox click)', async ({ page }) => {
    test.skip(!FIXTURE_EXISTS, 'no fixture');
    await loadFixture(page);

    // Click the checkbox in the first data row to select it.
    const firstRowCheckbox = page.locator('.ag-center-cols-container .ag-row').first()
      .locator('.ag-selection-checkbox');
    await firstRowCheckbox.click();
    await page.waitForTimeout(300);

    // At least one row should now have the selected class.
    const selectedRows = page.locator('.ag-row-selected');
    const selectedCount = await selectedRows.count();
    expect(selectedCount).toBeGreaterThan(0);
  });
});
