import type { ActionVerb, Lang, Localized, SpaceId, TabId } from './types';

/** The page a document title is for. */
export type TitleKey = SpaceId | 'hub' | 'calendar';

export const LANGS: readonly Lang[] = ['ru', 'en'];
export const DEFAULT_LANG: Lang = 'ru';

/** localStorage key of the dashboards' language: the only thing this feature stores. */
export const LANG_STORAGE_KEY = 'dashboards-lang';

export function isLang(value: unknown): value is Lang {
  return value === 'ru' || value === 'en';
}

/** One text in the chosen language. */
export function pick(text: Localized, lang: Lang): string {
  return text[lang];
}

/** Every fixed text of the dashboards' interface. Sample content lives in sampleData.ts. */
export interface Strings {
  readonly navLabel: string;
  readonly backToSite: string;
  readonly themeToLight: string;
  readonly themeToDark: string;
  /** The document title of each page, before " | <name>". */
  readonly titles: Record<TitleKey, string>;
  readonly navAll: string;
  readonly navCalendar: string;
  readonly langLabel: string;
  readonly hubTitle: string;
  readonly next: string;
  /** Shown in the strip after the next event: 'then 13:00 ...'. */
  readonly thenWord: string;
  /** The page footer's source-freshness prefix. */
  readonly syncedLabel: string;
  /** The strip's countdown: {n} minutes, {h} hours; whole minutes, never seconds. */
  readonly countdownNow: string;
  readonly countdownMin: string;
  readonly countdownHour: string;
  readonly countdownHourMin: string;
  readonly statOpen: string;
  readonly statPriority: string;
  readonly statOverdue: string;
  readonly join: string;
  readonly sourcesLabel: string;
  readonly priorityRow: string;
  readonly ciPass: string;
  readonly ciFail: string;
  readonly quickAdd: string;
  readonly opensInNewTab: string;
  /** The tooltip of an action that does nothing yet (sample data). */
  readonly notConnected: string;
  readonly calendarTitle: string;
  readonly calendarCaption: string;
  readonly conflicts: string;
  /** The legend's hatched swatch: a block with no details. */
  readonly busyNoDetails: string;
  readonly workdaysOnly: string;
  /** The weekend events hidden by the working-days option, with their count as '{n}'. */
  readonly weekendHidden: string;
  readonly weekendHiddenConflict: string;
  readonly showWeekend: string;
  /** The hidden events of a crowded column: '{n} more events'. */
  readonly moreEvents: string;
  readonly conflictMark: string;
  readonly viewLabel: string;
  /** The phone's strip of the week's days above the one-day grid. */
  readonly weekDaysLabel: string;
  readonly week: string;
  readonly month: string;
  readonly monthCaption: string;
  readonly periodLabel: string;
  readonly prevDay: string;
  readonly nextDay: string;
  readonly prevWeek: string;
  readonly nextWeek: string;
  readonly prevMonth: string;
  readonly nextMonth: string;
  readonly today: string;
  /** '+{n} more' under a day with more events than chips. */
  readonly more: string;
  /** A day button's name: '{date}, events: {n}'. */
  readonly dayLabel: string;
  readonly dayConflict: string;
  /** Monday first. */
  readonly weekdaysShort: readonly string[];
  /** January first, as the title of a month. */
  readonly months: readonly string[];
  /** January first, as after a day number ('23 November'). */
  readonly monthsOf: readonly string[];
  readonly tabs: Record<TabId, string>;
  readonly actions: Record<ActionVerb, string>;
}

