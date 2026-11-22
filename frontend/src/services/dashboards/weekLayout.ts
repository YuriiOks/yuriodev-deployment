import type { SpaceId } from './types';

/** A start and an end as "HH:MM" on the same day. */
export interface TimeSpan {
  readonly start: string;
  readonly end: string;
}

/** Minutes since midnight of "HH:MM". */
export function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/** The end in minutes, never before the start, so a zero-length event still has a width in time. */
function endOf(span: TimeSpan): number {
  return Math.max(toMinutes(span.end), toMinutes(span.start) + 1);
}

/** Whether two spans share any time. Spans that only touch (one ends as the other starts) do not overlap. */
export function overlaps(a: TimeSpan, b: TimeSpan): boolean {
  return toMinutes(a.start) < endOf(b) && toMinutes(b.start) < endOf(a);
}

export interface Placement<T extends TimeSpan> {
  readonly event: T;
  readonly startMin: number;
  readonly endMin: number;
  /** The event's column inside its cluster, from 0. */
  readonly column: number;
  /** How many columns its cluster has: every event of the cluster takes 1/columns of the width. */
  readonly columns: number;
}

/**
 * Lays out one day's events as an interval graph, the way a calendar does.
 * Sort by start (longer first on a tie); put each event in the first column
 * whose last event has already ended; events that overlap one another, directly
 * or through a chain, form a cluster and share the width of the day equally.
 * Events that merely touch are not overlapping and may share a column.
 */
export function layoutDay<T extends TimeSpan>(events: readonly T[]): Placement<T>[] {
  const items = events
    .map((event) => ({ event, startMin: toMinutes(event.start), endMin: endOf(event) }))
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  const placed: Placement<T>[] = [];
  let cluster: Array<{ item: (typeof items)[number]; column: number }> = [];
  let columnEnds: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    const columns = columnEnds.length;
    for (const { item, column } of cluster) placed.push({ ...item, column, columns });
    cluster = [];
    columnEnds = [];
    clusterEnd = -Infinity;
  };

  for (const item of items) {
    if (item.startMin >= clusterEnd) flush();
    let column = columnEnds.findIndex((end) => end <= item.startMin);
    if (column === -1) column = columnEnds.length;
    columnEnds[column] = item.endMin;
    cluster.push({ item, column });
    clusterEnd = Math.max(clusterEnd, item.endMin);
  }
  flush();
  return placed;
}

export interface DatedEvent extends TimeSpan {
  readonly id: string;
  /** The day it is on: its date, or its column number; two events are on the same day when these are equal. */
  readonly day: string | number;
  readonly space: SpaceId;
}

export interface Conflicts {
  /** Every event that overlaps an event of another space. */
  readonly ids: ReadonlySet<string>;
  /** Overlapping pairs from different spaces (three events that all overlap make three). */
  readonly count: number;
}

/**
 * The conflicts of a week: events of different spaces on the same day that
 * overlap in time. Overlaps inside one space are laid out side by side but
 * are not conflicts.
 */
export function findConflicts(events: readonly DatedEvent[]): Conflicts {
  const ids = new Set<string>();
  let count = 0;
  events.forEach((a, i) => {
    for (const b of events.slice(i + 1)) {
      if (a.day !== b.day || a.space === b.space || !overlaps(a, b)) continue;
      ids.add(a.id);
      ids.add(b.id);
      count += 1;
    }
  });
  return { ids, count };
}

/** Events of one start minute that stay side by side in a crowded cluster; the rest fold into a "+N" chip. */
const SIMULTANEOUS = 2;

/** A crowded cluster (this many columns or more) is laid out as a cascade instead of equal columns. */
const CASCADE_FROM = 3;

/** The cascade stops indenting after this many steps, so the last blocks still have a readable width. */
const MAX_LEVEL = 4;

export interface Arranged<T extends TimeSpan> extends Placement<T> {
  /** The indent step of the block (0 is flush left): each later start of a crowded cluster sits one step further in. */
  readonly level: number;
  /** Its slot among the blocks that share its indent and start, and how many slots that row has. */
  readonly slot: number;
  readonly slots: number;
}

export interface Stack<T extends TimeSpan> {
  readonly level: number;
  readonly slot: number;
  readonly slots: number;
  readonly startMin: number;
  readonly endMin: number;
  /** The events folded into the chip. */
  readonly hidden: readonly T[];
}

export interface Arrangement<T extends TimeSpan> {
  readonly placements: Arranged<T>[];
  readonly stacks: Stack<T>[];
}

/**
 * How a day's blocks are drawn. A cluster of one or two columns keeps what layoutDay made: equal columns side by
 * side (level 0). A cluster of three or more would leave each block a few characters wide, so it becomes a
 * cascade: sorted by start, each later start is indented one step (a quarter of a rem) further in, takes the
 * rest of the width and stacks above the earlier ones; blocks that start in the same minute stay side by side,
 * two at most, and any more fold into one "+N" chip beside them. `placed` is layoutDay's output (in start order).
 */
export function arrangeDay<T extends TimeSpan>(placed: readonly Placement<T>[]): Arrangement<T> {
  const placements: Arranged<T>[] = [];
  const stacks: Stack<T>[] = [];
  let cluster: Placement<T>[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (cluster.length === 0) return;
    if (cluster[0].columns < CASCADE_FROM) {
      placements.push(...cluster.map((p) => ({ ...p, level: 0, slot: p.column, slots: p.columns })));
    } else {
      const starts = [...new Set(cluster.map((p) => p.startMin))];
      starts.forEach((start, index) => {
        const level = Math.min(index, MAX_LEVEL);
        const group = cluster.filter((p) => p.startMin === start);
        const shown = group.slice(0, SIMULTANEOUS);
        const folded = group.slice(SIMULTANEOUS);
        const slots = shown.length + (folded.length > 0 ? 1 : 0);
        shown.forEach((p, slot) => placements.push({ ...p, level, slot, slots }));
        if (folded.length > 0) {
          stacks.push({
            level,
            slot: shown.length,
            slots,
            startMin: start,
            endMin: Math.max(...folded.map((p) => p.endMin)),
            hidden: folded.map((p) => p.event),
          });
        }
      });
    }
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const p of placed) {
    if (p.startMin >= clusterEnd) flush();
    cluster.push(p);
    clusterEnd = Math.max(clusterEnd, p.endMin);
  }
  flush();
  return { placements, stacks };
}

export interface HiddenSummary {
  /** How many events are on the hidden days. */
  readonly count: number;
  /** Whether two of them, of different spaces, overlap. */
  readonly conflict: boolean;
}

/** What a filtered-out set of days holds: how many events, and whether any of them conflict. */
export function summarizeHidden(events: readonly (DatedEvent & { readonly date: string })[], hiddenDates: ReadonlySet<string>): HiddenSummary {
  const hidden = events.filter((event) => hiddenDates.has(event.date));
  return { count: hidden.length, conflict: findConflicts(hidden).count > 0 };
}
