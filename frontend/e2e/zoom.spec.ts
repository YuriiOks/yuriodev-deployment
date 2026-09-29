import { test, expect, openZoomed } from './fixtures';

/*
 * Real browser page-zoom (Ctrl+/Ctrl- or a pinch, not a resize), emulated via
 * a dedicated browser context per zoom level (openZoomed, fixtures.ts): the
 * CSS viewport shrinks/grows by 1/zoom and deviceScaleFactor grows/shrinks to
 * match, exactly what a real browser does. `getComputedStyle().fontSize`
 * (a CSS-px value) times zoom is the physical, on-screen size.
 *
 * Before the fix, global.css keyed the root font-size above 1440px CSS width
 * to `100vw`/`100vh` - values zoom itself rescales - so the on-screen size
 * came out independent of zoom (a "dead zone" spanning 100% and most of the
 * realistic zoom range). Root scaling is fixed to the browser default now;
 * any growth on very large screens lives only in small, independently-capped
 * fluid type tokens on headings/hero, which never cancel zoom the same way.
 *
 * Runs once (its own browser contexts, independent of the project's fixed
 * viewport), skipping itself everywhere but one CI project - the same
 * convention geometry.spec.ts's rail-clearance test and fluid-scaling.spec.ts
 * use for a check that does not depend on the project's own viewport.
 */

const WINDOWS = [
  { width: 1440, height: 789 },
  { width: 1920, height: 953 },
  { width: 2560, height: 1313 },
];

test.describe('browser zoom scales on-screen text, at every window size', () => {
  for (const win of WINDOWS) {
    test(`${win.width}x${win.height}: 200% and 50% zoom change on-screen body text size, no dead zone`, async ({
      browser,
    }, testInfo) => {
      test.skip(testInfo.project.name !== '1920x1080', 'its own browser contexts; runs once across the whole suite');

      const bodyFontPx = async (zoom: number) => {
        const { context, page } = await openZoomed(browser, '/', { ...win, zoom });
        const px = await page.evaluate(() => Number.parseFloat(getComputedStyle(document.body).fontSize));
        await context.close();
        return px;
      };

      const base = await bodyFontPx(1);
      const doubled = await bodyFontPx(2);
      const halved = await bodyFontPx(0.5);

      const onScreenBase = base * 1;
      const ratioUp = (doubled * 2) / onScreenBase;
      const ratioDown = (halved * 0.5) / onScreenBase;

      const label = `${win.width}x${win.height}`;
      expect(ratioUp, `${label}: on-screen text at 200% zoom / at 100% zoom`).toBeGreaterThanOrEqual(1.9);
      expect(ratioUp, `${label}: on-screen text at 200% zoom / at 100% zoom`).toBeLessThanOrEqual(2.1);
      expect(ratioDown, `${label}: on-screen text at 50% zoom / at 100% zoom`).toBeGreaterThanOrEqual(0.45);
      expect(ratioDown, `${label}: on-screen text at 50% zoom / at 100% zoom`).toBeLessThanOrEqual(0.55);
    });
  }
});

test.describe('reflow at extreme zoom (WCAG 1.4.10)', () => {
  test('a 1280-wide window at 400% zoom (320 CSS px) never scrolls sideways', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== '1920x1080', 'its own browser context; runs once across the whole suite');
    const { context, page } = await openZoomed(browser, '/', { width: 1280, height: 800, zoom: 4 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, '320 CSS px window: no horizontal overflow').toBeLessThanOrEqual(0);
    await context.close();
  });
});
