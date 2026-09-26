import { test, expect, open } from './fixtures';

const NAME = 'Yurii Oksamytnyi';

test.describe('routes', () => {
  const routes = [
    { path: '/', heading: NAME, title: `${NAME} — AI/ML Systems Engineer` },
    { path: '/courses', heading: /course/i, title: new RegExp(`\\| ${NAME}$`) },
    { path: '/dashboard', heading: /dashboard/i, title: new RegExp(`\\| ${NAME}$`) },
    { path: '/community', heading: /community/i, title: new RegExp(`\\| ${NAME}$`) },
    { path: '/privacy', heading: 'Privacy notice', title: `Privacy | ${NAME}` },
    { path: '/no-such-page', heading: '404: page not found', title: `Page not found | ${NAME}` },
  ];

  for (const { path, heading, title } of routes) {
    test(`${path} renders its page`, async ({ page }) => {
      await open(page, path);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(page).toHaveTitle(title);
      await expect(page.getByRole('banner')).toBeVisible();
      await expect(page.getByRole('contentinfo')).toBeVisible();
    });
  }

  test('/home redirects to the home page', async ({ page }) => {
    await page.goto('/home');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1, name: NAME })).toBeVisible();
  });

  test('the 404 page links back home', async ({ page }) => {
    await open(page, '/no-such-page');
    await page.getByRole('link', { name: /back to the home page/ }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1, name: NAME })).toBeVisible();
  });
});

test.describe('theme', () => {
  for (const system of ['dark', 'light'] as const) {
    test(`the toggle's choice outlives a reload and a route change (system ${system})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: system });
      await open(page, '/');
      const html = page.locator('html');
      await expect(html).toHaveAttribute('data-theme', system);

      const other = system === 'dark' ? 'light' : 'dark';
      await page.getByRole('button', { name: `Switch to ${other} theme` }).click();
      await expect(html).toHaveAttribute('data-theme', other);
      expect(await page.evaluate(() => localStorage.getItem('theme-choice'))).toBe(other);

      await page.reload();
      await expect(html).toHaveAttribute('data-theme', other);
      await expect(page.getByRole('button', { name: `Switch to ${system} theme` })).toBeVisible();

      await page.goto('/privacy');
      await expect(html).toHaveAttribute('data-theme', other);
    });
  }
});

test.describe('skip link', () => {
  for (const path of ['/', '/privacy']) {
    test(`is the first stop on ${path} and moves focus to the main content`, async ({ page }) => {
      await open(page, path);
      await page.keyboard.press('Tab');
      const skip = page.getByRole('link', { name: 'Skip to main content' });
      await expect(skip).toBeFocused();
      await expect(skip).toBeInViewport();

      await page.keyboard.press('Enter');
      await expect(page.locator('main#main-content')).toBeFocused();
      // It moves focus only: no fragment in the URL.
      expect(new URL(page.url()).hash).toBe('');

      // The next Tab continues inside main, not back at the header.
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('main'))).toBe(true);
    });
  }
});
