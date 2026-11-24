import { describe, expect, it } from 'vitest';
import { SAMPLE_CALENDAR, SAMPLE_SPACES, expandPatterns } from './sampleData';
import { weekDates, weekdayIndex } from './calendarDates';
import { getCalendar, getSpace, listSpaces } from './source';
import { SPACES, SPACE_MONOGRAM } from './spaces';
import { STRINGS } from './strings';
import { summarize, tabCount } from './summary';
import { findConflicts, layoutDay, toMinutes } from './weekLayout';
import type { ActionVerb, Localized, Row } from './types';

/** Every Localized in a value, wherever it sits. */
function localizedIn(value: unknown, found: Localized[] = []): Localized[] {
  if (Array.isArray(value)) {
    value.forEach((item) => localizedIn(item, found));
  } else if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.ru === 'string' && typeof record.en === 'string' && Object.keys(record).length === 2) {
      found.push(record as unknown as Localized);
    } else {
      Object.values(record).forEach((item) => localizedIn(item, found));
    }
  }
  return found;
}

const rowsOf = (space: (typeof SAMPLE_SPACES)[keyof typeof SAMPLE_SPACES]): Row[] => space.panels.flatMap((p) => [...p.rows]);

describe('the data source', () => {
  it('returns the three spaces in order, and the calendar', () => {
    expect(listSpaces().map(({ id }) => id)).toEqual(['personal', 'work-1', 'work-2']);
    expect(SPACES.map((id) => getSpace(id).id)).toEqual([...SPACES]);
    expect(getCalendar()).toBe(SAMPLE_CALENDAR);
  });

  it('has the tabs of each space exactly as designed', () => {
    expect(getSpace('personal').tabs).toEqual(['overview', 'areas', 'payments', 'work', 'mail', 'telegram']);
    expect(getSpace('work-1').tabs).toEqual(['overview', 'github', 'linear', 'slack', 'notion', 'posthog', 'grafana', 'meetings']);
    expect(getSpace('work-2').tabs).toEqual(['overview', 'github', 'jira', 'teams']);
  });
});

