import { describe, expect, it } from 'vitest';
import { dayLabel, momentOf } from './labels';
import { todayIso } from './recurringLabels';

describe('dates', () => {
  it('takes a date alone as a calendar day at local noon, so it is that day wherever the viewer is', () => {
    const moment = momentOf('2026-12-02');
    expect([moment.getFullYear(), moment.getMonth(), moment.getDate(), moment.getHours()]).toEqual([2026, 11, 2, 12]);
    expect(dayLabel('2026-12-02', 'en')).toBe('Dec 2, 2026');
    expect(dayLabel('2026-12-02', 'ru')).toMatch(/2/);
    expect(dayLabel(null, 'en')).toBe('');
    expect(dayLabel('not a date', 'en')).toBe('');
  });

  it('keeps the time of a moment that has one', () => {
    expect(momentOf('2026-12-02T09:30:00Z').toISOString()).toBe('2026-12-02T09:30:00.000Z');
  });

  it('writes the local day as YYYY-MM-DD', () => {
    expect(todayIso(new Date(2026, 10, 4, 23, 59))).toBe('2026-11-04');
    expect(todayIso(new Date(2026, 0, 31, 0, 1))).toBe('2026-01-31');
  });
});
