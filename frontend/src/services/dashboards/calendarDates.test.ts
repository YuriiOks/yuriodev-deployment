import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  dayOfMonth,
  daysInMonth,
  groupByDate,
  monthMatrix,
  monthOf,
  weekDates,
  weekStart,
  weekdayIndex,
} from './calendarDates';

describe('dates', () => {
  it('adds days across month and year ends', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDays('2026-11-23', 0)).toBe('2026-11-23');
  });

  it('numbers the weekdays from Monday', () => {
    expect(weekdayIndex('2026-11-23')).toBe(0);
    expect(weekdayIndex('2026-11-28')).toBe(5);
    expect(weekdayIndex('2026-11-29')).toBe(6);
  });

  it('finds the Monday and the seven days of a week, over a month end too', () => {
    expect(weekStart('2026-11-29')).toBe('2026-11-23');
    expect(weekStart('2026-11-23')).toBe('2026-11-23');
    expect(weekDates('2026-12-02')).toEqual([
      '2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06',
    ]);
  });

  it('knows month lengths, leap years included', () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it('moves by whole months to the first of the month, over a year end', () => {
    expect(addMonths('2026-11-23', 1)).toBe('2026-12-01');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-01');
    expect(addMonths('2027-01-31', -1)).toBe('2026-12-01');
    expect(addMonths('2026-11-23', 0)).toBe('2026-11-01');
    expect(addMonths('2026-01-10', -1)).toBe('2025-12-01');
  });

  it('reads the month and the day number', () => {
    expect(monthOf('2026-11-23')).toEqual({ year: 2026, month: 11 });
    expect(dayOfMonth('2026-11-03')).toBe(3);
  });
});

describe('monthMatrix', () => {
  const flat = (year: number, month: number) => monthMatrix(year, month).flat();

  it('a month starting on Sunday (November 2026): six weeks, six leading days, the first row holds only the 1st', () => {
    const matrix = monthMatrix(2026, 11);
    expect(matrix).toHaveLength(6);
    expect(matrix[0][0]).toEqual({ date: '2026-10-26', inMonth: false });
    expect(matrix[0][5]).toEqual({ date: '2026-10-31', inMonth: false });
    expect(matrix[0][6]).toEqual({ date: '2026-11-01', inMonth: true });
    expect(matrix[5][0]).toEqual({ date: '2026-11-30', inMonth: true });
    expect(matrix[5][1]).toEqual({ date: '2026-12-01', inMonth: false });
    expect(matrix[5][6]).toEqual({ date: '2026-12-06', inMonth: false });
  });

  it('a month starting on Monday has no leading days (June 2026: five weeks, two trailing days)', () => {
    const matrix = monthMatrix(2026, 6);
    expect(matrix).toHaveLength(5);
    expect(matrix[0][0]).toEqual({ date: '2026-06-01', inMonth: true });
    expect(matrix[4][1]).toEqual({ date: '2026-06-30', inMonth: true });
    expect(matrix[4][2]).toEqual({ date: '2026-07-01', inMonth: false });
  });

  it('a 28-day month starting on Monday is exactly four whole weeks (February 2027)', () => {
    const matrix = monthMatrix(2027, 2);
    expect(matrix).toHaveLength(4);
    expect(flat(2027, 2).every((day) => day.inMonth)).toBe(true);
  });

  it('a month starting mid-week (October 2026 starts on a Thursday): three leading days', () => {
    const matrix = monthMatrix(2026, 10);
    expect(matrix[0].map((day) => day.inMonth)).toEqual([false, false, false, true, true, true, true]);
    expect(matrix[0][0].date).toBe('2026-09-28');
  });

  it('every row is seven days, Monday first, and the days run on without a gap', () => {
    for (const [year, month] of [[2026, 11], [2026, 12], [2027, 1], [2028, 2]] as const) {
      const days = flat(year, month);
      expect(days.length % 7).toBe(0);
      days.forEach((day, i) => {
        if (i > 0) expect(day.date).toBe(addDays(days[i - 1].date, 1));
      });
      for (const row of monthMatrix(year, month)) expect(weekdayIndex(row[0].date)).toBe(0);
      expect(days.filter((day) => day.inMonth)).toHaveLength(daysInMonth(year, month));
    }
  });
});

describe('groupByDate', () => {
  it('groups by date and keeps the order inside a day', () => {
    const groups = groupByDate([
      { date: '2026-11-23', id: 'a' },
      { date: '2026-11-24', id: 'b' },
      { date: '2026-11-23', id: 'c' },
    ]);
    expect(groups.get('2026-11-23')?.map((x) => x.id)).toEqual(['a', 'c']);
    expect(groups.get('2026-11-24')?.map((x) => x.id)).toEqual(['b']);
    expect(groups.get('2026-11-25')).toBeUndefined();
  });
});
