import { test, expect, open } from './fixtures';

/*
 * "Fixed root, fluid headings": the root font-size scaling that used to grow
 * with the viewport above 1440px CSS width (global.css) is gone - it keyed
 * off `100vw`/`100vh`, values browser zoom itself rescales, which cancelled
 * zoom outright (see zoom.spec.ts for the zoom-emulated regression test).
 * The root now always sits at the browser default, at every window size.
 * Any growth on very large screens lives only in small, independently-capped
 * fluid type tokens on headings/hero (clamp(min rem, min + Nvw, max rem),
 * max <= 2.5x min - _variables.css, ComingSoonSection etc.), which do not
 * key off the viewport the same self-cancelling way. The content column
 * keeps to 75% of the screen up to its cap (--content-cap, a now-fixed
 * 1152px, since the root no longer grows past 16px), then stays at that cap,
 * centred - "content capped and centred" on a big monitor, not a page that
 * balloons without bound.
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
  { width: 5120, height: 1440 },
];

/** --content-cap: 72rem, at the fixed 16px root - no longer grows with the screen. */
const CONTENT_CAP_PX = 72 * 16;

test.describe('fixed root, fluid headings', () => {
  test('the root font size stays at the browser default at every width; the content column is capped and centred', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== '1920x1080', 'runs once, in the 1920x1080 project');

    for (const size of SIZES) {
      await page.setViewportSize(size);
      await open(page, '/');

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
          probeLeft: probe ? probe.getBoundingClientRect().left : null,
          railLeft: rail ? rail.getBoundingClientRect().left : null,
          railRight: rail ? rail.getBoundingClientRect().right : null,
          heroTitleTop: heroTitle ? heroTitle.getBoundingClientRect().top : null,
          heroTitleBottom: heroTitle ? heroTitle.getBoundingClientRect().bottom : null,
          cardTop: card ? card.getBoundingClientRect().top : null,
          overflowX: document.documentElement.scrollWidth - window.innerWidth,
        };
      });

      const label = `${size.width}x${size.height}`;

      // No more big-screen growth: the root stays at the browser default,
      // whatever the window size. (The zoom-emulated version of this
      // regression - what actually motivated the change - is zoom.spec.ts.)
      expect(geometry.rootFontPx, `${label}: root font-size stays at the browser default`).toBeGreaterThanOrEqual(15.5);
      expect(geometry.rootFontPx, `${label}: root font-size stays at the browser default`).toBeLessThanOrEqual(16.5);

      // --header-h is a fixed 4rem from the md breakpoint up: with the root
      // itself fixed too, the header's real height never grows past 64px.
      expect(geometry.headerHeightPx, `${label}: header height stays fixed`).toBeGreaterThanOrEqual(63);
      expect(geometry.headerHeightPx, `${label}: header height stays fixed`).toBeLessThanOrEqual(65);

      expect(geometry.probeWidthPx, `${label}: content column probe exists`).not.toBeNull();
      // Capped, not growing without bound.
      expect(geometry.probeWidthPx!, `${label}: content column stays within its cap`).toBeLessThanOrEqual(
        CONTENT_CAP_PX + 1,
      );
      if (size.width * 0.75 <= CONTENT_CAP_PX) {
        // Below the cap, the column keeps to 75% of the screen.
        const share = (geometry.probeWidthPx! / size.width) * 100;
        expect(share, `${label}: content column share of the screen`).toBeGreaterThanOrEqual(75 - 3);
        expect(share, `${label}: content column share of the screen`).toBeLessThanOrEqual(75 + 3);
      } else {
        // Past it, the column sits at its cap, centred - not stretched edge
        // to edge on an ultrawide/4K monitor.
        expect(geometry.probeWidthPx!, `${label}: content column at its cap`).toBeGreaterThanOrEqual(CONTENT_CAP_PX - 1);
        expect(geometry.probeLeft!, `${label}: content column centred`).toBeCloseTo((size.width - CONTENT_CAP_PX) / 2, 0);
      }

      // The rail: never closer than 16px to the window edge, never closer
      // than 24px to the content column - both fixed now, not scaled with
      // the screen the way they used to.
      expect(geometry.railLeft, `${label}: rail inside the window`).toBeGreaterThanOrEqual(15);
      if (geometry.probeWidthPx !== null) {
        const contentLeft = (size.width - geometry.probeWidthPx) / 2;
        expect(geometry.railRight! + 24, `${label}: rail clear of the content column`).toBeLessThanOrEqual(
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

  test('the root font size stays at 16px below 1440px wide too', async ({ page }, testInfo) => {
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

      test('the root stays fixed, and the page never overflows, at 3840x2160', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== '1920x1080', 'runs once, in the 1920x1080 project');
        await page.setViewportSize({ width: 3840, height: 2160 });
        await open(page, '/');
        const result = await page.evaluate(() => ({
          rootFontPx: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
          overflowX: document.documentElement.scrollWidth - window.innerWidth,
          theme: document.documentElement.getAttribute('data-theme'),
        }));
        expect(result.theme).toBe(theme);
        expect(result.rootFontPx).toBeCloseTo(16, 1);
        expect(result.overflowX, 'no horizontal overflow').toBeLessThanOrEqual(0);
      });
    });
  }
});
