import AxeBuilder from '@axe-core/playwright';
import { test, expect, open } from './fixtures';

type Result = Awaited<ReturnType<AxeBuilder['analyze']>>['violations'][number];
type NodeResult = Result['nodes'][number];

/*
 * axe-core against the WCAG 2.2 AA rule set, on the home page, the privacy
 * notice and the 404 page, in both themes (the site follows the OS theme until
 * the visitor picks one). Serious and critical violations fail the test.
 */

const PAGES = [
  { name: 'home', path: '/' },
  { name: 'privacy', path: '/privacy' },
  { name: '404', path: '/no-such-page' },
];

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

type Theme = 'dark' | 'light';

interface KnownContrast {
  /** Text colour axe reports (lower-case hex). */
  readonly fg: string;
  /** Only on this background; any background when omitted. */
  readonly bg?: string;
  /** The lowest contrast ratio measured today: a lower one fails, so the list can only get better. */
  readonly minRatio: number;
  readonly reason: string;
}

/**
 * The one tolerated violation: text colours below 4.5:1 that the colour-token
 * rework replaces (it changes the look of the site, so it ships on its own,
 * after a screenshot review). Only these colours pass, and only at or above
 * their floor; a new failing colour, a listed one on a surface that makes it
 * worse, or any other rule fails the test. An entry nothing matches any more
 * fails too (see STALE_CHECK_PROJECTS), so the list is deleted as it empties.
 */
const KNOWN_LOW_CONTRAST: Readonly<Record<Theme, readonly KnownContrast[]>> = {
  dark: [
    { fg: '#6b7280', minRatio: 3.36, reason: '--text-muted: footer, achievement and roadmap captions' },
    { fg: '#008080', minRatio: 3.34, reason: '--accent-tertiary teal: featured project subtitle and tags, footer status' },
    { fg: '#026b6e', minRatio: 2.85, reason: 'teal highlights in the footer "Built with" line, dimmed by opacity' },
    { fg: '#585e6c', minRatio: 2.94, reason: 'footer "Built with" line, dimmed by opacity' },
    { fg: '#3d4555', minRatio: 1.82, reason: 'project card "Coming soon" placeholder text' },
  ],
  light: [
    { fg: '#d97706', minRatio: 2.85, reason: '--accent-secondary amber as text: CTAs, prompts, headings, footer' },
    { fg: '#ea580c', minRatio: 3.28, reason: 'orange prompts and timeline filter buttons' },
    { fg: '#ffffff', bg: '#f97316', minRatio: 2.8, reason: 'active timeline filter button, white on orange' },
    { fg: '#c2410c', minRatio: 4.44, reason: 'skill "metric" tags on their tinted background' },
    { fg: '#94a3b8', minRatio: 2.36, reason: '--text-muted: footer, dates and roadmap captions' },
    { fg: '#a9b5c6', minRatio: 2.07, reason: 'footer "Built with" line, dimmed by opacity' },
    { fg: '#2f78c1', minRatio: 4.06, reason: 'blue highlights in the footer "Built with" line' },
    { fg: '#10b981', minRatio: 2.3, reason: 'green "success" text in the hero code block and roadmap badge' },
    { fg: '#059669', minRatio: 3.4, reason: 'green terminal input and hero status value' },
    { fg: '#cad1db', minRatio: 1.5, reason: 'project card "Coming soon" placeholder text' },
  ],
};

/** Sizes at which the home page shows every listed colour: an entry unused there is stale. */
const STALE_CHECK_PROJECTS = ['375x812', '1440x900'];

/** The allow-list entry that covers this node, if any. */
function knownLowContrast(theme: Theme, rule: string, node: NodeResult): KnownContrast | undefined {
  if (rule !== 'color-contrast') return undefined;
  const data = node.any.find((check) => check.id === 'color-contrast')?.data as
    | { fgColor?: string; bgColor?: string; contrastRatio?: number }
    | undefined;
  const fg = data?.fgColor?.toLowerCase();
  const bg = data?.bgColor?.toLowerCase();
  const ratio = data?.contrastRatio ?? 0;
  return KNOWN_LOW_CONTRAST[theme].find(
    (known) => known.fg === fg && (!known.bg || known.bg === bg) && ratio >= known.minRatio,
  );
}

function blockingViolations(theme: Theme, violations: readonly Result[], used: Set<KnownContrast>) {
  return violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => ({
      rule: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes
        .filter((node) => {
          const known = knownLowContrast(theme, violation.id, node);
          if (known) used.add(known);
          return !known;
        })
        .map((node) => ({ target: node.target.join(' '), summary: node.failureSummary })),
    }))
    .filter((violation) => violation.nodes.length > 0);
}

for (const theme of ['dark', 'light'] as const) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme });

    for (const { name, path } of PAGES) {
      test(`${name} has no serious or critical axe violations`, async ({ page }, testInfo) => {
        await open(page, path);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

        const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        const used = new Set<KnownContrast>();
        const blocking = blockingViolations(theme, results.violations, used);
        expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);

        if (path === '/' && STALE_CHECK_PROJECTS.includes(testInfo.project.name)) {
          const unused = KNOWN_LOW_CONTRAST[theme]
            .filter((known) => !used.has(known))
            .map(({ fg, bg }) => (bg ? `${fg} on ${bg}` : fg));
          expect(unused, 'allow-list entries nothing matches any more: delete them').toEqual([]);
        }
      });
    }
  });
}
