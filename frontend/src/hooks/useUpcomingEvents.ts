import { useCallback } from 'react';
import { addDays } from '../services/dashboards/calendarDates';
import { localDate } from '../services/dashboards/liveTime';
import type { SummaryNext } from '../services/dashboards/liveApi';
import { resolveNext } from '../services/dashboards/nextEvents';
import type { SpaceId } from '../services/dashboards/types';
import { useLiveEvents } from './useLiveEvents';
import { useNow } from './useNow';
import { useSpaceNames } from './useSpaceNames';

/** How many days ahead the strips look for a copy of a work meeting. */
const DAYS_AHEAD = 13;

/**
 * The events of the next two weeks, and `nextFor`: a space's next event as the strips show it (the server's, put through the
 * calendar's rule for copies of work meetings: services/dashboards/nextEvents.ts). `status` is `loading` until the list is in;
 * when it could not be read the server's answer stands.
 */
export function useUpcomingEvents(enabled: boolean) {
  const now = useNow();
  const today = localDate(now);
  const { serverNameOf } = useSpaceNames();
  const events = useLiveEvents(today, addDays(today, DAYS_AHEAD), enabled);
  const nextFor = useCallback(
    (space: SpaceId, summaryNext: SummaryNext | null) =>
      resolveNext(space, summaryNext, events.status === 'error' ? null : events.events, now, { 'work-1': serverNameOf('work-1'), 'work-2': serverNameOf('work-2') }),
    [events.status, events.events, now, serverNameOf],
  );
  return { status: events.status, events: events.events, nextFor };
}
