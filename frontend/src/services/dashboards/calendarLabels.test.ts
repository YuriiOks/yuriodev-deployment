import { describe, expect, it } from 'vitest';
import { dateLabel, fill, monthTitle, weekRangeLabel, countdownLabel } from './calendarLabels';
import { STRINGS } from './strings';

describe('calendar labels', () => {
  it('names a date, a week and a month in both languages', () => {
    expect(dateLabel('2026-11-23', STRINGS.ru)).toBe('23 ноября');
    expect(dateLabel('2026-11-23', STRINGS.en)).toBe('23 November');
    expect(weekRangeLabel('2026-11-25', STRINGS.ru)).toBe('23–29 ноября');
    expect(weekRangeLabel('2026-11-25', STRINGS.en)).toBe('23–29 November');
    expect(monthTitle('2026-11-23', STRINGS.ru)).toBe('Ноябрь 2026');
    expect(monthTitle('2027-01-05', STRINGS.en)).toBe('January 2027');
  });

  it('a week across two months names both', () => {
    expect(weekRangeLabel('2026-12-02', STRINGS.en)).toBe('30 November – 6 December');
    expect(weekRangeLabel('2026-12-31', STRINGS.ru)).toBe('28 декабря – 3 января');
  });

  it('fills placeholders and leaves unknown ones alone', () => {
    expect(fill('{date}, events: {n}', { date: '23 November', n: 5 })).toBe('23 November, events: 5');
    expect(fill('{missing}', {})).toBe('{missing}');
  });

  it('the countdown is whole minutes, hours from 60, "now" under one', () => {
    expect(countdownLabel(47, STRINGS.en)).toBe('in 47 min');
    expect(countdownLabel(47, STRINGS.ru)).toBe('через 47 мин');
    expect(countdownLabel(80, STRINGS.en)).toBe('in 1 h 20 min');
    expect(countdownLabel(120, STRINGS.en)).toBe('in 2 h');
    expect(countdownLabel(527, STRINGS.ru)).toBe('через 8 ч 47 мин');
    expect(countdownLabel(0.4, STRINGS.en)).toBe('now');
    expect(countdownLabel(0, STRINGS.ru)).toBe('сейчас');
    expect(countdownLabel(-5, STRINGS.en)).toBe('now');
  });
});
