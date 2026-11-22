import { describe, expect, it } from 'vitest';
import { SAMPLE_SPACES, SAMPLE_WEEK } from './sampleData';
import { getSpace, getWeek, listSpaces } from './source';
import { SPACES, TAB_TONE } from './spaces';
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
  it('returns the three spaces in order, and one week', () => {
    expect(listSpaces().map(({ id }) => id)).toEqual(['personal', 'work-1', 'work-2']);
    expect(SPACES.map((id) => getSpace(id).id)).toEqual([...SPACES]);
    expect(getWeek()).toBe(SAMPLE_WEEK);
  });

  it('has the tabs of each space exactly as designed', () => {
    expect(getSpace('personal').tabs).toEqual(['overview', 'areas', 'payments', 'court', 'work', 'mail', 'telegram']);
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

  it('the week has both languages, seven days and events of every space', () => {
    for (const text of localizedIn(SAMPLE_WEEK)) {
      expect(text.ru.trim()).not.toBe('');
      expect(text.en.trim()).not.toBe('');
    }
    expect(SAMPLE_WEEK.days).toHaveLength(7);
    expect(new Set(SAMPLE_WEEK.events.map((e) => e.space))).toEqual(new Set(SPACES));
    for (const event of SAMPLE_WEEK.events) {
      expect(event.day).toBeGreaterThanOrEqual(0);
      expect(event.day).toBeLessThan(7);
      expect(toMinutes(event.end), event.id).toBeGreaterThan(toMinutes(event.start));
      expect(toMinutes(event.start), event.id).toBeGreaterThanOrEqual(toMinutes(SAMPLE_WEEK.hours[0]));
      expect(toMinutes(event.end), event.id).toBeLessThanOrEqual(toMinutes(SAMPLE_WEEK.hours.at(-1)!) + 60);
    }
    const ids = SAMPLE_WEEK.events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the week exercises overlaps: a cross-space conflict, a three-way cluster, a same-space overlap and a short event', () => {
    const conflicts = findConflicts(SAMPLE_WEEK.events);
    // Tuesday: one pair; Friday: three events that all overlap, three pairs.
    expect(conflicts.count).toBe(4);
    expect(conflicts.ids.size).toBe(5);

    const day = (n: number) => SAMPLE_WEEK.events.filter((e) => e.day === n);
    expect(Math.max(...layoutDay(day(4)).map((p) => p.columns))).toBe(3);
    // Wednesday: two events of one space side by side, and neither is a conflict.
    const wednesday = layoutDay(day(2)).filter((p) => p.columns === 2);
    expect(wednesday.map((p) => p.event.space)).toEqual(['work-1', 'work-1']);
    expect(wednesday.every((p) => !conflicts.ids.has(p.event.id))).toBe(true);
    // Thursday: a 15-minute event beside an hour-long one.
    const short = SAMPLE_WEEK.events.find((e) => e.id === 'parcel-3')!;
    expect(toMinutes(short.end) - toMinutes(short.start)).toBe(15);
    expect(layoutDay(day(3)).find((p) => p.event.id === 'parcel-3')!.columns).toBe(2);
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
    expect(rows.some((r) => r.badge && r.badgeTone === 'accent')).toBe(true);
    expect(rows.some((r) => r.ref && r.refHref)).toBe(true);
    expect(rows.some((r) => r.kind === 'task' && r.priority)).toBe(true);
    const panels = SPACES.flatMap((id) => getSpace(id).panels);
    expect(panels.some((p) => p.priority)).toBe(true);
    expect(panels.some((p) => p.tiles && p.tiles.length > 0)).toBe(true);
    expect(panels.some((p) => p.showCount)).toBe(true);
    expect(panels.some((p) => p.note)).toBe(true);
  });

  it('every tab has a tone for its glyph', () => {
    for (const id of SPACES) for (const tab of getSpace(id).tabs) expect(TAB_TONE[tab]).toBeDefined();
  });

  it('keeps the sample generic: no real-looking contact detail or private reference', () => {
    const json = JSON.stringify([SAMPLE_SPACES, SAMPLE_WEEK]);
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