export const STRINGS: Record<Lang, Strings> = {
  ru: {
    navLabel: 'Дашборды',
    backToSite: 'yuriodev: на сайт',
    themeToLight: 'Включить светлую тему',
    themeToDark: 'Включить тёмную тему',
    titles: { hub: 'Дашборды', personal: 'Личное', 'work-1': 'Работа 1', 'work-2': 'Работа 2', calendar: 'Календарь' },
    navAll: 'Все',
    navCalendar: 'Календарь',
    langLabel: 'Язык',
    hubTitle: 'Дашборды',
    next: 'Дальше',
    thenWord: 'затем',
    syncedLabel: 'Синхр.:',
    countdownNow: 'сейчас',
    countdownMin: 'через {n} мин',
    countdownHour: 'через {h} ч',
    countdownHourMin: 'через {h} ч {m} мин',
    statOpen: 'открыто',
    statPriority: 'приоритет',
    statOverdue: 'просрочено',
    join: 'Подключиться',
    sourcesLabel: 'Источники',
    priorityRow: 'Приоритет',
    ciPass: 'CI проходит',
    ciFail: 'CI падает',
    quickAdd: 'Быстрое добавление',
    opensInNewTab: 'откроется в новой вкладке',
    notConnected: 'Пример: источник не подключён',
    calendarTitle: 'Календарь',
    calendarCaption: 'Неделя, события трёх пространств',
    conflicts: 'Конфликты',
    busyNoDetails: 'Занято, без деталей',
    workdaysOnly: 'Показывать только рабочие дни',
    weekendHidden: 'Скрыто событий в выходные: {n}.',
    weekendHiddenConflict: 'Среди них есть конфликт.',
    showWeekend: 'Показать выходные',
    moreEvents: 'Ещё событий: {n}',
    conflictMark: 'Конфликт: пересекается с событием другого пространства',
    viewLabel: 'Вид',
    weekDaysLabel: 'Дни недели',
    week: 'Неделя',
    month: 'Месяц',
    monthCaption: 'Месяц, события трёх пространств',
    periodLabel: 'Период',
    prevDay: 'Предыдущий день',
    nextDay: 'Следующий день',
    prevWeek: 'Предыдущая неделя',
    nextWeek: 'Следующая неделя',
    prevMonth: 'Предыдущий месяц',
    nextMonth: 'Следующий месяц',
    today: 'Сегодня',
    more: '+{n} ещё',
    dayLabel: '{date}, событий: {n}',
    dayConflict: 'есть конфликт',
    weekdaysShort: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
    months: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'],
    monthsOf: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
    tabs: {
      overview: 'Обзор',
      areas: 'Сферы',
      payments: 'Платежи',
      court: 'Суд',
      work: 'Работа и доход',
      mail: 'Почта',
      telegram: 'Telegram',
      github: 'GitHub',
      linear: 'Linear',
      slack: 'Slack',
      notion: 'Notion',
      posthog: 'PostHog',
      grafana: 'Grafana',
      meetings: 'Встречи',
      jira: 'Jira',
      teams: 'Teams',
    },
    actions: { reply: 'Ответить', ask: 'Спросить', open: 'Открыть', restore: 'Вернуть' },
  },
  en: {
    navLabel: 'Dashboards',
    backToSite: 'yuriodev: back to the site',
    themeToLight: 'Switch to light theme',
    themeToDark: 'Switch to dark theme',
    titles: { hub: 'Dashboards', personal: 'Personal', 'work-1': 'Work 1', 'work-2': 'Work 2', calendar: 'Calendar' },
    navAll: 'All',
    navCalendar: 'Calendar',
    langLabel: 'Language',
    hubTitle: 'Dashboards',
    next: 'Next',
    thenWord: 'then',
    syncedLabel: 'Synced:',
    countdownNow: 'now',
    countdownMin: 'in {n} min',
    countdownHour: 'in {h} h',
    countdownHourMin: 'in {h} h {m} min',
    statOpen: 'open',
    statPriority: 'priority',
    statOverdue: 'overdue',
    join: 'Join',
    sourcesLabel: 'Sources',
    priorityRow: 'Priority',
    ciPass: 'CI passing',
    ciFail: 'CI failing',
    quickAdd: 'Quick add',
    opensInNewTab: 'opens in a new tab',
    notConnected: 'Sample: the source is not connected',
    calendarTitle: 'Calendar',
    calendarCaption: 'Week, events of all three spaces',
    conflicts: 'Conflicts',
    busyNoDetails: 'Busy, no details',
    workdaysOnly: 'Show working days only',
    weekendHidden: 'Weekend events hidden: {n}.',
    weekendHiddenConflict: 'They include a conflict.',
    showWeekend: 'Show weekends',
    moreEvents: '{n} more events',
    conflictMark: 'Conflict: overlaps an event of another space',
    viewLabel: 'View',
    weekDaysLabel: 'Days of the week',
    week: 'Week',
    month: 'Month',
    monthCaption: 'Month, events of all three spaces',
    periodLabel: 'Period',
    prevDay: 'Previous day',
    nextDay: 'Next day',
    prevWeek: 'Previous week',
    nextWeek: 'Next week',
    prevMonth: 'Previous month',
    nextMonth: 'Next month',
    today: 'Today',
    more: '+{n} more',
    dayLabel: '{date}, events: {n}',
    dayConflict: 'has a conflict',
    weekdaysShort: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    monthsOf: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    tabs: {
      overview: 'Overview',
      areas: 'Life areas',
      payments: 'Payments',
      court: 'Court',
      work: 'Work and income',
      mail: 'Mail',
      telegram: 'Telegram',
      github: 'GitHub',
      linear: 'Linear',
      slack: 'Slack',
      notion: 'Notion',
      posthog: 'PostHog',
      grafana: 'Grafana',
      meetings: 'Meetings',
      jira: 'Jira',
      teams: 'Teams',
    },
    actions: { reply: 'Reply', ask: 'Ask', open: 'Open', restore: 'Restore' },
  },
};
