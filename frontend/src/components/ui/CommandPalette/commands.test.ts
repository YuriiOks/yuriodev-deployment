import { describe, expect, it, vi } from 'vitest';
import { NAV_PAGES, SECTIONS, socialsFor } from '../../../data/site';
import { MatchTier, buildCommands, groupRuns, matchTier, rankCommands, type CommandActions } from './commands';

const actions = (): CommandActions => ({
  goTo: vi.fn(),
  openPage: vi.fn(),
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
    { title: 'Go to Platform', keywords: [] },
    { title: 'Platform', keywords: [] },
    { title: 'Go to Portfolio', keywords: [] },
    // Shares "pla" with Platform but matches none of the queries below.
    { title: 'Plan a talk', keywords: [] },
  ];

  it('orders exact, then prefix, then word prefix, then substring, then fuzzy', () => {
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
  it('lists its groups in one run each: Navigate, Pages, Connect, Settings, Help', () => {
    const commands = buildCommands(SECTIONS, actions());
    expect(groupRuns(commands).map(({ group }) => group)).toEqual(['Navigate', 'Pages', 'Connect', 'Settings', 'Help']);
    const runs = groupRuns(commands);
    expect(runs.reduce((n, { items }) => n + items.length, 0)).toBe(commands.length);
    expect(runs[1].start).toBe(runs[0].items.length);
  });

  it('advertises no single key while the single-key shortcuts are off', () => {
    const hint = (singleKeys: boolean, id: string) =>
      buildCommands(SECTIONS, actions(), { singleKeys }).find((command) => command.id === id)?.hint;
    expect(hint(true, 'toggle-theme')).toBe('T');
    expect(hint(true, 'show-help')).toBe('?');
    expect(hint(false, 'toggle-theme')).toBe('');
    expect(hint(false, 'show-help')).toBe('');
  });

  it('has a Go to command per section in page order, then the terminal', () => {
    const commands = buildCommands(SECTIONS, actions());
    const goTo = titles(commands.filter(({ group }) => group === 'Navigate'));
    expect(goTo).toEqual([...SECTIONS.map(({ label }) => `Go to ${label}`), 'Go to Terminal']);
  });

  it('opens every page the header lists, the More menu\'s pages included', () => {
    const a = actions();
    const pages = buildCommands(SECTIONS, a).filter(({ group }) => group === 'Pages');
    expect(titles(pages)).toEqual(NAV_PAGES.map(({ label }) => `Go to ${label} page`));
    for (const path of ['/courses', '/dashboard', '/community']) {
      pages.find(({ hint }) => hint === path)!.run();
      expect(a.openPage).toHaveBeenCalledWith(path);
    }
    const first = (query: string) => rankCommands(buildCommands(SECTIONS, a), query)[0]?.title;
    expect(first('courses')).toBe('Go to Courses page');
    expect(first('dashboard')).toBe('Go to Dashboard page');
    expect(first('community')).toBe('Go to Community page');
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
