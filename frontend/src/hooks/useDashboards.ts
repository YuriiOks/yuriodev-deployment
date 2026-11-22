import { getSpace, getWeek, listSpaces } from '../services/dashboards/source';
import type { SpaceData, SpaceId, WeekData } from '../services/dashboards/types';

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

export function useWeek(): WeekData {
  return getWeek();
}
