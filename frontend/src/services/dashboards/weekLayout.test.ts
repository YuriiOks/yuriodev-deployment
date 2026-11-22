import { describe, expect, it } from 'vitest';
import { arrangeDay, summarizeHidden, findConflicts, layoutDay, overlaps, toMinutes, type DatedEvent } from './weekLayout';

const ev = (id: string, start: string, end: string) => ({ id, start, end });
const cols = (events: ReturnType<typeof ev>[]) =>
  Object.fromEntries(layoutDay(events).map((p) => [p.event.id, `${p.column}/${p.columns}`]));

describe('toMinutes and overlaps', () => {
  it('reads HH:MM as minutes since midnight', () => {
    expect(toMinutes('00:00')).toBe(0);
    expect(toMinutes('09:30')).toBe(570);
    expect(toMinutes('20:15')).toBe(1215);
  });

  it('overlapping spans overlap, touching spans do not', () => {
    expect(overlaps(ev('a', '10:00', '11:00'), ev('b', '10:30', '11:30'))).toBe(true);
    expect(overlaps(ev('a', '10:00', '12:00'), ev('b', '10:30', '11:00'))).toBe(true);
    expect(overlaps(ev('a', '10:00', '11:00'), ev('b', '11:00', '12:00'))).toBe(false);
    expect(overlaps(ev('a', '10:00', '11:00'), ev('b', '12:00', '13:00'))).toBe(false);
  });
});

describe('layoutDay', () => {
  it('no events, no placements', () => {
    expect(layoutDay([])).toEqual([]);
  });

  it('events that do not overlap each take the whole width', () => {
    expect(cols([ev('a', '09:00', '10:00'), ev('b', '11:00', '12:00'), ev('c', '15:00', '16:00')])).toEqual({
      a: '0/1',
      b: '0/1',
      c: '0/1',
    });
  });

  it('two overlapping events sit side by side, half the width each', () => {
    expect(cols([ev('a', '10:00', '11:00'), ev('b', '10:30', '11:30')])).toEqual({ a: '0/2', b: '1/2' });
  });

  it('three overlapping events share the width in thirds', () => {
    expect(cols([ev('a', '15:00', '17:00'), ev('b', '15:30', '16:30'), ev('c', '16:00', '16:45')])).toEqual({
      a: '0/3',
      b: '1/3',
      c: '2/3',
    });
  });

  it('events that only touch stay in one column at full width', () => {
    expect(cols([ev('a', '10:00', '11:00'), ev('b', '11:00', '12:00')])).toEqual({ a: '0/1', b: '0/1' });
  });

  it('a long event beside shorter ones: the short ones reuse the free column, and the cluster stays two wide', () => {
    expect(cols([ev('long', '09:00', '12:00'), ev('s1', '09:30', '10:00'), ev('s2', '10:30', '11:00')])).toEqual({
      long: '0/2',
      s1: '1/2',
      s2: '1/2',
    });
  });

  it('a 15-minute event inside a long one', () => {
    expect(cols([ev('lunch', '12:00', '13:00'), ev('quick', '12:15', '12:30')])).toEqual({ lunch: '0/2', quick: '1/2' });
  });

  it('separate clusters of one day are sized on their own', () => {
    expect(
      cols([
        ev('a', '09:00', '10:00'),
        ev('b', '09:30', '10:30'),
        ev('c', '13:00', '14:00'),
        ev('d', '14:00', '15:00'),
      ]),
    ).toEqual({ a: '0/2', b: '1/2', c: '0/1', d: '0/1' });
  });

  it('a chain (a overlaps b, b overlaps c, a and c do not) is one cluster of two columns', () => {
    expect(cols([ev('a', '09:00', '10:00'), ev('b', '09:30', '11:00'), ev('c', '10:30', '11:30')])).toEqual({
      a: '0/2',
      b: '1/2',
      c: '0/2',
    });
  });

  it('does not depend on the order it is given, and a longer event wins a tie on start', () => {
    const forward = cols([ev('a', '10:00', '11:00'), ev('b', '10:00', '12:00')]);
    const backward = cols([ev('b', '10:00', '12:00'), ev('a', '10:00', '11:00')]);
    expect(forward).toEqual({ a: '1/2', b: '0/2' });
    expect(backward).toEqual(forward);
  });

  it('reports each placement with its time in minutes', () => {
    const [placed] = layoutDay([ev('a', '10:30', '11:15')]);
    expect(placed.startMin).toBe(630);
    expect(placed.endMin).toBe(675);
  });
});

