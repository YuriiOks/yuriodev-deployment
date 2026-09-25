import { describe, expect, it, vi } from 'vitest';
import { SECTIONS, socialsFor } from '../../../data/site';
import { MatchTier, buildCommands, matchTier, rankCommands, type CommandActions } from './commands';

const actions = (): CommandActions => ({
  goTo: vi.fn(),
  toggleTheme: vi.fn(),
  showHelp: vi.fn(),
  openExternal: vi.fn(),
  copyEmail: vi.fn(),
  sendEmail: vi.fn(),
});

const titles = (list: readonly { title: string }[]) => list.map(({ title }) => title);

describe('matchTier', () => {
  it.each([
    ['skills', 'Skills', MatchTier.exact],
    ['go', 'Go to Skills', MatchTier.prefix],
    ['to sk', 'Go to Skills', MatchTier.wordPrefix],
    ['skills', 'Go to Skills', MatchTier.wordPrefix],
    ['kills', 'Go to Skills', MatchTier.substring],
    ['gtsk', 'Go to Skills', MatchTier.fuzzy],
    ['xyz', 'Go to Skills', MatchTier.none],
  ])('"%s" in "%s" is tier %i', (query, text, tier) => {
    expect(matchTier(query, text)).toBe(tier);
  });
});

describe('rankCommands', () => {
  const list = [
    { title: 'Toggle theme', keywords: [] },
    { title: 'Go to Platform', keywords: [] },
    { title: 'Open X', keywords: [] },
    { title: 'Platform', keywords: [] },
    { title: 'Go to Portfolio', keywords: [] },
    { title: 'Plan a talk', keywords: [] },
  ];

  it('orders exact, then prefix, then word prefix, then substring, then fuzzy', () => {
    // exact: "Platform"; prefix: "Plan a talk" has "pla"... use a query that separates the tiers.
    const ranked = titles(rankCommands(list, 'platform'));
    expect(ranked).toEqual(['Platform', 'Go to Platform']);

    const byTier = titles(
      rankCommands(
        [
          { title: 'fuzzy: p-l-a-t in order', keywords: [] },
          { title: 'substring: xplat', keywords: [] },
          { title: 'word: the plat', keywords: [] },
          { title: 'plat prefix', keywords: [] },
          { title: 'plat', keywords: [] },
        ],
        'plat',
      ),
    );
    expect(byTier).toEqual(['plat', 'plat prefix', 'word: the plat', 'substring: xplat', 'fuzzy: p-l-a-t in order']);
  });

  it('keeps the original order among equal matches, and lists everything for an empty query', () => {
    expect(titles(rankCommands(list, 'go'))).toEqual(['Go to Platform', 'Go to Portfolio']);
    expect(titles(rankCommands(list, '  '))).toEqual(titles(list));
  });

  it('matches keywords as well as the title', () => {
    const ranked = rankCommands([{ title: 'Toggle theme', keywords: ['dark', 'light'] }], 'dark');
    expect(titles(ranked)).toEqual(['Toggle theme']);
  });

  it('drops what does not match at all', () => {
    expect(rankCommands(list, 'zzz')).toEqual([]);
  });

  it('ignores case and repeated spaces', () => {
    expect(titles(rankCommands(list, 'GO   TO   PLAT'))).toEqual(['Go to Platform']);
  });
});

describe('buildCommands', () => {
  it('has a Go to command per section in page order, then the terminal', () => {
    const commands = buildCommands(SECTIONS, actions());
    const goTo = titles(commands.filter(({ group }) => group === 'Navigate'));
    expect(goTo).toEqual([...SECTIONS.map(({ label }) => `Go to ${label}`), 'Go to Terminal']);
  });

  it('opens each palette profile, and has theme, help and email commands', () => {
    const a = actions();
    const commands = buildCommands(SECTIONS, a);
    for (const { shortLabel, url } of socialsFor('palette')) {
      const command = commands.find(({ title }) => title === `Open ${shortLabel}`)!;
      command.run();
      expect(a.openExternal).toHaveBeenCalledWith(url);
    }
    for (const title of ['Toggle theme', 'Show help', 'Copy email address', 'Send email']) {
      expect(titles(commands)).toContain(title);
    }
  });

  it('the best match for common words is the command people mean', () => {
    const commands = buildCommands(SECTIONS, actions());
    const first = (query: string) => rankCommands(commands, query)[0]?.title;
    expect(first('theme')).toBe('Toggle theme');
    expect(first('dark')).toBe('Toggle theme');
    expect(first('help')).toBe('Show help');
    expect(first('github')).toBe('Open GitHub');
    expect(first('linkedin')).toBe('Open LinkedIn');
    expect(first('x')).toBe('Open X');
    expect(first('copy')).toBe('Copy email address');
    expect(first('skills')).toBe('Go to Skills');
    expect(first('term')).toBe('Go to Terminal');
  });
});
