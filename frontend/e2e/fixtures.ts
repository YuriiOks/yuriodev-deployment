import { test as base, expect, type Page } from '@playwright/test';
import { HEALTH, POSTS_FEED } from './data';

/*
 * Every test gets a page whose /api requests are answered here (vite preview
 * would otherwise proxy them to the live backend), and fails if the page logs
 * a console error or throws.
 */

export interface Options {
  /** What GET /api/posts answers: the fixture feed, or 404 (a backend without the route). */
  posts: 'feed' | 'missing';
}

export const test = base.extend<Options>({
  posts: ['feed', { option: true }],

  page: async ({ page, posts }, use) => {
    await page.route('**/api/**', async (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname === '/api/posts' && posts === 'feed') return route.fulfill({ json: POSTS_FEED });
      if (pathname === '/api/health') return route.fulfill({ json: HEALTH });
      return route.fulfill({ status: 404, json: { error: 'not_found' } });
    });

    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

    await use(page);

    expect(errors, 'console errors and uncaught exceptions').toEqual([]);
  },
});

export { expect };

/** The home page's sections, in page order, as the navigation lists them. */
export const SECTION_IDS = ['hero', 'about', 'timeline', 'skills', 'projects', 'platform', 'posts', 'connect'] as const;

/** Opens `path` and waits until the page, its fonts and (on '/') the late posts section are in place. */
export async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator('main#main-content')).toBeVisible();
  if (new URL(path, 'http://x').pathname === '/') await expect(page.locator('section#posts')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await settle(page);
}

/** Waits until the scroll position has stopped changing. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let last = -1;
        let still = 0;
        const tick = () => {
          const y = window.scrollY;
          still = y === last ? still + 1 : 0;
          last = y;
          if (still >= 5) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

/** The visible section-navigation surfaces: the sidebar, and the header menu button. */
export async function navSurfaces(page: Page): Promise<{ sidebar: boolean; menuButton: boolean }> {
  return page.evaluate(() => {
    const shown = (el: Element | null) => {
      if (!el) return false;
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity) > 0 &&
        box.width > 0 &&
        box.height > 0 &&
        box.right > 0 &&
        box.bottom > 0 &&
        box.left < window.innerWidth &&
        box.top < window.innerHeight
      );
    };
    return {
      sidebar: shown(document.querySelector('#leftSidebarNav')),
      menuButton: shown(document.querySelector('header [data-opens="menu"]')),
    };
  });
}
