import { test, expect } from '@playwright/test';

test('home renders and links to the viewer', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: /find every clash/i })).toBeVisible();

  // Header nav "Viewer" link opens in a new tab (target=_blank) pointing to /#/viewer.
  const viewerLink = page.getByRole('link', { name: 'Viewer', exact: true });
  await expect(viewerLink).toHaveAttribute('target', '_blank');
  await expect(viewerLink).toHaveAttribute('href', /#\/viewer$/);

  expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
});

test('unknown route redirects home', async ({ page }) => {
  await page.goto('/#/does-not-exist');
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole('heading', { name: /find every clash/i })).toBeVisible();
});
