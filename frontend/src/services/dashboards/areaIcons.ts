import type { DrawnIconName } from '../../components/dashboards/ProjectIcon/iconPaths';

/**
 * The drawing for each life area, by its id (the ten ids of the backend's catalog), from the same hand-made set as the
 * project icons. An id that is not here (a new area) gets the neutral dot, so a new area never breaks the list.
 */
export const AREA_ICON: Readonly<Record<string, DrawnIconName>> = {
  money: 'wallet',
  'work-income': 'briefcase',
  'court-paperwork': 'scales',
  'health-sport': 'heart-pulse',
  romantic: 'heart',
  friends: 'people',
  family: 'house-heart',
  travel: 'plane',
  home: 'home',
  'hobbies-growth': 'sprout',
};

/** The drawing for an area id: its own, or the dot. */
export function areaIconName(id: string | null | undefined): DrawnIconName {
  return id != null && Object.prototype.hasOwnProperty.call(AREA_ICON, id) ? AREA_ICON[id] : 'dot';
}
