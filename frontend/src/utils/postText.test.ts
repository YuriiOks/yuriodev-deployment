import { describe, expect, it } from 'vitest';
import { accessibleSummary, firstLine, formatFullDate, formatRelativeTime, truncate } from './postText';

const NOW = Date.parse('2026-09-25T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('formatRelativeTime', () => {
  it('counts back from now in words', () => {
    expect(formatRelativeTime(ago(10 * 1000), NOW)).toBe('just now');
    expect(formatRelativeTime(ago(MIN), NOW)).toBe('1 minute ago');
    expect(formatRelativeTime(ago(5 * MIN), NOW)).toBe('5 minutes ago');
    expect(formatRelativeTime(ago(3 * HOUR + 20 * MIN), NOW)).toBe('3 hours ago');
    expect(formatRelativeTime(ago(DAY + HOUR), NOW)).toBe('1 day ago');
    expect(formatRelativeTime(ago(4 * DAY), NOW)).toBe('4 days ago');
    expect(formatRelativeTime(ago(7 * DAY), NOW)).toBe('1 week ago');
    expect(formatRelativeTime(ago(13 * DAY), NOW)).toBe('1 week ago');
    expect(formatRelativeTime(ago(15 * DAY), NOW)).toBe('2 weeks ago');
  });

  it('shows the date itself from 30 days back', () => {
    const text = formatRelativeTime('2026-06-01T12:00:00Z', NOW);
    expect(text).toMatch(/^1 June? 2026$/);
    expect(text).toBe(new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(Date.parse('2026-06-01T12:00:00Z')));
  });

  it('treats a time in the future as just now, and an invalid one as unknown', () => {
    expect(formatRelativeTime(new Date(NOW + HOUR).toISOString(), NOW)).toBe('just now');
    expect(formatRelativeTime('not a date', NOW)).toBe('');
    expect(formatFullDate('not a date')).toBe('');
  });

  it('gives the full date and time for a tooltip', () => {
    expect(formatFullDate('2026-09-24T08:00:00Z')).toMatch(/2026/);
    expect(formatFullDate('2026-09-24T08:00:00Z')).toMatch(/September/);
  });
});

describe('text helpers', () => {
  it('firstLine skips blank lines and trims', () => {
    expect(firstLine('\n\n  Hello world  \nsecond')).toBe('Hello world');
    expect(firstLine('   ')).toBe('');
  });

  it('truncate never cuts an emoji in half', () => {
    expect(truncate('short', 10)).toBe('short');
    const family = '👨‍👩‍👧';
    const cut = truncate(`ab${family}cdefgh`, 4);
    expect(cut).toBe(`ab${family}…`);
  });

  it('accessibleSummary maps styled letters to plain ones and leaves the input alone', () => {
    const styled = '𝗕𝘂𝗶𝗹𝗱𝗶𝗻𝗴 agents\n\nwith 𝘵𝘰𝘰𝘭𝘴';
    expect(accessibleSummary(styled)).toBe('Building agents with tools');
    expect(styled).toContain('𝗕');
    expect(accessibleSummary('a'.repeat(200), 20)).toHaveLength(20);
  });
});
