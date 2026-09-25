/**
 * The one source for who the site belongs to, where it links and how it is
 * navigated: identity, contact addresses, social profiles, the home page's
 * sections, the routed pages, project links and keyboard shortcuts.
 *
 * Every component, data file and the terminal reads these values from here;
 * architecture.test.ts fails if a profile URL or address is copied anywhere
 * else in src/. index.html and public/ cannot import this module, so their
 * static copies (JSON-LD sameAs, security.txt) are updated by hand.
 *
 * Pure data: no JSX, so services and data files can import it too.
 */

export const IDENTITY = {
  name: 'Yurii Oksamytnyi',
  title: 'AI/ML Systems Engineer',
  brand: 'YuriODev',
  location: 'London, UK',
  website: 'https://yuriodev.co.uk',
} as const;

/**
 * Both addresses are monitored. `personal` is the one the footer, palette,
 * terminal and privacy notice show; `contact` is the hero's "Collaborate" link.
 */
export const EMAILS = {
  personal: 'yurii.oksamytnyi@yuriodev.co.uk',
  contact: 'contact@yuriodev.co.uk',
} as const;

// ---------------------------------------------------------------------------
// Sections of the home page
// ---------------------------------------------------------------------------

export type SectionId = 'hero' | 'about' | 'timeline' | 'skills' | 'projects' | 'platform' | 'connect';

export interface SectionDef {
  readonly id: SectionId;
  /** Sidebar and command-palette name. */
  readonly label: string;
  /** Header menu name, in the terminal flag style. */
  readonly navLabel: string;
  /** Rendered only sometimes; navigation lists it only while it is on the page. */
  readonly optional?: boolean;
}

/** In DOM order on '/'. site.test.ts renders the home page and checks it. */
export const SECTIONS: readonly SectionDef[] = [
  { id: 'hero', label: 'Hero', navLabel: '--hero' },
  { id: 'about', label: 'About', navLabel: '--about' },
  { id: 'timeline', label: 'Timeline', navLabel: '--timeline' },
  { id: 'skills', label: 'Skills', navLabel: '--skills' },
  { id: 'projects', label: 'Projects', navLabel: '--projects' },
  { id: 'platform', label: 'Platform', navLabel: '--yuriodev_vision' },
  { id: 'connect', label: 'Connect', navLabel: '--connect' },
];

/** The interactive terminal inside Connect: a jump target, not a section. */
export const TERMINAL_ANCHOR = 'terminal';

export type AnchorId = SectionId | typeof TERMINAL_ANCHOR;

const SECTION_IDS: ReadonlySet<string> = new Set(SECTIONS.map(({ id }) => id));

