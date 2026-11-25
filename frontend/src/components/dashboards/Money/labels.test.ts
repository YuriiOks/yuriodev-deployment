import { describe, expect, it } from 'vitest';
import { STRINGS } from '../../../services/dashboards/strings';
import { dayLabel, freshLabel, momentOf, monthTitle, whenLabel } from './labels';
import { dayHeading, todayIso } from './recurringLabels';

describe('dates', () => {
  it('takes a date alone as a calendar day at local noon, so it is that day wherever the viewer is', () => {
    const moment = momentOf('2026-12-02');
    expect([moment.getFullYear(), moment.getMonth(), moment.getDate(), moment.getHours()]).toEqual([2026, 11, 2, 12]);
    expect(dayLabel('2026-12-02', 'en')).toBe('2 Dec 2026');
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

  it('writes English the British way on a 24-hour clock, and puts a month name that starts a heading in capitals', () => {
    expect(whenLabel('2026-11-24T08:05:00', 'en')).toMatch(/^24 Nov,? 08:05$/);
    expect(monthTitle('2026-11', 'ru')).toBe('Ноябрь');
    expect(monthTitle('2026-11', 'en')).toBe('November');
  });

  it('tells a freshness stamp as today or yesterday, else the date', () => {
    const now = new Date('2026-11-25T12:00:00');
    expect(freshLabel('2026-11-25T08:16:00', 'en', now)).toBe('today 08:16');
    expect(freshLabel('2026-11-24T15:32:00', 'ru', now)).toBe('вчера 15:32');
    expect(freshLabel(null, 'en', now)).toBe('');
  });

  it('heads a day of upcoming payments with its weekday and date, the date after the weekday', () => {
    const r = STRINGS.en.money.rec;
    expect(dayHeading('2026-11-29', 4, 'en', r)).toMatch(/^Sun,? 29 Nov$/);
    expect(dayHeading('2026-11-20', -2, 'en', r, true)).toBe('Overdue since 20 Nov');
  });
});
