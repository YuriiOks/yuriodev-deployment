/**
 * Small text helpers for showing posts: relative and absolute dates, a
 * post's first line, and a plain-letter summary for assistive tech.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const relative = new Intl.RelativeTimeFormat('en-GB', { numeric: 'always' });
const absolute = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const full = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeStyle: 'short' });

/**
 * "just now", "5 minutes ago", "3 hours ago", "1 day ago", "4 days ago",
 * "2 weeks ago" (elapsed time, never calendar words such as "yesterday",
 * which a count of whole days can get wrong); from 30 days on, the date itself ("24 Sept 2026"). A time in
 * the future (a clock running behind) counts as just now. Empty for an
 * invalid date.
 */
export function formatRelativeTime(iso: string, now: number): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  const ago = now - time;
  if (ago < MINUTE) return 'just now';
  if (ago < HOUR) return relative.format(-Math.floor(ago / MINUTE), 'minute');
  if (ago < DAY) return relative.format(-Math.floor(ago / HOUR), 'hour');
  if (ago < 7 * DAY) return relative.format(-Math.floor(ago / DAY), 'day');
  if (ago < 30 * DAY) return relative.format(-Math.floor(ago / (7 * DAY)), 'week');
  return absolute.format(time);
}

/** The full local date and time, for a tooltip ("24 September 2026 at 09:00"). Empty for an invalid date. */
export function formatFullDate(iso: string): string {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? '' : full.format(time);
}

/** Splits text into user-perceived characters, so a cut never lands inside an emoji. */
function graphemes(text: string): string[] {
  if (typeof Intl.Segmenter === 'function') {
    return Array.from(new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text), ({ segment }) => segment);
  }
  return Array.from(text);
}

/** At most `max` characters, ending in "…" when cut. */
export function truncate(text: string, max: number): string {
  const chars = graphemes(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('').trimEnd()}…`;
}

/** The first line that has any text, trimmed. */
export function firstLine(text: string): string {
  return text.split('\n').map((line) => line.trim()).find(Boolean) ?? '';
}

/**
 * A short plain-letter version of a post's opening, for a screen reader.
 * Posts often use styled Unicode (mathematical bold or italic letters) that
 * screen readers spell out one symbol at a time; NFKC maps those back to
 * plain letters. Only this summary is normalised: the visible text stays
 * exactly as it was written.
 */
export function accessibleSummary(text: string, max = 80): string {
  const plain = text.normalize('NFKC').replace(/\s+/g, ' ').trim();
  return truncate(plain, max);
}
