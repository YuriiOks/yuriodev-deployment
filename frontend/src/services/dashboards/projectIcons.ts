/** The icon keys a project can carry (the server stores the key, 1 to 24 of a-z, 0-9 and "-"). Drawn in components/dashboards/ProjectIcon. */
export const PROJECT_ICON_KEYS = [
  'scales',
  'gavel',
  'bulb',
  'spark',
  'rocket',
  'home',
  'heart',
  'book',
  'briefcase',
  'globe',
  'camera',
  'code',
  'wallet',
  'plane',
  'leaf',
  'flag',
  'star',
  'shield',
] as const;

export type ProjectIconKey = (typeof PROJECT_ICON_KEYS)[number];

/** What the server accepts as an icon key. */
export const ICON_KEY_PATTERN = /^[a-z0-9-]{1,24}$/;

/** A key from the server, or null when it is missing or not a key (the tile then shows the name's letter). */
export function parseIconKey(value: unknown): string | null {
  return typeof value === 'string' && ICON_KEY_PATTERN.test(value) ? value : null;
}

/** True for a key we have a drawing for; an unknown key shows the letter instead. */
export function isProjectIconKey(value: string | null | undefined): value is ProjectIconKey {
  return value != null && (PROJECT_ICON_KEYS as readonly string[]).includes(value);
}
