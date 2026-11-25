/** The words of the "Ask Claude" card (both languages): the card, the suggested questions, the tools at work, the writes to confirm, and every refusal and failure. */
export interface AssistantStrings {
  readonly title: string;
  readonly label: string;
  readonly placeholder: string;
  readonly send: string;
  readonly stop: string;
  readonly newConversation: string;
  readonly retry: string;
  readonly limit: string;
  readonly help: string;
  readonly suggestions: { readonly personal: readonly string[]; readonly 'work-1': readonly string[]; readonly money: readonly string[] };
  readonly working: string;
  readonly tools: Readonly<Record<string, string>>;
  readonly toolOther: string;
  readonly stopped: string;
  readonly remaining: string;
  readonly stops: { readonly cap: string; readonly refused: string; readonly length: string };
  readonly problems: { readonly failed: string; readonly scope: string; readonly busy: string; readonly expired: string; readonly invalid: string };
  readonly confirm: {
    readonly title: string;
    readonly approve: string;
    readonly decline: string;
    readonly past: string;
    readonly actions: Readonly<Record<string, string>>;
    readonly actionOther: string;
    readonly about: string;
    readonly labels: Readonly<Record<string, string>>;
    readonly yes: string;
    readonly no: string;
    readonly dateTime: string;
    readonly noValue: string;
  };
}

export const ASSISTANT_RU: AssistantStrings = {
  title: 'Спросить Claude',
  label: 'Вопрос',
  placeholder: 'Что нужно сделать?',
  send: 'Отправить',
  stop: 'Остановить',
  newConversation: 'Новый разговор',
  retry: 'Повторить',
  limit: 'до {n} знаков',
  help: 'Спросите сумму, список или сравнение. Что-то менять он будет только после вашего «Да».',
  suggestions: {
    personal: ['Что просрочено?', 'Что у меня на этой неделе?', 'Добавь задачу на завтра'],
    'work-1': ['Какие ревью ждут дольше всего?', 'Что застряло в работе?', 'Какие встречи сегодня?'],
    money: ['Сколько я трачу на подписки?', 'Что спишется на этой неделе?', 'Где можно сэкономить?'],
  },
  working: 'Смотрю: {what}…',
  tools: {
    today: 'сводку страницы',
    list_tasks: 'задачи',
    list_events: 'события',
    add_task: 'новую задачу',
    update_task: 'задачу',
    complete_task: 'задачу',
    reopen_task: 'задачу',
    add_event: 'новое событие',
    finance_accounts: 'счета',
    finance_transactions: 'операции',
    finance_categories: 'траты по категориям',
    upcoming: 'ближайшие платежи',
    set_category: 'категорию операции',
    attention_action: 'то, что требует внимания',
    mark_paid: 'платёж',
  },
  toolOther: 'данные',
  stopped: 'Остановлено.',
  remaining: 'Осталось запросов сегодня: {n}',
  stops: { cap: 'На сегодня лимит исчерпан. Попробуйте завтра.', refused: 'На этот вопрос ответить не получилось.', length: 'Ответ получился слишком длинным и оборвался.' },
  problems: {
    failed: 'Не удалось получить ответ.',
    scope: 'На этой странице помощник недоступен.',
    busy: 'Предыдущий вопрос ещё обрабатывается.',
    expired: 'Время подтверждения вышло: ничего не изменено. Спросите ещё раз.',
    invalid: 'Этот вопрос не удалось отправить.',
  },
  confirm: {
    title: 'Подтвердите изменение',
    approve: 'Да, сделать',
    decline: 'Нет',
    past: 'Это событие в прошлом.',
    actions: {
      add_task: 'Добавить задачу',
      update_task: 'Изменить задачу',
      complete_task: 'Отметить задачу выполненной',
      reopen_task: 'Вернуть задачу в работу',
      add_event: 'Добавить событие',
      set_category: 'Сменить категорию операции',
      attention_snooze: 'Отложить пункт',
      attention_dismiss: 'Скрыть пункт',
      attention_restore: 'Вернуть пункт',
      attention_accept: 'Принять новую сумму',
      mark_paid: 'Отметить платёж оплаченным',
    },
    actionOther: 'Изменить данные',
    about: 'О чём: {name}',
    labels: {
      title: 'Название',
      notes: 'Заметки',
      due_date: 'Срок',
      priority: 'Приоритет',
      status: 'Состояние',
      category: 'Категория',
      was: 'Было',
      days: 'Дней',
      kind: 'Вид',
      key: 'Пункт',
      local_date: 'Дата',
      local_start: 'Начало',
      local_end: 'Конец',
      local_end_date: 'Дата конца',
    },
    yes: 'да',
    no: 'нет',
    dateTime: '{date}',
    noValue: '—',
  },
};

