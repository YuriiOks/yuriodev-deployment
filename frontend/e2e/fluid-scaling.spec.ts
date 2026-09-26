import { test, expect, open } from './fixtures';

/*
 * Root font-size scaling on very large screens (global.css): from 1440px
 * wide up, html's font-size grows with the screen instead of sitting at a
 * fixed 16px, so every rem-based size on the page grows with it too. The
 * reference design is 1440x810 (16:9); the scale factor is whichever is
 * smaller of width/1440 or height/810, so an ultrawide (ample width, modest
 * height) scales by its height instead of its width.
 *
 * Runs in one project only (setViewportSize covers the sizes that matter -
 * geometry.spec.ts's rail-clearance test does the same), and skips itself
 * everywhere else so it runs exactly once across the whole suite.
 */

interface Size {
  readonly width: number;
  readonly height: number;
}

const SIZES: readonly Size[] = [
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 3840, height: 2160 },
  { width: 5120, height: 1440 }, // ultrawide: scales by height, same factor as 2560x1440
];

/** The factor global.css's clamp should produce for `size`, clamped to [1, 3] (16px to 48px). */
function expectedFactor({ width, height }: Size): number {
  return Math.min(3, Math.max(1, Math.min(width / 1440, height / 810)));
}

test.describe('fluid root scaling', () => {
  test('the root font size, content column share, header height and rail clearance all scale together', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== '1920x1080', 'runs once, in the 1920x1080 project');

    for (const size of SIZES) {
      await page.setViewportSize(size);
      await open(page, '/');

      const factor = expectedFactor(size);
      const expectedFontPx = 16 * factor;

      const geometry = await page.evaluate(() => {
        const rootFontPx = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
        const header = document.querySelector('header')!.getBoundingClientRect();
        const rail = document.getElementById('sectionRail');
        const probe = rail?.previousElementSibling as HTMLElement | null; // SectionRail's hidden content-column probe
        const heroTitle = document.querySelector('#hero h1');
        const card = document.querySelector('[aria-label="Profile information"]');
        return {
          rootFontPx,
          headerHeightPx: header.height,
          probeWidthPx: probe ? probe.getBoundingClientRect().width : null,
          railLeft: rail ? rail.getBoundingClientRect().left : null,
          railRight: rail ? rail.getBoundingClientRect().right : null,
          heroTitleTop: heroTitle ? heroTitle.getBoundingClientRect().top : null,
          heroTitleBottom: heroTitle ? heroTitle.getBoundingClientRect().bottom : null,
          cardTop: card ? card.getBoundingClientRect().top : null,
          overflowX: document.documentElement.scrollWidth - window.innerWidth,
        };
      });

      const label = `${size.width}x${size.height}`;

      expect(geometry.rootFontPx, `${label}: root font-size`).toBeGreaterThanOrEqual(expectedFontPx - 0.5);
      expect(geometry.rootFontPx, `${label}: root font-size`).toBeLessThanOrEqual(expectedFontPx + 0.5);

      // --header-h is 4rem from the md breakpoint up (always true here), so
      // the header's real height tracks the root font size exactly.
      expect(geometry.headerHeightPx, `${label}: header height scales with the root`).toBeCloseTo(geometry.rootFontPx * 4, 0);

      // The content column keeps to 75% of the screen at every size that
      // shares the 1440x810 reference's aspect ratio; a 1440-tall ultrawide
      // is deliberately capped narrower instead (global.css/_variables.css),
      // so it fits comfortably rather than stretching prose across it.
      if (size.width !== 5120) {
        expect(geometry.probeWidthPx, `${label}: content column probe exists`).not.toBeNull();
        const share = (geometry.probeWidthPx! / size.width) * 100;
        expect(share, `${label}: content column share of the screen`).toBeGreaterThanOrEqual(75 - 3);
        expect(share, `${label}: content column share of the screen`).toBeLessThanOrEqual(75 + 3);
      }

      // The rail: never closer than 1rem to the window edge, never closer
      // than 1.5rem to the content column - both scaled by the same factor.
      expect(geometry.railLeft, `${label}: rail inside the window`).toBeGreaterThanOrEqual(16 * factor - 1);
      if (geometry.probeWidthPx !== null) {
        const contentLeft = (size.width - geometry.probeWidthPx) / 2;
        expect(geometry.railRight! + 24 * factor, `${label}: rail clear of the content column`).toBeLessThanOrEqual(
          contentLeft + 1,
        );
      }

      // The hero title and the top of the profile card are both on screen
      // without scrolling, on the very first viewport.
      expect(geometry.heroTitleTop, `${label}: hero title exists`).not.toBeNull();
      expect(geometry.heroTitleTop, `${label}: hero title starts on screen`).toBeGreaterThanOrEqual(0);
      expect(geometry.heroTitleBottom, `${label}: hero title fits in the first viewport`).toBeLessThanOrEqual(size.height);
      expect(geometry.cardTop, `${label}: profile card exists`).not.toBeNull();
      expect(geometry.cardTop, `${label}: profile card top is on screen`).toBeGreaterThanOrEqual(0);
      expect(geometry.cardTop, `${label}: profile card top is in the first viewport`).toBeLessThan(size.height);

      expect(geometry.overflowX, `${label}: no horizontal overflow`).toBeLessThanOrEqual(0);
    }
  });

  test('below 1440px wide the root font size stays fixed at 16px', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== '1920x1080', 'runs once, in the 1920x1080 project');
    for (const size of [
      { width: 1280, height: 800 },
      { width: 1024, height: 768 },
    ]) {
      await page.setViewportSize(size);
      await open(page, '/');
      const rootFontPx = await page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).fontSize));
      expect(rootFontPx, `${size.width}x${size.height}: root font-size stays at 16px`).toBeCloseTo(16, 1);
    }
  });

  for (const theme of ['dark', 'light'] as const) {
    test.describe(`${theme} theme`, () => {
      test.use({ colorScheme: theme });

      test('scales the same way, and never overflows, at 3840x2160', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== '1920x1080', 'runs once, in the 1920x1080 project');
        await page.setViewportSize({ width: 3840, height: 2160 });
        await open(page, '/');
        const result = await page.evaluate(() => ({
          rootFontPx: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
          overflowX: document.documentElement.scrollWidth - window.innerWidth,
          theme: document.documentElement.getAttribute('data-theme'),
        }));
        expect(result.theme).toBe(theme);
        expect(result.rootFontPx).toBeGreaterThanOrEqual(42.667 - 0.5);
        expect(result.rootFontPx).toBeLessThanOrEqual(42.667 + 0.5);
        expect(result.overflowX, 'no horizontal overflow').toBeLessThanOrEqual(0);
      });
    });
  }
});
