import { pageAt, type PageId } from '../../data/site';
import type { Localized, SpaceId } from './types';

/** The three spaces, in the order the entrance and the bar list them. */
export const SPACES: readonly SpaceId[] = ['personal', 'work-1', 'work-2'];

/** The visible name of each space, in both languages (read through the language context's `text()`). */
export const SPACE_NAME: Record<SpaceId, Localized> = {
  personal: { ru: 'Личное', en: 'Personal' },
  'work-1': { ru: 'Работа 1', en: 'Work 1' },
  'work-2': { ru: 'Работа 2', en: 'Work 2' },
};

/** The page each space lives on (data/site.ts holds the paths). */
export const SPACE_PAGE: Record<SpaceId, PageId> = {
  personal: 'dashboards-personal',
  'work-1': 'dashboards-work-1',
  'work-2': 'dashboards-work-2',
};

/** The letter or digit of a space's 24px tile (the one place the space's fill shows beside its name). */
export const SPACE_MONOGRAM: Record<SpaceId, Localized> = {
  personal: { ru: 'Л', en: 'P' },
  'work-1': { ru: '1', en: '1' },
  'work-2': { ru: '2', en: '2' },
};

/** Pages that belong to a space without being its page (the personal Money page wears the personal skin). */
const SUBPAGE_SPACE: Partial<Record<PageId, SpaceId>> = { 'dashboards-money': 'personal' };

/** The space whose page is at `pathname`; undefined on the entrance and the calendar. */
export function spaceAt(pathname: string): SpaceId | undefined {
  const id = pageAt(pathname)?.id;
  return SPACES.find((space) => SPACE_PAGE[space] === id) ?? (id ? SUBPAGE_SPACE[id] : undefined);
}
