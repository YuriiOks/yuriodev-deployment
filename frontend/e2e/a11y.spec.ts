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
  readonly reason: string;
}

/**
 * The one tolerated violation: text colours below 4.5:1 that the colour-token
 * rework replaces (it changes the look of the site, so it ships on its own,
 * after a screenshot review). Only these colours pass; a new failing colour,
 * or any other rule, fails the test. Delete an entry once nothing uses it.
 */
const KNOWN_LOW_CONTRAST: Readonly<Record<Theme, readonly KnownContrast[]>> = {
  dark: [
    { fg: '#6b7280', reason: '--text-muted: footer, achievement and roadmap captions (3.4-4.0:1)' },
    { fg: '#008080', reason: '--accent-tertiary teal: featured project subtitle and tags, footer status (3.3-4.0:1)' },
    { fg: '#026b6e', reason: 'teal highlights in the footer "Built with" line, dimmed by opacity (2.9:1)' },
    { fg: '#585e6c', reason: 'footer "Built with" line, dimmed by opacity (2.9:1)' },
    { fg: '#3d4555', reason: 'project card "Coming soon" placeholder text (1.8:1)' },
  ],
  light: [
    { fg: '#d97706', reason: '--accent-secondary amber as text: CTAs, prompts, headings, footer (2.8-3.2:1)' },
    { fg: '#ea580c', reason: 'orange prompts and timeline filter buttons (3.3:1)' },
    { fg: '#ffffff', bg: '#f97316', reason: 'active timeline filter button, white on orange (2.8:1)' },
    { fg: '#c2410c', reason: 'skill "metric" tags on their tinted background (4.4:1)' },
    { fg: '#94a3b8', reason: '--text-muted: footer, dates and roadmap captions (2.4-2.6:1)' },
    { fg: '#a9b5c6', reason: 'footer "Built with" line, dimmed by opacity (2.1:1)' },
    { fg: '#2f78c1', reason: 'blue highlights in the footer "Built with" line (4.1:1)' },
    { fg: '#10b981', reason: 'green "success" text in the hero code block and roadmap badge (2.3-2.5:1)' },
    { fg: '#059669', reason: 'green terminal input and hero status value (3.4-3.8:1)' },
    { fg: '#cad1db', reason: 'project card "Coming soon" placeholder text (1.5:1)' },
  ],
};

function isKnownLowContrast(theme: Theme, rule: string, node: NodeResult): boolean {
  if (rule !== 'color-contrast') return false;
  const data = node.any.find((check) => check.id === 'color-contrast')?.data as
    | { fgColor?: string; bgColor?: string }
    | undefined;
  const fg = data?.fgColor?.toLowerCase();
  const bg = data?.bgColor?.toLowerCase();
  return KNOWN_LOW_CONTRAST[theme].some((known) => known.fg === fg && (!known.bg || known.bg === bg));
}

function blockingViolations(theme: Theme, violations: readonly Result[]) {
  return violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => ({
      rule: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes
        .filter((node) => !isKnownLowContrast(theme, violation.id, node))
        .map((node) => ({ target: node.target.join(' '), summary: node.failureSummary })),
    }))
    .filter((violation) => violation.nodes.length > 0);
}

for (const theme of ['dark', 'light'] as const) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme });

    for (const { name, path } of PAGES) {
      test(`${name} has no serious or critical axe violations`, async ({ page }) => {
        await open(page, path);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

        const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        const blocking = blockingViolations(theme, results.violations);
        expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
      });
    }
  });
}
