/** The words of the Today view of the spaces (Personal, Work 1, Work 2), in both languages: the server sends codes and facts, never sentences. */
export interface SpaceTodayStrings {
  readonly greeting: { readonly morning: string; readonly afternoon: string; readonly evening: string };
  readonly summary: { readonly personal: string; readonly work1: string; readonly work2: string; readonly empty: string; readonly next: string };
  readonly queueTitle: string;
  readonly queueAll: string;
  readonly queueEmpty: string;
  readonly oneAtATime: string;
  /** One line of fact for each reason. */
  readonly fact: {
    readonly overdue: string;
    readonly due_today: string;
    readonly priority: string;
    readonly due_soon: string;
    readonly review_waiting: string;
    readonly issue_idle: string;
    readonly urgent: string;
    readonly high: string;
  };
  readonly actions: Readonly<Record<string, string>>;
  readonly soonTitle: string;
  readonly soonLink: string;
  readonly soonEmpty: string;
  readonly chips: { readonly due: string; readonly waiting: string; readonly today: string; readonly tomorrow: string; readonly overdue: string };
  readonly hours: string;
  readonly days: string;
  readonly stats: {
    readonly open_tasks: string;
    readonly open_tasks_note: string;
    readonly closed_this_week: string;
    readonly closed_last_week: string;
    readonly review_waiting: string;
    readonly review_waiting_note: string;
    readonly review_none: string;
    readonly issues_in_progress: string;
    readonly issues_note: string;
  };
  readonly breakdown: Readonly<Record<string, { readonly title: string; readonly period: string }>>;
  readonly empty: string;
  readonly stage: Readonly<Record<string, string>>;
  readonly minutes: { readonly none: string; readonly hours: string; readonly mixed: string; readonly short: string };
  readonly insight: {
    readonly stale_area: { readonly title: string; readonly text: string };
    readonly stalled_pull_requests: { readonly title: string; readonly text: string };
    readonly freest_day: { readonly title: string; readonly text: string; readonly textFree: string };
  };
  readonly todayTitle: string;
  readonly todayLink: string;
  readonly todayEmpty: string;
  readonly busy: string;
  readonly failed: string;
}

export const SPACE_TODAY_RU: SpaceTodayStrings = {
  greeting: { morning: 'Доброе утро', afternoon: 'Добрый день', evening: 'Добрый вечер' },
  summary: {
    personal: 'Открыто задач: {open}, из них в приоритете {priority}, просрочено {overdue}.',
    work1: 'Ревью ждут: {reviews}, задач в работе: {progress}, срочных: {urgent}.',
    work2: 'Открыто задач: {open}, в приоритете {priority}.',
    empty: 'Открытых задач нет.',
    next: 'Дальше: {title}, {time}.',
  },
  queueTitle: 'Сначала это',
  queueAll: 'Все {n}',
  queueEmpty: 'Решать нечего.',
  oneAtATime: 'По одному',
  fact: {
    overdue: 'просрочено на {n} дн.',
    due_today: 'срок сегодня',
    priority: 'отмечено как приоритет',
    due_soon: 'срок {date}',
    review_waiting: 'ждёт {waited}',
    issue_idle: 'без движения {n} дн.',
    urgent: 'срочно',
    high: 'высокий приоритет',
  },
  actions: { mark_done: 'Готово', open_external: 'Открыть', snooze: 'К списку', open_task: 'Открыть', open: 'Открыть' },
  soonTitle: 'Скоро',
  soonLink: 'Весь список →',
  soonEmpty: 'Ближайших дел с датой нет.',
  chips: { due: 'срок {date}', waiting: 'ждёт {waited}', today: 'сегодня', tomorrow: 'завтра', overdue: 'просрочено' },
  hours: '{n} ч',
  days: '{n} дн.',
  stats: {
    open_tasks: 'Открытых задач',
    open_tasks_note: 'в приоритете {priority} · без даты {without} · просрочено {overdue}',
    closed_this_week: 'Закрыто на этой неделе',
    closed_last_week: 'на прошлой неделе: {n}',
    review_waiting: 'Ревью ждут',
    review_waiting_note: 'самое старое ждёт {waited}',
    review_none: 'ничего не ждёт',
    issues_in_progress: 'Задач в работе',
    issues_note: 'срочных {urgent} · высоких {high}',
  },
  breakdown: {
    open_by_area: { title: 'Открытые задачи по сферам', period: 'сейчас' },
    issues_by_stage: { title: 'Задачи по состоянию', period: 'сейчас' },
    meeting_minutes_by_day: { title: 'Встречи по дням', period: 'эта неделя' },
  },
  empty: 'Пока нечего показать.',
  stage: { started: 'В работе', unstarted: 'К работе', backlog: 'Бэклог', triage: 'Разбор', other: 'Другое' },
  minutes: { none: 'нет встреч', hours: '{h} ч', mixed: '{h} ч {m} мин', short: '{m} мин' },
  insight: {
    stale_area: { title: 'Застоялись: {area}', text: 'Задач без даты старше {days} дней: {count}. Разберите их или закройте.' },
    stalled_pull_requests: { title: 'Ваши pull request ждут', text: 'Без движения: {count}, самый старый {days} дн.' },
    freest_day: { title: 'Свободнее всего: {day}', text: 'Встреч на {day}: {minutes}.', textFree: 'Встреч на {day} нет.' },
  },
  todayTitle: 'Сегодня',
  todayLink: 'Календарь →',
  todayEmpty: 'Сегодня событий нет.',
  busy: 'Занято',
  failed: 'Не удалось загрузить часть данных.',
};

