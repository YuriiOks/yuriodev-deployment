import { pageAt, type PageId } from '../../data/site';
import type { DashTone, IconName, Localized, SpaceId, TabId } from './types';

/** The three spaces, in the order the entrance and the bar list them. */
export const SPACES: readonly SpaceId[] = ['personal', 'work-1', 'work-2'];

/** The visible name of each space, in both languages (read through the language context's `text()`). */
export const SPACE_NAME: Record<SpaceId, Localized> = {
  personal: { ru: 'Personal', en: 'Personal' },
  'work-1': { ru: 'Работа 1', en: 'Work 1' },
  'work-2': { ru: 'Работа 2', en: 'Work 2' },
};

/** The page each space lives on (data/site.ts holds the paths). */
export const SPACE_PAGE: Record<SpaceId, PageId> = {
  personal: 'dashboards-personal',
  'work-1': 'dashboards-work-1',
  'work-2': 'dashboards-work-2',
};

export const SPACE_ICON: Record<SpaceId, IconName> = {
  personal: 'person',
  'work-1': 'scales',
  'work-2': 'building',
};

/** The space whose page is at `pathname`; undefined on the entrance and the calendar. */
export function spaceAt(pathname: string): SpaceId | undefined {
  const id = pageAt(pathname)?.id;
  return SPACES.find((space) => SPACE_PAGE[space] === id);
}

/** The colour of each tab's glyph; the tool's own colour, from the site's hue tokens. */
export const TAB_TONE: Record<TabId, DashTone> = {
  overview: 'accent',
  areas: 'accent',
  payments: 'accent',
  court: 'accent',
  work: 'accent',
  mail: 'red',
  telegram: 'blue',
  github: 'ink',
  linear: 'violet',
  slack: 'pink',
  notion: 'ink',
  posthog: 'orange',
  grafana: 'orange',
  meetings: 'accent',
  jira: 'blue',
  teams: 'violet',
};

/** Where a tool's own page is; tabs that are not an outside tool have none. */
export const TOOL_HREF: Partial<Record<TabId, string>> = {
  github: 'https://github.com',
  linear: 'https://linear.app',
  slack: 'https://slack.com',
  notion: 'https://www.notion.so',
  posthog: 'https://posthog.com',
  grafana: 'https://grafana.com',
  jira: 'https://www.atlassian.com/software/jira',
  teams: 'https://www.microsoft.com/microsoft-teams',
  telegram: 'https://telegram.org',
  mail: 'https://mail.google.com',
};
