import { test, expect } from '@playwright/test';

test('home renders and links to the viewer', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'VoidManager' })).toBeVisible();

  await page.getByRole('link', { name: /open the 3d viewer/i }).click();
  await expect(page).toHaveURL(/#\/viewer$/);
  await expect(page.getByRole('heading', { name: 'Viewer' })).toBeVisible();

  expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
});

test('unknown route redirects home', async ({ page }) => {
  await page.goto('/#/does-not-exist');
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole('heading', { name: 'VoidManager' })).toBeVisible();
});