describe('findConflicts', () => {
  const dated = (id: string, day: number, start: string, end: string, space: DatedEvent['space']): DatedEvent => ({
    id,
    day,
    start,
    end,
    space,
  });

  it('flags an overlap between two spaces, both events', () => {
    const result = findConflicts([dated('a', 1, '14:00', '15:00', 'work-1'), dated('b', 1, '14:30', '15:30', 'work-2')]);
    expect(result.count).toBe(1);
    expect([...result.ids].sort()).toEqual(['a', 'b']);
  });

  it('does not flag an overlap inside one space', () => {
    const result = findConflicts([dated('a', 2, '16:00', '17:00', 'work-1'), dated('b', 2, '16:30', '17:30', 'work-1')]);
    expect(result.count).toBe(0);
    expect(result.ids.size).toBe(0);
  });

  it('does not flag events that touch, or that are on different days', () => {
    expect(
      findConflicts([dated('a', 0, '10:00', '11:00', 'personal'), dated('b', 0, '11:00', '12:00', 'work-1')]).count,
    ).toBe(0);
    expect(
      findConflicts([dated('a', 0, '10:00', '11:00', 'personal'), dated('b', 1, '10:00', '11:00', 'work-1')]).count,
    ).toBe(0);
  });

  it('three events of three spaces that all overlap make three conflicts', () => {
    const result = findConflicts([
      dated('a', 4, '15:00', '17:00', 'work-1'),
      dated('b', 4, '15:30', '16:30', 'personal'),
      dated('c', 4, '16:00', '16:45', 'work-2'),
    ]);
    expect(result.count).toBe(3);
    expect(result.ids.size).toBe(3);
  });

  it('only the events that really conflict are flagged', () => {
    const result = findConflicts([
      dated('a', 4, '09:00', '10:00', 'work-1'),
      dated('b', 4, '15:00', '16:00', 'work-1'),
      dated('c', 4, '15:30', '16:30', 'personal'),
    ]);
    expect([...result.ids].sort()).toEqual(['b', 'c']);
  });
});

describe('arrangeDay', () => {
  const arrange = (events: ReturnType<typeof ev>[]) => arrangeDay(layoutDay(events));
  const shape = (events: ReturnType<typeof ev>[]) =>
    Object.fromEntries(arrange(events).placements.map((p) => [p.event.id, `${p.level}:${p.slot}/${p.slots}`]));

  it('keeps equal columns for clusters of one and two columns', () => {
    expect(shape([ev('a', '09:00', '10:00'), ev('b', '09:30', '10:30'), ev('c', '12:00', '13:00')])).toEqual({
      a: '0:0/2',
      b: '0:1/2',
      c: '0:0/1',
    });
  });

  it('turns a cluster of three or more columns into a cascade: each later start one step further in', () => {
    const result = arrange([ev('a', '15:00', '17:00'), ev('b', '15:30', '16:30'), ev('c', '16:00', '16:45')]);
    expect(result.stacks).toEqual([]);
    expect(result.placements.map((p) => `${p.event.id} ${p.level}:${p.slot}/${p.slots}`)).toEqual(['a 0:0/1', 'b 1:0/1', 'c 2:0/1']);
  });

  it('stops indenting after four steps', () => {
    const events = ['09:00', '09:10', '09:20', '09:30', '09:40', '09:50'].map((start, i) => ev(`e${i}`, start, '12:00'));
    expect(arrange(events).placements.map((p) => p.level)).toEqual([0, 1, 2, 3, 4, 4]);
  });

  it('keeps two events that start together side by side, and folds the rest into one "+N" chip', () => {
    const events = [
      ev('a', '15:00', '17:00'),
      ev('b', '15:00', '16:30'),
      ev('c', '15:00', '16:00'),
      ev('d', '15:00', '15:45'),
      ev('e', '15:30', '16:30'),
      ev('x', '09:00', '10:00'),
    ];
    const result = arrange(events);
    const byId = Object.fromEntries(result.placements.map((p) => [p.event.id, `${p.level}:${p.slot}/${p.slots}`]));
    expect(byId).toEqual({ x: '0:0/1', a: '0:0/3', b: '0:1/3', e: '1:0/1' });
    expect(result.stacks).toHaveLength(1);
    const [stack] = result.stacks;
    expect(stack.hidden.map((e) => e.id).sort()).toEqual(['c', 'd']);
    expect([stack.level, stack.slot, stack.slots]).toEqual([0, 2, 3]);
    expect(stack.startMin).toBe(toMinutes('15:00'));
    expect(stack.endMin).toBe(toMinutes('16:00'));
  });

  it('arranges each cluster of a day on its own', () => {
    const cluster = (h: string) => [ev(`a${h}`, `${h}:00`, '23:00'), ev(`b${h}`, `${h}:10`, '23:00'), ev(`c${h}`, `${h}:20`, '23:00')];
    const events = [ev('early', '09:00', '09:30'), ...cluster('11'), ev('lunch', '23:00', '23:30')];
    const result = arrange(events);
    expect(result.placements.map((p) => p.level)).toEqual([0, 0, 1, 2, 0]);
  });
});

describe('summarizeHidden', () => {
  const dated = (id: string, date: string, start: string, end: string, space: DatedEvent['space']) => ({
    id,
    date,
    day: date,
    start,
    end,
    space,
  });

  it('counts the events on the hidden days and ignores the others', () => {
    const events = [
      dated('a', '2026-11-27', '10:00', '11:00', 'personal'),
      dated('b', '2026-11-28', '10:00', '11:00', 'personal'),
      dated('c', '2026-11-29', '10:00', '11:00', 'work-1'),
    ];
    expect(summarizeHidden(events, new Set(['2026-11-28', '2026-11-29']))).toEqual({ count: 2, conflict: false });
    expect(summarizeHidden(events, new Set())).toEqual({ count: 0, conflict: false });
  });

  it('says so when two hidden events of different spaces overlap', () => {
    const events = [dated('a', '2026-11-28', '10:00', '11:00', 'personal'), dated('b', '2026-11-28', '10:30', '11:30', 'work-1')];
    expect(summarizeHidden(events, new Set(['2026-11-28']))).toEqual({ count: 2, conflict: true });
  });
});
