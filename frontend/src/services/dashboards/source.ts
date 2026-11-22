import { SAMPLE_CALENDAR, SAMPLE_SPACES } from './sampleData';
import { SPACES } from './spaces';
import type { CalendarData, SpaceData, SpaceId } from './types';

/*
 * The one seam between the dashboards and their data. Components never
 * import sampleData.ts: they read through hooks/useDashboards.ts, which calls
 * these functions. To use an API instead, change what these return (and make
 * the hook wait for it); no component, type or test of a component changes.
 */

export function getSpace(id: SpaceId): SpaceData {
  return SAMPLE_SPACES[id];
}

export function listSpaces(): readonly SpaceData[] {
  return SPACES.map(getSpace);
}

export function getCalendar(): CalendarData {
  return SAMPLE_CALENDAR;
}
