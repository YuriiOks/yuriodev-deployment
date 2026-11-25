/**
 * Dates and times on the dashboards, from one place: English is written the British way (day before month, 24-hour clock: "25 Nov, 02:57"),
 * Russian its own way. Nothing else formats a date with Intl directly.
 */
import type { Lang } from './types';

/** The locale a page language is written in. */
export const localeOf = (lang: string): string => (lang === 'ru' ? 'ru' : 'en-GB');

/** A date or moment in the page's language, always on a 24-hour clock. */
export function formatDate(date: Date, lang: string, options: Intl.DateTimeFormatOptions): string {
  const timed = options.hour !== undefined || options.minute !== undefined || options.timeStyle !== undefined;
  return new Intl.DateTimeFormat(localeOf(lang), timed ? { ...options, hourCycle: 'h23' } : options).format(date);
}

/** A text that starts a heading or a sentence starts with a capital (Russian month and weekday names come in lower case). */
export const capitalized = (text: string): string => (text === '' ? text : text.charAt(0).toLocaleUpperCase() + text.slice(1));

const DAY_WORDS: Readonly<Record<Lang, { today: string; yesterday: string }>> = {
  en: { today: 'today', yesterday: 'yesterday' },
  ru: { today: 'сегодня', yesterday: 'вчера' },
};

const sameDay = (a: Date, b: Date): boolean => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * When something happened, as a stamp: "today 15:32", "yesterday 08:16", else the date and time ("24 Nov, 10:30"; with the year when it is
 * not this one). `now` is the moment it is told against.
 */
export function stampLabel(date: Date, lang: Lang, now: Date = new Date()): string {
  const time = formatDate(date, lang, { hour: '2-digit', minute: '2-digit' });
  if (sameDay(date, now)) return `${DAY_WORDS[lang].today} ${time}`;
  const before = new Date(now);
  before.setDate(before.getDate() - 1);
  if (sameDay(date, before)) return `${DAY_WORDS[lang].yesterday} ${time}`;
  return formatDate(date, lang, { day: 'numeric', month: 'short', ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }), hour: '2-digit', minute: '2-digit' });
}