describe('the sample data', () => {
  it.each(SPACES)('%s: every tab has at least one panel, and every panel belongs to a tab', (id) => {
    const space = getSpace(id);
    for (const tab of space.tabs) {
      expect(space.panels.some((panel) => panel.tab === tab), `${id}/${tab}`).toBe(true);
    }
    for (const panel of space.panels) expect(space.tabs, panel.id).toContain(panel.tab);
    expect(space.tabs[0]).toBe('overview');
  });

  it.each(SPACES)('%s: ids are unique across its panels and rows', (id) => {
    const space = getSpace(id);
    const ids = [...space.panels.map((p) => p.id), ...rowsOf(space).map((r) => r.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(SPACES)('%s: every text exists in both languages', (id) => {
    const texts = localizedIn(getSpace(id));
    expect(texts.length).toBeGreaterThan(20);
    for (const text of texts) {
      expect(text.ru.trim(), JSON.stringify(text)).not.toBe('');
      expect(text.en.trim(), JSON.stringify(text)).not.toBe('');
    }
  });

  it('the calendar has both languages, valid times and events of every space', () => {
    for (const text of localizedIn(SAMPLE_CALENDAR)) {
      expect(text.ru.trim()).not.toBe('');
      expect(text.en.trim()).not.toBe('');
    }
    expect(new Set(SAMPLE_CALENDAR.events.map((e) => e.space))).toEqual(new Set(SPACES));
    const { hours } = SAMPLE_CALENDAR;
    for (const event of SAMPLE_CALENDAR.events) {
      expect(event.date, event.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(toMinutes(event.end), event.id).toBeGreaterThan(toMinutes(event.start));
      expect(toMinutes(event.start), event.id).toBeGreaterThanOrEqual(toMinutes(hours[0]));
      expect(toMinutes(event.end), event.id).toBeLessThanOrEqual(toMinutes(hours.at(-1)!) + 60);
    }
    const ids = SAMPLE_CALENDAR.events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the events are spread over the whole sample range, from patterns and one-offs', () => {
    const dates = SAMPLE_CALENDAR.events.map((e) => e.date);
    expect(dates[0] >= '2026-10-01').toBe(true);
    expect(dates.at(-1)! <= '2027-01-31').toBe(true);
    for (const month of ['2026-10', '2026-11', '2026-12', '2027-01']) {
      expect(dates.some((d) => d.startsWith(month)), month).toBe(true);
    }
    // A recurring pattern repeats on its weekdays only.
    const standups = SAMPLE_CALENDAR.events.filter((e) => e.id.startsWith('standup-'));
    expect(standups.every((e) => weekdayIndex(e.date) < 5)).toBe(true);
    expect(standups.some((e) => e.date === '2026-11-23')).toBe(true);
    expect(standups.some((e) => e.date === '2026-11-28')).toBe(false);
    // Today is a busy day: more events than a month chip row shows.
    expect(SAMPLE_CALENDAR.events.filter((e) => e.date === SAMPLE_CALENDAR.today).length).toBeGreaterThan(3);
  });

  it('expands patterns day by day', () => {
    const events = expandPatterns(
      [{ id: 'p', weekdays: [0, 2], start: '09:00', end: '10:00', title: { ru: 'а', en: 'a' }, space: 'personal' }],
      '2026-11-23',
      '2026-11-29',
    );
    expect(events.map((e) => e.id)).toEqual(['p-2026-11-23', 'p-2026-11-25']);
  });

  it('the sample week exercises overlaps: a cross-space conflict, a three-way cluster, a same-space overlap and a short event', () => {
    const week = SAMPLE_CALENDAR.events.filter((e) => weekDates(SAMPLE_CALENDAR.today).includes(e.date));
    const conflicts = findConflicts(week.map((e) => ({ ...e, day: e.date })));
    // Tuesday: one pair; Friday: three events that all overlap, three pairs.
    expect(conflicts.count).toBe(4);
    expect(conflicts.ids.size).toBe(5);

    const day = (date: string) => week.filter((e) => e.date === date);
    expect(Math.max(...layoutDay(day('2026-11-27')).map((p) => p.columns))).toBe(3);
    // Wednesday: two events of one space side by side, and neither is a conflict.
    const wednesday = layoutDay(day('2026-11-25')).filter((p) => p.columns === 2);
    expect(wednesday.map((p) => p.event.space)).toEqual(['work-1', 'work-1']);
    expect(wednesday.every((p) => !conflicts.ids.has(p.event.id))).toBe(true);
    // Thursday: a 15-minute event beside an hour-long one.
    const short = week.find((e) => e.id === 'parcel-nov-26')!;
    expect(toMinutes(short.end) - toMinutes(short.start)).toBe(15);
    expect(layoutDay(day('2026-11-26')).find((p) => p.event.id === 'parcel-nov-26')!.columns).toBe(2);
  });

  it('exercises every kind of row, badge, action, due tone, tile and panel flavour', () => {
    const rows = SPACES.flatMap((id) => rowsOf(getSpace(id)));
    expect(new Set(rows.map((r) => r.kind))).toEqual(new Set(['task', 'pr', 'info']));
    expect(new Set(rows.flatMap((r) => (r.kind === 'pr' ? [r.ci] : [])))).toEqual(new Set(['pass', 'fail']));
    const verbs: ActionVerb[] = ['reply', 'ask', 'open', 'restore'];
    expect(new Set(rows.flatMap((r) => (r.action ? [r.action.verb] : [])))).toEqual(new Set(verbs));
    expect(new Set(rows.flatMap((r) => (r.due ? [r.due.tone ?? 'neutral'] : [])))).toEqual(
      new Set(['neutral', 'warn', 'danger']),
    );
    expect(rows.some((r) => r.badge && r.badgeTone === 'danger')).toBe(true);
    expect(rows.some((r) => r.ref && r.refHref)).toBe(true);
    expect(rows.some((r) => r.kind === 'task' && r.priority)).toBe(true);
    const panels = SPACES.flatMap((id) => getSpace(id).panels);
    expect(panels.some((p) => p.priority)).toBe(true);
    expect(panels.some((p) => p.tiles && p.tiles.length > 0)).toBe(true);
    expect(panels.some((p) => p.note)).toBe(true);
  });

  it('every space has a monogram and every tab a name in both languages', () => {
    for (const id of SPACES) {
      expect(SPACE_MONOGRAM[id].ru).not.toBe('');
      for (const tab of getSpace(id).tabs) {
        expect(STRINGS.ru.tabs[tab]).toBeTruthy();
        expect(STRINGS.en.tabs[tab]).toBeTruthy();
      }
    }
  });

  it('the strip counts whole minutes and no list repeats its own title as a badge', () => {
    for (const id of SPACES) expect(Number.isInteger(getSpace(id).hero.minutesLeft)).toBe(true);
    for (const row of SPACES.flatMap((id) => rowsOf(getSpace(id)))) expect(row.badge?.en).not.toBe('Needs review');
  });

  it('keeps the sample generic: no real-looking contact detail or private reference', () => {
    const json = JSON.stringify([SAMPLE_SPACES, SAMPLE_CALENDAR]);
    expect(json).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
    expect(json).not.toMatch(/https?:\/\/(?!github\.com\/example\/)/);
  });
});

describe('summaries', () => {
  it('counts open tasks, priority tasks and overdue tasks', () => {
    const personal = summarize(getSpace('personal'));
    expect(personal.priority).toBe(3);
    expect(personal.overdue).toBe(1);
    expect(personal.open).toBeGreaterThan(personal.priority);
    expect(summarize(getSpace('work-2'))).toMatchObject({ priority: 1, overdue: 0 });
  });

  it('a ticked task leaves the counters, an un-ticked one returns', () => {
    const space = getSpace('work-1');
    const base = summarize(space);
    const ticked = summarize(space, { 'work-1-p1': true });
    expect(ticked.open).toBe(base.open - 1);
    expect(ticked.priority).toBe(base.priority - 1);
    expect(summarize(space, { 'work-1-mt1': false }).open).toBe(base.open);
  });

  it('tab counters add the rows of the tab; the overview and the tiles carry none', () => {
    const personal = getSpace('personal');
    expect(tabCount(personal, 'overview')).toBe(0);
    expect(tabCount(personal, 'telegram')).toBe(3);
    // The life-areas tab: the "Later" rows only; the tiles are not rows.
    expect(tabCount(personal, 'areas')).toBe(3);
    expect(tabCount(getSpace('work-1'), 'github')).toBe(7);
  });
});
