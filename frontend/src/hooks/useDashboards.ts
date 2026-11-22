import { getCalendar, getSpace, listSpaces } from '../services/dashboards/source';
import type { CalendarData, SpaceData, SpaceId } from '../services/dashboards/types';

/*
 * What components read the dashboards' data through. Synchronous while the
 * data is a sample; when services/dashboards/source.ts calls an API, these
 * become the place that waits for it, and the components stay as they are.
 */

export function useSpaces(): readonly SpaceData[] {
  return listSpaces();
}

export function useSpace(id: SpaceId): SpaceData {
  return getSpace(id);
}

export function useCalendar(): CalendarData {
  return getCalendar();
}
