import { EMAILS, TERMINAL_ANCHOR, shortcutDisplay, socialsFor, type AnchorId, type SectionDef } from '../../../data/site';

export type CommandGroup = 'Navigate' | 'Connect' | 'Settings' | 'Help';

export interface PaletteCommand {
  readonly id: string;
  readonly title: string;
  readonly group: CommandGroup;
  /** Other words that find it (a section's id, a profile's name, "dark"). */
  readonly keywords: readonly string[];
  /** Shown at the end of the row: a key, an anchor or an address. */
  readonly hint: string;
  readonly run: () => void;
}

/** What the commands do; the component supplies the real ones. */
export interface CommandActions {
  goTo: (id: AnchorId) => void;
  toggleTheme: () => void;
  showHelp: () => void;
  openExternal: (url: string) => void;
  copyEmail: () => void;
  sendEmail: () => void;
}

/** Every palette command, grouped Navigate / Settings / Help / Connect, built from data/site.ts. */
export function buildCommands(sections: readonly SectionDef[], actions: CommandActions): PaletteCommand[] {
  return [
    ...sections.map(({ id, label }) => ({
      id: `go-${id}`,
      title: `Go to ${label}`,
      group: 'Navigate' as const,
      keywords: [id, label],
      hint: `#${id}`,
      run: () => actions.goTo(id),
    })),
    {
      id: 'go-terminal',
      title: 'Go to Terminal',
      group: 'Navigate',
      keywords: [TERMINAL_ANCHOR, 'shell', 'console', 'command line'],
      hint: `#${TERMINAL_ANCHOR}`,
      run: () => actions.goTo(TERMINAL_ANCHOR),
    },
    {
      id: 'toggle-theme',
      title: 'Toggle theme',
      group: 'Settings',
      keywords: ['theme', 'dark', 'light', 'mode', 'colour', 'color'],
      hint: shortcutDisplay('theme'),
      run: actions.toggleTheme,
    },
    {
      id: 'show-help',
      title: 'Show help',
      group: 'Help',
      keywords: ['help', 'shortcuts', 'keyboard', 'keys', 'commands'],
      hint: shortcutDisplay('help'),
      run: actions.showHelp,
    },
    {
      id: 'copy-email',
      title: 'Copy email address',
      group: 'Connect',
      keywords: ['email', 'mail', 'contact', 'address', 'clipboard'],
      hint: 'copy',
      run: actions.copyEmail,
    },
    {
      id: 'send-email',
      title: 'Send email',
      group: 'Connect',
      keywords: ['email', 'mail', 'contact', 'write', EMAILS.personal],
      hint: 'mailto',
      run: actions.sendEmail,
    },
    ...socialsFor('palette').map(({ id, label, shortLabel, url }) => ({
      id: `open-${id}`,
      title: `Open ${shortLabel}`,
      group: 'Connect' as const,
      keywords: [id, label, 'profile', 'social'],
      hint: 'new tab',
      run: () => actions.openExternal(url),
    })),
  ];
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/** Match strength, best first. */
export const MatchTier = {
  exact: 5,
  prefix: 4,
  wordPrefix: 3,
  substring: 2,
  fuzzy: 1,
  none: 0,
} as const;

const isWordChar = (c: string) => /[\p{L}\p{N}]/u.test(c);

/** True when `query` appears in `text` starting at the beginning of a word. */
function startsAWord(text: string, query: string): boolean {
  for (let i = text.indexOf(query); i !== -1; i = text.indexOf(query, i + 1)) {
    if (i === 0 || !isWordChar(text[i - 1])) return true;
  }
  return false;
}

/** The query's characters appear in `text` in order (spaces in the query ignored). */
function isSubsequence(query: string, text: string): boolean {
  const wanted = query.replace(/\s+/g, '');
  if (!wanted) return false;
  let at = 0;
  for (const c of text) {
    if (c === wanted[at]) at += 1;
    if (at === wanted.length) return true;
  }
  return false;
}

/** How well `query` (already lower case and trimmed) matches `text`. */
export function matchTier(query: string, text: string): number {
  const t = text.toLowerCase();
  if (!query) return MatchTier.none;
  if (t === query) return MatchTier.exact;
  if (t.startsWith(query)) return MatchTier.prefix;
  if (startsAWord(t, query)) return MatchTier.wordPrefix;
  if (t.includes(query)) return MatchTier.substring;
  if (isSubsequence(query, t)) return MatchTier.fuzzy;
  return MatchTier.none;
}

/**
 * The commands that match `query`, best first: exact, then prefix, then the
 * start of a word, then anywhere, then the letters in order. A command's
 * title and each keyword are tried; the best counts. Equal matches keep the
 * palette's own order. An empty query lists everything.
 */
export function rankCommands<T extends Pick<PaletteCommand, 'title' | 'keywords'>>(
  commands: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return [...commands];
  return commands
    .map((command, index) => ({
      command,
      index,
      tier: Math.max(...[command.title, ...command.keywords].map((text) => matchTier(q, text))),
    }))
    .filter(({ tier }) => tier > MatchTier.none)
    .sort((a, b) => b.tier - a.tier || a.index - b.index)
    .map(({ command }) => command);
}
