import { withoutCopies, type SpaceTags } from './liveEvents';
import type { LiveEvent, SummaryNext } from './liveApi';
import type { SpaceId } from './types';

const same = (event: LiveEvent, next: SummaryNext) => event.title === next.title && Date.parse(event.startsAt) === Date.parse(next.startsAt);

/**
 * What a space's next-event strip (and its hub card) shows. The server's "next event" can be a personal-calendar entry that
 * is only a copy of a work meeting ("Stand-up (Acme)"); the calendar already drops or reassigns those (`withoutCopies`), and
 * this puts the strips through the same rule, using the events of the next days:
 * - when the server's next event is one of those copies (it is in the list but does not stay with this space), it is
 *   replaced by the space's own next event from the list (or by nothing);
 * - when the list has an own next event earlier than the server's (a copy reassigned to this space), that one is shown;
 * - otherwise the server's answer stands (including when the list does not have it, e.g. it is further away).
 * `events` is null when the list could not be read: then the server's answer stands.
 */
export function resolveNext(space: SpaceId, summaryNext: SummaryNext | null, events: readonly LiveEvent[] | null, now: Date, names: SpaceTags = {}): SummaryNext | null {
  if (events === null) return summaryNext;
  const kept = withoutCopies(events, names);
  const own = kept
    .filter((event) => event.space === space && !event.busyOnly && Date.parse(event.startsAt) >= now.getTime())
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
  const ownNext: SummaryNext | null = own ? { title: own.title, startsAt: own.startsAt } : null;
  if (summaryNext && events.some((event) => same(event, summaryNext)) && !kept.some((event) => event.space === space && same(event, summaryNext))) return ownNext;
  if (ownNext && (summaryNext === null || Date.parse(ownNext.startsAt) < Date.parse(summaryNext.startsAt))) return ownNext;
  return summaryNext;
}