export const SPACE_TODAY_EN: SpaceTodayStrings = {
  greeting: { morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening' },
  summary: {
    personal: '{open} open tasks: {priority} priority, {overdue} overdue.',
    work1: '{reviews} reviews waiting, {progress} issues in progress, {urgent} urgent.',
    work2: '{open} open tasks, {priority} priority.',
    empty: 'No open tasks.',
    next: 'Next: {title}, {time}.',
  },
  queueTitle: 'First this',
  queueAll: 'All {n}',
  queueEmpty: 'Nothing to decide.',
  oneAtATime: 'One at a time',
  fact: {
    overdue: '{n} d overdue',
    due_today: 'due today',
    priority: 'marked as priority',
    due_soon: 'due {date}',
    review_waiting: 'waiting {waited}',
    issue_idle: 'no movement for {n} d',
    urgent: 'urgent',
    high: 'high priority',
  },
  actions: { mark_done: 'Done', open_external: 'Open', snooze: 'To the list', open_task: 'Open', open: 'Open' },
  soonTitle: 'Coming up',
  soonLink: 'Full list →',
  soonEmpty: 'Nothing dated is coming up.',
  chips: { due: 'due {date}', waiting: 'waiting {waited}', today: 'today', tomorrow: 'tomorrow', overdue: 'overdue' },
  hours: '{n} h',
  days: '{n} d',
  stats: {
    open_tasks: 'Open tasks',
    open_tasks_note: '{priority} priority · {without} without a date · {overdue} overdue',
    closed_this_week: 'Closed this week',
    closed_last_week: 'last week: {n}',
    review_waiting: 'Reviews waiting',
    review_waiting_note: 'the oldest has waited {waited}',
    review_none: 'nothing is waiting',
    issues_in_progress: 'Issues in progress',
    issues_note: '{urgent} urgent · {high} high',
  },
  breakdown: {
    open_by_area: { title: 'Open tasks by area', period: 'now' },
    issues_by_stage: { title: 'Issues by state', period: 'now' },
    meeting_minutes_by_day: { title: 'Meetings by day', period: 'this week' },
  },
  empty: 'Nothing to show yet.',
  stage: { started: 'In progress', unstarted: 'To do', backlog: 'Backlog', triage: 'Triage', other: 'Other' },
  minutes: { none: 'no meetings', hours: '{h} h', mixed: '{h} h {m} min', short: '{m} min' },
  insight: {
    stale_area: { title: 'Gone stale: {area}', text: '{count} tasks without a date are older than {days} days. Sort them out or drop them.' },
    stalled_pull_requests: { title: 'Your pull requests are waiting', text: '{count} untouched, the oldest for {days} d.' },
    freest_day: { title: 'Freest day: {day}', text: '{minutes} of meetings on {day}.', textFree: 'No meetings on {day}.' },
  },
  todayTitle: 'Today',
  todayLink: 'Calendar →',
  todayEmpty: 'No events today.',
  busy: 'Busy',
  failed: 'Part of the data could not be loaded.',
};
