import AxeBuilder from '@axe-core/playwright';
import { test, expect, open } from './fixtures';

type Result = Awaited<ReturnType<AxeBuilder['analyze']>>['violations'][number];

/*
 * axe-core against the WCAG 2.2 AA rule set, on the home page, the privacy
 * notice and the 404 page, in both themes (the site follows the OS theme until
 * the visitor picks one). Serious and critical violations fail the test,
 * colour contrast included: nothing is tolerated. The colour tokens have their
 * own contrast test (src/assets/styles/contrast.test.ts); this one catches
 * what a stylesheet does with them (opacity, tints, one-off colours).
 */

const PAGES = [
  { name: 'home', path: '/' },
  { name: 'privacy', path: '/privacy' },
  { name: '404', path: '/no-such-page' },
];

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

function blockingViolations(violations: readonly Result[]) {
  return violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => ({
      rule: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.map((node) => ({ target: node.target.join(' '), summary: node.failureSummary })),
    }));
}

for (const theme of ['dark', 'light'] as const) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme });

    for (const { name, path } of PAGES) {
      test(`${name} has no serious or critical axe violations`, async ({ page }) => {
        await open(page, path);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

        const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        const blocking = blockingViolations(results.violations);
        expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
      });
    }
  });
}
