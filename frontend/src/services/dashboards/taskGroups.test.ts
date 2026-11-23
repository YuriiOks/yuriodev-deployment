import { describe, expect, it } from 'vitest';
import type { LiveTask } from './liveApi';
import { areaCounts, compareTasks, dueTone, groupTasks, inArea } from './taskGroups';

const TODAY = '2026-11-23';

let n = 0;
const t = (title: string, extra: Partial<LiveTask> = {}): LiveTask => ({
  id: `id-${title}`,
  space: 'personal',
  title,
  notes: '',
  areaId: null,
  priority: false,
  dueDate: null,
  status: 'open',
  doneAt: null,
  createdAt: `2026-11-01T10:${String(n++).padStart(2, '0')}:00Z`,
  source: 'manual',
  url: null,
  ...extra,
});

const titles = (list: readonly LiveTask[]) => list.map((task) => task.title);

describe('groupTasks', () => {
  it('puts priority tasks first, whatever their date', () => {
    const groups = groupTasks([t('a', { priority: true, dueDate: '2026-12-30' }), t('b', { priority: true }), t('c')], TODAY);
    expect(titles(groups.priority)).toEqual(['a', 'b']);
    expect(titles(groups.undated)).toEqual(['c']);
  });

  it('puts due today and overdue tasks in Due, but not those already in Priority', () => {
    const groups = groupTasks(
      [t('overdue', { dueDate: '2026-11-20' }), t('today', { dueDate: TODAY }), t('prio', { dueDate: TODAY, priority: true })],
      TODAY,
    );
    expect(titles(groups.due)).toEqual(['overdue', 'today']);
    expect(titles(groups.priority)).toEqual(['prio']);
  });

  it('splits the rest into this week (the next seven days), later, and no date', () => {
    const groups = groupTasks(
      [
        t('tomorrow', { dueDate: '2026-11-24' }),
        t('in a week', { dueDate: '2026-11-30' }),
        t('in 8 days', { dueDate: '2026-12-01' }),
        t('far', { dueDate: '2027-02-01' }),
        t('someday'),
      ],
      TODAY,
    );
    expect(titles(groups.week)).toEqual(['tomorrow', 'in a week']);
    expect(titles(groups.later)).toEqual(['in 8 days', 'far']);
    expect(titles(groups.undated)).toEqual(['someday']);
  });

  it('orders a group by date (no date last), then by age, and keeps priority tasks ahead of the rest', () => {
    const groups = groupTasks([t('late', { dueDate: '2026-11-26' }), t('soon', { dueDate: '2026-11-24' }), t('first', { dueDate: '2026-11-24' })], TODAY);
    expect(titles(groups.week)).toEqual(['soon', 'first', 'late']);
    expect(compareTasks(t('x', { priority: true }), t('y', { dueDate: '2026-11-01' }))).toBeLessThan(0);
    expect(compareTasks(t('x'), t('y', { dueDate: '2026-11-01' }))).toBeGreaterThan(0);
  });

  it('keeps done tasks out of the groups, newest first, unless they were completed during this visit', () => {
    const tasks = [
      t('old', { status: 'done', doneAt: '2026-11-10T10:00:00Z', priority: true }),
      t('newer', { status: 'done', doneAt: '2026-11-20T10:00:00Z' }),
      t('just now', { status: 'done', doneAt: '2026-11-23T09:00:00Z', dueDate: TODAY }),
      t('open'),
    ];
    const plain = groupTasks(tasks, TODAY);
    expect(titles(plain.done)).toEqual(['just now', 'newer', 'old']);
    expect(titles(plain.priority)).toEqual([]);
    const sticky = groupTasks(tasks, TODAY, new Set(['id-just now']));
    expect(titles(sticky.done)).toEqual(['newer', 'old']);
    expect(titles(sticky.due)).toEqual(['just now']);
  });

  it('does not change what it is given', () => {
    const input = [t('b', { dueDate: '2026-11-30' }), t('a', { dueDate: '2026-11-24' })];
    groupTasks(input, TODAY);
    expect(titles(input)).toEqual(['b', 'a']);
  });

  it('is empty for no tasks', () => {
    const groups = groupTasks([], TODAY);
    expect(Object.values(groups).every((list) => list.length === 0)).toBe(true);
  });
});

describe('areas', () => {
  const areas = [
    { id: 'money', nameRu: 'Деньги', nameEn: 'Money' },
    { id: 'home', nameRu: 'Дом', nameEn: 'Home' },
  ];
  const tasks = [t('a', { areaId: 'money' }), t('b', { areaId: 'money' }), t('c'), t('d', { areaId: 'money', status: 'done' }), t('e', { areaId: 'gone' })];

  it('counts open tasks per area, with the ones that have none (or an unknown area) under the empty key', () => {
    const counts = areaCounts(tasks, areas);
    expect(counts.get('money')).toBe(2);
    expect(counts.get('home')).toBe(0);
    expect(counts.get('')).toBe(2);
  });

  it('filters by area: null is all, the empty string is no area', () => {
    expect(titles(inArea(tasks, null))).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(titles(inArea(tasks, 'money'))).toEqual(['a', 'b', 'd']);
    expect(titles(inArea(tasks, ''))).toEqual(['c']);
  });
});

describe('dueTone', () => {
  it('is danger before today, warn on it, and neutral after or with no date', () => {
    expect(dueTone('2026-11-22', TODAY)).toBe('danger');
    expect(dueTone(TODAY, TODAY)).toBe('warn');
    expect(dueTone('2026-11-24', TODAY)).toBe('neutral');
    expect(dueTone(null, TODAY)).toBe('neutral');
  });
});
