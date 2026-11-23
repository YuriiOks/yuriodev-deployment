import { addDays } from './calendarDates';
import type { LiveArea, LiveTask } from './liveApi';

/** How many days ahead "this week" reaches (today excluded: today is "Due"). */
export const WEEK_DAYS = 7;

export interface TaskGroups {
  /** Open priority tasks, whatever their date. */
  readonly priority: readonly LiveTask[];
  /** Open tasks due today or overdue that are not already in Priority. */
  readonly due: readonly LiveTask[];
  /** Open tasks due in the next seven days. */
  readonly week: readonly LiveTask[];
  /** Open tasks due later than that. */
  readonly later: readonly LiveTask[];
  /** Open tasks with no date. */
  readonly undated: readonly LiveTask[];
  /** Done tasks, newest first: only those not kept in place (see `sticky`). */
  readonly done: readonly LiveTask[];
}

/** Priority first, then the nearest date (no date last), then the oldest: the order the API answers in. */
export function compareTasks(a: LiveTask, b: LiveTask): number {
  if (a.priority !== b.priority) return a.priority ? -1 : 1;
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

/**
 * Sorts one space's tasks into the overview's groups. A task that was completed during this visit (`sticky`) stays
 * in the group it was in, struck through, until the next load; every other done task is only in `done`.
 * Pure: `today` is "YYYY-MM-DD".
 */
export function groupTasks(tasks: readonly LiveTask[], today: string, sticky: ReadonlySet<string> = new Set()): TaskGroups {
  const horizon = addDays(today, WEEK_DAYS);
  const groups: Record<keyof TaskGroups, LiveTask[]> = { priority: [], due: [], week: [], later: [], undated: [], done: [] };
  for (const task of [...tasks].sort(compareTasks)) {
    if (task.status === 'done' && !sticky.has(task.id)) groups.done.push(task);
    else if (task.priority) groups.priority.push(task);
    else if (task.dueDate !== null && task.dueDate <= today) groups.due.push(task);
    else if (task.dueDate !== null && task.dueDate <= horizon) groups.week.push(task);
    else if (task.dueDate !== null) groups.later.push(task);
    else groups.undated.push(task);
  }
  groups.done.sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''));
  return groups;
}

/** Open tasks per life area, plus those with none under the key `''`. */
export function areaCounts(tasks: readonly LiveTask[], areas: readonly LiveArea[]): Map<string, number> {
  const counts = new Map<string, number>(areas.map((area) => [area.id, 0]));
  counts.set('', 0);
  for (const task of tasks) {
    if (task.status !== 'open') continue;
    const key = task.areaId !== null && counts.has(task.areaId) ? task.areaId : '';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** The tasks of one area (`''` is "no area"; `null` is every area). */
export function inArea(tasks: readonly LiveTask[], areaId: string | null): LiveTask[] {
  if (areaId === null) return [...tasks];
  return tasks.filter((task) => (task.areaId ?? '') === areaId);
}

/** How a due date reads on a row: overdue, today, or later (a date shown plainly). */
export function dueTone(dueDate: string | null, today: string): 'danger' | 'warn' | 'neutral' {
  if (dueDate === null) return 'neutral';
  if (dueDate < today) return 'danger';
  return dueDate === today ? 'warn' : 'neutral';
}
