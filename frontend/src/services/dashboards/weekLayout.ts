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

export interface Stack<T extends TimeSpan> {
  /** The column the "+N" chip sits in. */
  readonly column: number;
  readonly columns: number;
  readonly startMin: number;
  readonly endMin: number;
  /** The events folded into the chip. */
  readonly hidden: readonly T[];
}

export interface Collapsed<T extends TimeSpan> {
  readonly placements: Placement<T>[];
  readonly stacks: Stack<T>[];
}

/**
 * A cluster of more than `max` side-by-side columns would leave each block a
 * few characters wide. Such a cluster keeps its first `max - 1` columns and
 * folds the rest into one "+N" stack in the last of `max` columns, spanning the
 * time of the folded events. Smaller clusters are untouched. `placed` is the
 * output of layoutDay (in start order).
 */
export function collapseColumns<T extends TimeSpan>(placed: readonly Placement<T>[], max = 3): Collapsed<T> {
  const placements: Placement<T>[] = [];
  const stacks: Stack<T>[] = [];
  let cluster: Placement<T>[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (cluster.length === 0) return;
    if (cluster[0].columns <= max) {
      placements.push(...cluster);
    } else {
      const folded = cluster.filter((p) => p.column >= max - 1);
      placements.push(...cluster.filter((p) => p.column < max - 1).map((p) => ({ ...p, columns: max })));
      stacks.push({
        column: max - 1,
        columns: max,
        startMin: Math.min(...folded.map((p) => p.startMin)),
        endMin: Math.max(...folded.map((p) => p.endMin)),
        hidden: folded.map((p) => p.event),
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
