import type { SpaceData, SpaceSummary, TabId } from './types';

/**
 * The entrance's counters, worked out from a space's rows. `done` holds the
 * ids the visitor has ticked off (or un-ticked) over each task's own state.
 */
export function summarize(space: SpaceData, done: Readonly<Record<string, boolean>> = {}): SpaceSummary {
  let open = 0;
  let priority = 0;
  let overdue = 0;
  for (const panel of space.panels) {
    for (const row of panel.rows) {
      if (row.kind !== 'task' || (done[row.id] ?? row.done ?? false)) continue;
      open += 1;
      if (row.priority) priority += 1;
      if (row.due?.tone === 'danger') overdue += 1;
    }
  }
  return { open, priority, overdue };
}

/** The number on a tab: its rows (tiles are not rows); the overview carries none. */
export function tabCount(space: SpaceData, tab: TabId): number {
  if (tab === 'overview') return 0;
  return space.panels.filter((panel) => panel.tab === tab).reduce((sum, panel) => sum + panel.rows.length, 0);
}
