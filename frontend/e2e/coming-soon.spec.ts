import { test, expect, open } from './fixtures';

/*
 * The "Planned Features" card (ComingSoonSection.featuresList) on /courses,
 * /community and /dashboard: a single-column grid at every width used to
 * leave roughly half the card as blank space from 1024px up. It should flow
 * into two or more columns once the card is wide enough to hold them.
 */

const ROUTES = ['/courses', '/community', '/dashboard'];

/** Runs in the page: the features list under the "Planned Features" heading, if any. */
function featuresList() {
  const heading = [...document.querySelectorAll('main h2')].find((h) => h.textContent?.includes('Planned Features'));
  const list = heading?.parentElement?.querySelector('ul');
  if (!list) return null;
  const items = [...list.querySelectorAll('li')];
  const tops = new Set(items.map((el) => Math.round(el.getBoundingClientRect().top)));
  return { count: items.length, rows: tops.size };
}

test.describe('coming-soon planned features', () => {
  for (const path of ROUTES) {
    test(`${path}: the features list uses more than one column from 1024px wide`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== '1920x1080', 'runs once, in the 1920x1080 project');
      for (const width of [1024, 1440, 1920, 2560]) {
        await page.setViewportSize({ width, height: 900 });
        await open(page, path);

        const geometry = await page.evaluate(featuresList);
        expect(geometry, `${path} at ${width}px: has a features list`).not.toBeNull();
        expect(geometry!.count, `${path} at ${width}px: has more than one feature item`).toBeGreaterThan(1);
        // More than one column: fewer distinct row positions than items.
        expect(geometry!.rows, `${path} at ${width}px: features flow into more than one column`).toBeLessThan(
          geometry!.count,
        );
      }
    });
  }

  test('stays a single column on a phone, where a grid would cramp it', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page, '/courses');
    const geometry = await page.evaluate(featuresList);
    expect(geometry, 'has a features list').not.toBeNull();
    expect(geometry!.rows, 'one row per item on a phone').toBe(geometry!.count);
  });
});
