import { describe, expect, it } from 'vitest';
import { capitalized, formatDate, localeOf, stampLabel } from './dateFormat';

const at = (iso: string) => new Date(iso);

describe('the dashboards date helper', () => {
  it('writes English the British way (day before month) and Russian its own way', () => {
    expect(localeOf('en')).toBe('en-GB');
    expect(localeOf('ru')).toBe('ru');
    expect(formatDate(at('2026-11-24T12:00:00'), 'en', { day: 'numeric', month: 'short', year: 'numeric' })).toBe('24 Nov 2026');
  });

  it('is always on a 24-hour clock', () => {
    expect(formatDate(at('2026-11-24T15:05:00'), 'en', { hour: '2-digit', minute: '2-digit' })).toBe('15:05');
    expect(formatDate(at('2026-11-24T02:57:00'), 'en', { hour: '2-digit', minute: '2-digit' })).toBe('02:57');
    expect(formatDate(at('2026-11-24T15:05:00'), 'ru', { hour: '2-digit', minute: '2-digit' })).toBe('15:05');
  });

  it('tells a stamp as today, yesterday or the date, in each language', () => {
    const now = at('2026-11-25T12:00:00');
    expect(stampLabel(at('2026-11-25T08:16:00'), 'en', now)).toBe('today 08:16');
    expect(stampLabel(at('2026-11-24T15:32:00'), 'en', now)).toBe('yesterday 15:32');
    expect(stampLabel(at('2026-11-20T10:30:00'), 'en', now)).toMatch(/^20 Nov,? 10:30$/);
    expect(stampLabel(at('2026-11-25T08:16:00'), 'ru', now)).toBe('сегодня 08:16');
    expect(stampLabel(at('2026-11-24T15:32:00'), 'ru', now)).toBe('вчера 15:32');
    expect(stampLabel(at('2025-12-30T10:30:00'), 'en', now)).toContain('2025');
  });

  it('capitalises what starts a heading', () => {
    expect(capitalized('ноябрь')).toBe('Ноябрь');
    expect(capitalized('')).toBe('');
  });
});
