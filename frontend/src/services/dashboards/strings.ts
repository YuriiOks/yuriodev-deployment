import type { ActionVerb, Lang, Localized, TabId } from './types';

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
  readonly navAll: string;
  readonly navCalendar: string;
  readonly langLabel: string;
  readonly hubTitle: string;
  readonly hubLead: string;
  readonly next: string;
  readonly open: string;
  readonly inWord: string;
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
  readonly calendarTitle: string;
  readonly calendarLead: string;
  readonly calendarNote: string;
  readonly calendarCaption: string;
  readonly conflicts: string;
  readonly noConflicts: string;
  readonly conflictMark: string;
  readonly viewLabel: string;
  readonly week: string;
  readonly month: string;
  readonly monthCaption: string;
  readonly periodLabel: string;
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
    navAll: 'Все',
    navCalendar: 'Календарь',
    langLabel: 'Язык',
    hubTitle: 'Дашборды',
    hubLead:
      'Три отдельных пространства. Задачи, встречи и напоминания между ними не смешиваются: здесь только вход и счётчики.',
    next: 'Дальше',
    open: 'Открыть',
    inWord: 'через',
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
    calendarTitle: 'Календарь',
    calendarLead:
      'Единственная страница, где личное, «Работа 1» и «Работа 2» стоят на одной сетке. Задачи сюда не попадают, только события.',
    calendarNote:
      'Личное событие в рабочее время уходит в рабочий календарь блоком «Focus time» без подробностей.',
    calendarCaption: 'Неделя, события трёх пространств',
    conflicts: 'Конфликты',
    noConflicts: 'Конфликтов нет',
    conflictMark: 'Конфликт: пересекается с событием другого пространства',
    viewLabel: 'Вид',
    week: 'Неделя',
    month: 'Месяц',
    monthCaption: 'Месяц, события трёх пространств',
    periodLabel: 'Период',
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
    navAll: 'All',
    navCalendar: 'Calendar',
    langLabel: 'Language',
    hubTitle: 'Dashboards',
    hubLead:
      'Three separate spaces. Tasks, meetings and reminders never mix between them: this page is only the entrance and the counters.',
    next: 'Next',
    open: 'Open',
    inWord: 'in',
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
    calendarTitle: 'Calendar',
    calendarLead:
      'The one page where personal, Work 1 and Work 2 share a grid. No tasks here, only events.',
    calendarNote:
      'A personal event during working hours goes to the work calendar as a "Focus time" block with no details.',
    calendarCaption: 'Week, events of all three spaces',
    conflicts: 'Conflicts',
    noConflicts: 'No conflicts',
    conflictMark: 'Conflict: overlaps an event of another space',
    viewLabel: 'View',
    week: 'Week',
    month: 'Month',
    monthCaption: 'Month, events of all three spaces',
    periodLabel: 'Period',
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