export const ASSISTANT_EN: AssistantStrings = {
  title: 'Ask Claude',
  label: 'Question',
  placeholder: 'What needs doing?',
  send: 'Send',
  stop: 'Stop',
  newConversation: 'New conversation',
  retry: 'Try again',
  limit: 'up to {n} characters',
  help: 'Ask for a sum, a list or a comparison. It changes nothing until you say yes.',
  suggestions: {
    personal: ['What is overdue?', 'What is on this week?', 'Add a task for tomorrow'],
    'work-1': ['Which reviews have waited longest?', 'What is stuck in progress?', 'What meetings are today?'],
    money: ['How much do I spend on subscriptions?', 'What is due this week?', 'Where can I save?'],
  },
  working: 'Looking at {what}…',
  tools: {
    today: 'the page summary',
    list_tasks: 'the tasks',
    list_events: 'the events',
    add_task: 'a new task',
    update_task: 'a task',
    complete_task: 'a task',
    reopen_task: 'a task',
    add_event: 'a new event',
    finance_accounts: 'the accounts',
    finance_transactions: 'the transactions',
    finance_categories: 'spending by category',
    upcoming: 'the upcoming payments',
    set_category: 'a transaction\'s category',
    attention_action: 'what needs attention',
    mark_paid: 'a payment',
  },
  toolOther: 'the data',
  stopped: 'Stopped.',
  remaining: 'Requests left today: {n}',
  stops: { cap: 'Today\'s limit is reached. Try again tomorrow.', refused: 'That could not be answered.', length: 'The answer ran too long and was cut off.' },
  problems: {
    failed: 'Could not get an answer.',
    scope: 'The assistant is not available on this page.',
    busy: 'The previous question is still being answered.',
    expired: 'The confirmation ran out: nothing was changed. Ask again.',
    invalid: 'That question could not be sent.',
  },
  confirm: {
    title: 'Confirm the change',
    approve: 'Yes, do it',
    decline: 'No',
    past: 'This event is in the past.',
    actions: {
      add_task: 'Add a task',
      update_task: 'Change a task',
      complete_task: 'Mark a task done',
      reopen_task: 'Reopen a task',
      add_event: 'Add an event',
      set_category: 'Change a transaction\'s category',
      attention_snooze: 'Snooze an item',
      attention_dismiss: 'Dismiss an item',
      attention_restore: 'Restore an item',
      attention_accept: 'Accept the new amount',
      mark_paid: 'Mark a payment paid',
    },
    actionOther: 'Change data',
    about: 'About: {name}',
    labels: {
      title: 'Title',
      notes: 'Notes',
      due_date: 'Due',
      priority: 'Priority',
      status: 'Status',
      category: 'Category',
      was: 'Was',
      days: 'Days',
      kind: 'Kind',
      key: 'Item',
      local_date: 'Date',
      local_start: 'Start',
      local_end: 'End',
      local_end_date: 'End date',
    },
    yes: 'yes',
    no: 'no',
    dateTime: '{date}',
    noValue: '—',
  },
};