export function isSectionId(id: string): id is SectionId {
  return SECTION_IDS.has(id);
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export type PageId = 'portfolio' | 'courses' | 'dashboard' | 'community' | 'privacy';

export interface PageDef {
  readonly id: PageId;
  readonly path: string;
  readonly navLabel: string;
  /** Listed among the header's page links. */
  readonly inNav: boolean;
}

export const PAGES: readonly PageDef[] = [
  { id: 'portfolio', path: '/', navLabel: '--portfolio', inNav: true },
  { id: 'courses', path: '/courses', navLabel: '--courses', inNav: true },
  { id: 'dashboard', path: '/dashboard', navLabel: '--dashboard', inNav: true },
  { id: 'community', path: '/community', navLabel: '--community', inNav: true },
  { id: 'privacy', path: '/privacy', navLabel: '--privacy', inNav: false },
];

export const NAV_PAGES: readonly PageDef[] = PAGES.filter((page) => page.inNav);

export function pagePath(id: PageId): string {
  return PAGES.find((page) => page.id === id)!.path;
}

/** The page at `pathname` (trailing slash ignored), if it is one of PAGES. */
export function pageAt(pathname: string): PageDef | undefined {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return PAGES.find((page) => page.path === path);
}

// ---------------------------------------------------------------------------
// Social profiles
// ---------------------------------------------------------------------------

export type SocialIcon =
  | 'linkedin' | 'x' | 'github' | 'discord' | 'medium'
  | 'instagram' | 'threads' | 'twitch' | 'patreon' | 'coffee';

export type SocialId = SocialIcon | 'github-yuriodev';

/** Where a profile is linked: footer icons, Connect buttons, palette commands, terminal `contact`. */
export type SocialPlacement = 'footer' | 'connect' | 'palette' | 'terminal';

export interface SocialDef {
  readonly id: SocialId;
  /** Accessible name and button text. */
  readonly label: string;
  /** Palette and terminal name. */
  readonly shortLabel: string;
  readonly url: string;
  readonly icon: SocialIcon;
  readonly placements: readonly SocialPlacement[];
}

/**
 * LinkedIn and X first. GitHub has two accounts: YuriiOks (personal, the
 * footer icon) and YuriODev (the course and platform; a labelled button in
 * Connect only).
 */
export const SOCIALS: readonly SocialDef[] = [
  {
    id: 'linkedin', label: 'LinkedIn', shortLabel: 'LinkedIn',
    url: 'https://www.linkedin.com/in/y-oks', icon: 'linkedin',
    placements: ['footer', 'connect', 'palette', 'terminal'],
  },
  {
    id: 'x', label: 'X (Twitter)', shortLabel: 'X',
    url: 'https://x.com/YuriODev', icon: 'x',
    placements: ['footer', 'connect', 'palette', 'terminal'],
  },
  {
    id: 'github', label: 'GitHub', shortLabel: 'GitHub',
    url: 'https://github.com/YuriiOks', icon: 'github',
    placements: ['footer', 'connect', 'palette', 'terminal'],
  },
  {
    id: 'github-yuriodev', label: 'GitHub (YuriODev)', shortLabel: 'GitHub (YuriODev)',
    url: 'https://github.com/YuriODev', icon: 'github',
    placements: ['connect'],
  },
  {
    id: 'discord', label: 'Discord Community', shortLabel: 'Discord',
    url: 'https://discord.gg/2UK3cKDd2s', icon: 'discord',
    placements: ['footer', 'connect'],
  },
  { id: 'medium', label: 'Medium', shortLabel: 'Medium', url: 'https://medium.com/@YuriODev', icon: 'medium', placements: ['footer'] },
  { id: 'instagram', label: 'Instagram', shortLabel: 'Instagram', url: 'https://www.instagram.com/yuriodev/', icon: 'instagram', placements: ['footer'] },
  { id: 'threads', label: 'Threads', shortLabel: 'Threads', url: 'https://www.threads.com/yuriodev/', icon: 'threads', placements: ['footer'] },
  { id: 'twitch', label: 'Twitch', shortLabel: 'Twitch', url: 'https://twitch.com/YuriODev', icon: 'twitch', placements: ['footer'] },
  { id: 'patreon', label: 'Patreon', shortLabel: 'Patreon', url: 'https://patreon.com/YuriODev', icon: 'patreon', placements: ['footer'] },
  { id: 'coffee', label: 'Buy Me a Coffee', shortLabel: 'Coffee', url: 'https://buymeacoffee.com/yuriodev', icon: 'coffee', placements: ['footer'] },
];

export function socialsFor(placement: SocialPlacement): readonly SocialDef[] {
  return SOCIALS.filter((social) => social.placements.includes(placement));
}

export function socialById(id: SocialId): SocialDef {
  return SOCIALS.find((social) => social.id === id)!;
}

/** A URL as people type it: no scheme, no "www.", no trailing slash ("x.com/YuriODev"). */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
}

// ---------------------------------------------------------------------------
// Project links
// ---------------------------------------------------------------------------

export const PROJECT_LINKS = {
  pythonCourse: 'https://github.com/YuriODev/Python-Course',
} as const;

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

export type ShortcutId = 'palette' | 'help' | 'next' | 'prev' | 'top' | 'bottom' | 'theme';

export interface ShortcutDef {
  readonly id: ShortcutId;
  /** KeyboardEvent.key values that trigger it. */
  readonly keys: readonly string[];
  /** Needs Ctrl (or Cmd on a Mac); every other shortcut is a single key with no modifier. */
  readonly mod?: boolean;
  /** How the help panel shows the keys. */
  readonly display: string;
  readonly label: string;
}

/** In the order the help panel lists them. */
export const SHORTCUTS: readonly ShortcutDef[] = [
  { id: 'palette', keys: ['k'], mod: true, display: 'Ctrl/Cmd + K', label: 'Command Palette' },
  { id: 'help', keys: ['?'], display: '?', label: 'Help Panel' },
  { id: 'next', keys: ['j', 'J'], display: 'J', label: 'Next Section' },
  { id: 'prev', keys: ['k', 'K'], display: 'K', label: 'Previous Section' },
  { id: 'top', keys: ['Home'], display: 'Home', label: 'Go to Top' },
  { id: 'bottom', keys: ['End'], display: 'End', label: 'Go to Bottom' },
  { id: 'theme', keys: ['t', 'T'], display: 'T', label: 'Toggle Theme' },
];

type KeyInput = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>;

/**
 * The shortcut a key press triggers, if any. A single-key shortcut never
 * fires with Ctrl, Cmd or Alt held, so Ctrl/Cmd+K is only ever the palette.
 */
export function shortcutFor(e: KeyInput): ShortcutId | null {
  const mod = e.ctrlKey || e.metaKey;
  for (const shortcut of SHORTCUTS) {
    if (!shortcut.keys.includes(e.key)) continue;
    if (shortcut.mod ? mod : !mod && !e.altKey) return shortcut.id;
  }
  return null;
}
