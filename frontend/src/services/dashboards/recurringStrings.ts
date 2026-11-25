import type { AttentionKind, Frequency, RecurringKind } from './recurringApi';

/** The words of the recurring payments, upcoming payments, attention and debts parts of the Money page (both languages). */
export interface RecurringStrings {
  readonly attentionTitle: string;
  readonly attentionFailed: string;
  readonly hiddenCount: string;
  readonly showHidden: string;
  readonly hideHidden: string;
  readonly sentence: Readonly<Record<AttentionKind, string>>;
  readonly sentenceShort: string;
  readonly groupTitle: Readonly<Record<AttentionKind, string>>;
  readonly fact: Readonly<Record<AttentionKind, string>>;
  readonly accept: string;
  readonly more: string;
  readonly snoozeItem: string;
  readonly acceptAll: string;
  readonly snoozeAll: string;
  readonly dismissAll: string;
  readonly confirmDismiss: string;
  readonly confirmYes: string;
  readonly showAllN: string;
  readonly showFewer: string;
  readonly bulkFailed: string;
  readonly hiddenTitle: string;
  readonly debtsSummary: string;
  readonly debtsShow: string;
  readonly debtsHide: string;
  readonly debtsFailed: string;
  readonly setLimit: string;
  readonly fLimit: string;
  readonly saveLimit: string;
  readonly limitInvalid: string;
  readonly attentionNone: string;
  readonly rowLabel: string;
  readonly rowAll: string;
  readonly scrollLeft: string;
  readonly scrollRight: string;
  readonly severityWord: Readonly<Record<'high' | 'medium' | 'info', string>>;
  readonly card: Readonly<Record<AttentionKind, string>>;
  readonly sheetClose: string;
  readonly sheetLabel: string;
  readonly detail: {
    readonly concerns: string;
    readonly amount: string;
    readonly original: string;
    readonly priority: string;
    readonly due: string;
    readonly shortBy: string;
    readonly overdueDays: string;
    readonly lastPaid: string;
    readonly recorded: string;
    readonly charged: string;
    readonly difference: string;
    readonly paidOn: string;
    readonly used: string;
    readonly owed: string;
    readonly limit: string;
    readonly balance: string;
    readonly overdraftLimit: string;
    readonly overBy: string;
    readonly since: string;
    readonly asOf: string;
    readonly daysOld: string;
    readonly hoursOld: string;
    readonly dataAsOf: string;
    readonly none: string;
  };
  readonly acceptCharged: string;
  readonly uploadStatement: string;
  readonly snoozeHeading: string;
  readonly viewsLabel: string;
  readonly viewOverview: string;
  readonly viewAttention: string;
  readonly viewRecurring: string;
  readonly estimateMark: string;
  readonly scheduledRemaining: string;
  readonly debtsKnown: string;
  readonly debtsNextSoonest: string;
  readonly wasDue: string;
  readonly seenOf: string;
  readonly scheduleUnclear: string;
  readonly aboveOriginal: string;
  readonly truth: {
    readonly confirmed: string;
    readonly confirmedOn: string;
    readonly noneSeen: string;
    readonly unchecked: string;
  };
  readonly endedMark: string;
  readonly endedTitle: string;
  readonly endedList: string;
  readonly scheduleProgress: string;
  readonly scheduleProgressNone: string;
  readonly confirmedOfTotal: string;
  readonly dueSplit: {
    readonly confirmed: string;
    readonly noneSeen: string;
    readonly unchecked: string;
  };
  readonly dueWhen: { readonly today: string; readonly tomorrow: string; readonly inDays: string };
  readonly markPaid: string;
  readonly openPayment: string;
  readonly openBank: string;
  readonly snoozeFor: string;
  readonly snooze: string;
  readonly snoozeDays: string;
  readonly dismiss: string;
  readonly restore: string;
  readonly snoozedUntil: string;
  readonly dismissed: string;
  readonly actionFailed: string;
  readonly alreadyMoved: string;
  readonly noDataSentence: string;
  readonly noDataFact: string;
  /** When an item's facts cannot be told in words: the page's own line, never the server's English title. */
  readonly needsLook: string;
  readonly needsLookShort: string;
  readonly unnamed: string;
  readonly upcomingTitle: string;
  readonly upcomingFailed: string;
  readonly upcomingNone: string;
  readonly windowLabel: string;
  readonly windowDays: string;
  readonly today: string;
  readonly tomorrow: string;
  readonly kinds: Readonly<Record<RecurringKind, string>>;
  readonly frequencies: Readonly<Record<Frequency, string>>;
  readonly everyN: string;
  readonly covered: string;
  readonly short: string;
  /** Said once under the payments when one of them is not covered: what the shortfall counts. */
  readonly shortNote: string;
  readonly ofWhich: string;
  readonly showMoreN: string;
  readonly dueRange: string;
  readonly shortTotal: string;
  readonly overdue: string;
  readonly overdueSince: string;
  readonly notCovered: string;
  readonly coverUnknown: string;
  readonly paidFrom: string;
  readonly dueTotals: string;
  readonly dueGrand: string;
  readonly dueIncomplete: string;
  readonly allRecurring: string;
  readonly debtsTitle: string;
  readonly remaining: string;
  readonly installmentsDone: string;
  readonly repaidOf: string;
  readonly nextPayment: string;
  readonly creditor: string;
  readonly noNextDate: string;
  readonly managerTitle: string;
  readonly managerFailed: string;
  readonly backToMoney: string;
  readonly searchPayments: string;
  readonly kindFilter: string;
  readonly allKinds: string;
  readonly showInactive: string;
  readonly paymentCount: string;
  readonly add: string;
  readonly edit: string;
  readonly save: string;
  readonly cancel: string;
  readonly deactivate: string;
  readonly rowActions: string;
  readonly sortLabel: string;
  readonly sortNext: string;
  readonly sortName: string;
  readonly activate: string;
  readonly inactive: string;
  readonly noMatches: string;
  readonly noneYet: string;
  readonly clearFilters: string;
  readonly fName: string;
  readonly fAmount: string;
  readonly fCurrency: string;
  readonly fKind: string;
  readonly fFrequency: string;
  readonly fEvery: string;
  readonly fNextDate: string;
  readonly fAccount: string;
  readonly noAccount: string;
  readonly fMethod: string;
  readonly fMatch: string;
  readonly fWebsite: string;
  readonly websiteHint: string;
  readonly refreshIcon: string;
  readonly iconPending: string;
  readonly iconFailed: string;
  readonly uploadIcon: string;
  readonly iconReason: Readonly<Record<string, string>>;
  readonly iconUploadErrors: { readonly type: string; readonly size: string; readonly invalid: string; readonly failed: string };
  readonly matchHint: string;
  readonly invalidAmount: string;
  readonly invalidDate: string;
  readonly saveFailed: string;
  readonly saveRefused: string;
  readonly notLinked: string;
}

export const RECURRING_RU: RecurringStrings = {
  attentionTitle: 'Требует внимания',
  attentionFailed: 'Не удалось загрузить, что требует внимания.',
  hiddenCount: 'Скрыто: {n}',
  showHidden: 'Показать скрытые',
  hideHidden: 'Убрать скрытые',
  sentence: {
    due_not_covered: '{name}: срок {when} ({amount}), а на счёте для оплаты не хватает {short}.',
    missed_payment: '{name}: срок был {days} дн. назад ({amount}), подходящей операции нет.',
    amount_changed: '{name}: списали {charged} вместо записанных {recorded}.',
    credit_high: '{name}: использовано {percent}% лимита ({owed} из {limit}).',
    overdraft: '{name}: превышен овердрафт на {over}.',
    overdrawn: '{name}: в минусе на {over}, лимит овердрафта не задан.',
    reconsent: 'Подключение {bank} нужно подтвердить заново.',
    stale_statement: 'Данные {bank} устарели: последние на {date} ({days} дн. назад).',
    stale_connection: 'Баланс {bank} не обновлялся {hours} ч (последнее чтение {date}).',
  },
  sentenceShort: '{name}: срок {when} ({amount}), счёта для оплаты не хватает на всё.',
  groupTitle: { overdraft: 'Овердрафт', overdrawn: 'В минусе, лимит не задан', due_not_covered: 'Скоро платёж, денег не хватит', missed_payment: 'Пропущенные платежи', reconsent: 'Нужно подтвердить подключение', credit_high: 'Карты у лимита', stale_statement: 'Устаревшие данные', stale_connection: 'Банк давно не читался', amount_changed: 'Изменилась сумма' },
  fact: {
    due_not_covered: '{amount} {when} · не хватает {short}',
    missed_payment: '{amount} · просрочка {days} дн.',
    amount_changed: '{charged}, записано {recorded}',
    credit_high: '{percent}% лимита',
    overdraft: 'сверх овердрафта {over}',
    overdrawn: 'в минусе на {over} · лимит не задан',
    reconsent: 'подтвердите доступ заново',
    stale_statement: 'на {date} · {days} дн. назад',
    stale_connection: 'не читался {hours} ч',
  },
  accept: 'Принять',
  more: 'Ещё: {name}',
  snoozeItem: 'Отложить на {n} дн.',
  acceptAll: 'Принять списанные суммы',
  snoozeAll: 'Отложить все на 7 дн.',
  dismissAll: 'Скрыть все',
  confirmDismiss: 'Скрыть все ({n})?',
  confirmYes: 'Да, скрыть',
  showAllN: 'Показать все ({n})',
  showFewer: 'Показать меньше',
  bulkFailed: 'Не всё получилось: {n}. Повторите.',
  hiddenTitle: 'Скрытые',
  debtsSummary: '{n} · осталось {amount}',
  debtsShow: 'Показать',
  debtsHide: 'Свернуть',
  debtsFailed: 'Не удалось загрузить долги.',
  setLimit: 'Задать лимит',
  fLimit: 'Лимит овердрафта ({currency})',
  saveLimit: 'Сохранить лимит',
  limitInvalid: 'Введите сумму вроде 500',
  attentionNone: 'Ничего не требует внимания.',
  rowLabel: 'Требует внимания · {n}',
  rowAll: 'Все {n}',
  scrollLeft: 'Прокрутить влево',
  scrollRight: 'Прокрутить вправо',
  severityWord: { high: 'Срочно', medium: 'Скоро', info: 'К сведению' },
  card: {
    due_not_covered: '{when}, не хватает {short}',
    missed_payment: 'просрочка {days} дн., {amount}',
    amount_changed: '{charged}, было {recorded}',
    credit_high: '{percent}% лимита',
    overdraft: 'сверх овердрафта {over}',
    overdrawn: 'в минусе, лимит не задан',
    reconsent: 'подтвердите доступ заново',
    stale_statement: 'на {date}, {days} дн. назад',
    stale_connection: 'не читался {hours} ч',
  },
  sheetClose: 'Закрыть',
  sheetLabel: 'Подробности: {name}',
  detail: {
    concerns: 'Касается',
    amount: 'Сумма',
    original: 'В исходной валюте',
    priority: 'Важность',
    due: 'Срок',
    shortBy: 'Не хватает',
    overdueDays: 'Дней просрочки',
    lastPaid: 'Последняя оплата',
    recorded: 'Записано',
    charged: 'Списано',
    difference: 'Разница',
    paidOn: 'Списание',
    used: 'Использовано',
    owed: 'Долг',
    limit: 'Лимит',
    balance: 'Баланс',
    overdraftLimit: 'Лимит овердрафта',
    overBy: 'Сверх лимита',
    since: 'С',
    asOf: 'Данные на',
    daysOld: 'Дней назад',
    hoursOld: 'Часов без чтения',
    dataAsOf: 'Данные банка на',
    none: 'не задан',
  },
  acceptCharged: 'Принять списанную сумму',
  uploadStatement: 'Загрузить выписку',
  snoozeHeading: 'Отложить на',
  viewsLabel: 'Разделы денег',
  viewOverview: 'Обзор',
  viewAttention: 'Внимание',
  viewRecurring: 'Регулярные платежи',
  estimateMark: 'оценка',
  scheduledRemaining: 'по графику около {amount} (оценка)',
  debtsKnown: 'с известным остатком: {known} из {n}',
  debtsNextSoonest: 'ближайший: {date} · {amount}',
  wasDue: 'Срок был {date}',
  seenOf: 'в банке видно: {m} из последних {c}',
  scheduleUnclear: 'график неясен',
  aboveOriginal: 'остаток больше первоначальной суммы',
  truth: {
    confirmed: 'подтверждено банком',
    confirmedOn: 'подтверждено банком · последний {date}',
    noneSeen: 'списаний не видно',
    unchecked: 'из вашего списка, не проверено',
  },
  endedMark: 'закончился по графику',
  endedTitle: 'Закончились по графику',
  endedList: 'Закончились по графику: {n}',
  scheduleProgress: 'по графику {scheduled} из {total} · подтверждено банком: {done}',
  scheduleProgressNone: 'по графику {scheduled} из {total} · банком не подтверждено',
  confirmedOfTotal: 'подтверждено банком {done} из {total}',
  dueSplit: {
    confirmed: 'Подтверждено банком: {amount}',
    noneSeen: 'Списаний не видно: {amount}',
    unchecked: 'Из вашего списка, не проверено: {amount}',
  },
  dueWhen: { today: 'сегодня', tomorrow: 'завтра', inDays: 'через {n} дн.' },
  markPaid: 'Отметить оплаченным',
  openPayment: 'Открыть платёж',
  openBank: 'Открыть банк',
  snoozeFor: 'Отложить на',
  snooze: 'Отложить',
  snoozeDays: '{n} дн.',
  dismiss: 'Скрыть',
  restore: 'Вернуть',
  snoozedUntil: 'отложено до {date}',
  dismissed: 'скрыто',
  actionFailed: 'Не получилось. Повторите.',
  alreadyMoved: 'Платёж уже изменился: данные обновлены, проверьте ещё раз.',
  noDataSentence: 'По {bank} данных ещё нет: задайте баланс или загрузите выписку.',
  noDataFact: 'данных ещё нет',
  needsLook: '{name}: требует внимания',
  needsLookShort: 'требует внимания',
  unnamed: 'Этот пункт',
  upcomingTitle: 'Ближайшие платежи',
  upcomingFailed: 'Не удалось загрузить ближайшие платежи.',
  upcomingNone: 'В ближайшие {days} дн. платежей нет.',
  windowLabel: 'Период',
  windowDays: '{n} дней',
  today: 'Сегодня',
  tomorrow: 'Завтра',
  kinds: { subscription: 'подписка', debt: 'долг', utility: 'коммунальные', insurance: 'страховка', housing: 'жильё', service: 'услуга', one_time: 'разовый' },
  frequencies: { once: 'один раз', daily: 'ежедневно', weekly: 'еженедельно', monthly: 'ежемесячно', yearly: 'ежегодно' },
  everyN: '{label}, каждые {n}',
  covered: 'хватает',
  short: 'на счёте не хватит {amount} к этому дню',
  shortNote: 'Считаются и более ранние платежи с того же счёта; доходы не предполагаются.',
  ofWhich: 'в том числе',
  showMoreN: 'Показать ещё {n}',
  dueRange: '{from} – {to}',
  shortTotal: 'на счёте с учётом других платежей не хватает {amount}',
  overdue: 'Просрочено',
  overdueSince: 'Просрочено с {date}',
  notCovered: 'не хватает средств',
  coverUnknown: 'неизвестно, хватит ли',
  paidFrom: 'со счёта {account}',
  dueTotals: 'К оплате за период',
  dueGrand: 'Всего',
  dueIncomplete: 'Валюты без курса в общий итог не вошли.',
  allRecurring: 'Все регулярные платежи',
  debtsTitle: 'Долги и рассрочки',
  remaining: 'Осталось',
  installmentsDone: 'Выплачено {done} из {total} платежей',
  repaidOf: 'Погашено {paid} из {total}',
  nextPayment: 'Следующий: {date}',
  creditor: 'Кредитор: {name}',
  noNextDate: 'даты следующего платежа нет',
  managerTitle: 'Регулярные платежи',
  managerFailed: 'Не удалось загрузить платежи.',
  backToMoney: 'Назад к деньгам',
  searchPayments: 'Поиск платежей',
  kindFilter: 'Вид',
  allKinds: 'Все виды',
  showInactive: 'Показать неактивные',
  paymentCount: 'Платежей: {n}',
  add: 'Добавить платёж',
  edit: 'Изменить',
  save: 'Сохранить',
  cancel: 'Отмена',
  deactivate: 'Отключить',
  rowActions: 'Действия: {name}',
  sortLabel: 'Порядок',
  sortNext: 'По дате платежа',
  sortName: 'По названию',
  activate: 'Включить',
  inactive: 'неактивен',
  noMatches: 'Ничего не найдено.',
  noneYet: 'Регулярных платежей пока нет. Добавьте первый.',
  clearFilters: 'Сбросить фильтры',
  fName: 'Название',
  fAmount: 'Сумма',
  fCurrency: 'Валюта',
  fKind: 'Вид',
  fFrequency: 'Как часто',
  fEvery: 'Каждые',
  fNextDate: 'Дата следующего платежа',
  fAccount: 'Счёт для оплаты',
  noAccount: 'Нет (способ оплаты текстом)',
  fMethod: 'Способ оплаты',
  fMatch: 'Текст в операции',
  fWebsite: 'Сайт',
  websiteHint: 'Адрес вроде example.com: сервер найдёт там значок платежа',
  refreshIcon: 'Обновить значок',
  iconPending: 'Значок ищется…',
  iconFailed: 'Значок не нашёлся',
  uploadIcon: 'Загрузить значок',
  iconReason: {
    not_public: 'сайт недоступен для проверки (адрес не публичный)',
    timeout: 'сайт не ответил вовремя',
    blocked_status_403: 'сайт закрыл доступ',
    too_large: 'файл слишком большой',
    not_an_image: 'это не картинка',
    unsafe_svg: 'небезопасный SVG',
    bitmap_ico: 'значок .ico без PNG внутри',
    no_icon_found: 'на сайте значок не найден',
    other: 'причина неизвестна',
  },
  iconUploadErrors: { type: 'Нужен файл PNG или SVG.', size: 'Файл больше 256 КБ.', invalid: 'Файл не подходит как значок.', failed: 'Не удалось загрузить значок.' },
  matchHint: 'Что содержит текст операции в банке, если это не название',
  invalidAmount: 'Введите сумму вроде 12.99',
  invalidDate: 'Дата в виде ГГГГ-ММ-ДД',
  saveFailed: 'Не удалось сохранить. Повторите.',
  saveRefused: 'Не удалось сохранить: {why}',
  notLinked: 'не привязан к счёту',
};

export const RECURRING_EN: RecurringStrings = {
  attentionTitle: 'Needs attention',
  attentionFailed: 'Could not load what needs attention.',
  hiddenCount: '{n} hidden',
  showHidden: 'Show hidden',
  hideHidden: 'Hide the hidden ones',
  sentence: {
    due_not_covered: '{name} is due {when} ({amount}) and the paying account is short by {short}.',
    missed_payment: '{name} was due {days} d ago ({amount}) and no matching transaction has been seen.',
    amount_changed: '{name} was charged {charged} instead of the recorded {recorded}.',
    credit_high: '{name} has used {percent}% of its limit ({owed} of {limit}).',
    overdraft: '{name} is {over} past its overdraft.',
    overdrawn: '{name} is overdrawn by {over}; no overdraft limit is set.',
    reconsent: 'The {bank} connection needs to be approved again.',
    stale_statement: 'The data of {bank} is out of date: the newest is from {date} ({days} d ago).',
    stale_connection: 'The balances of {bank} have not been read for {hours} h (last read {date}).',
  },
  sentenceShort: '{name} is due {when} ({amount}) and the paying account cannot cover all of it.',
  groupTitle: { overdraft: 'Past the overdraft', overdrawn: 'Overdrawn, no limit set', due_not_covered: 'Due soon, not covered', missed_payment: 'Missed payments', reconsent: 'Connection to approve', credit_high: 'Cards near the limit', stale_statement: 'Out-of-date data', stale_connection: 'Bank not read lately', amount_changed: 'Amount changed' },
  fact: {
    due_not_covered: '{amount} {when} · short {short}',
    missed_payment: '{amount} · {days} d overdue',
    amount_changed: '{charged}, recorded {recorded}',
    credit_high: '{percent}% of the limit',
    overdraft: '{over} past the overdraft',
    overdrawn: '{over} overdrawn · no limit set',
    reconsent: 'approve access again',
    stale_statement: 'as of {date} · {days} d old',
    stale_connection: 'not read for {hours} h',
  },
  accept: 'Accept',
  more: 'More: {name}',
  snoozeItem: 'Snooze for {n} d',
  acceptAll: 'Accept charged amounts',
  snoozeAll: 'Snooze all for 7 d',
  dismissAll: 'Dismiss all',
  confirmDismiss: 'Dismiss all {n}?',
  confirmYes: 'Yes, dismiss',
  showAllN: 'Show all {n}',
  showFewer: 'Show fewer',
  bulkFailed: 'Some could not be changed: {n}. Try again.',
  hiddenTitle: 'Hidden',
  debtsSummary: '{n} · {amount} remaining',
  debtsShow: 'Show',
  debtsHide: 'Collapse',
  debtsFailed: 'Could not load the debts.',
  setLimit: 'Set limit',
  fLimit: 'Overdraft limit ({currency})',
  saveLimit: 'Save limit',
  limitInvalid: 'Enter an amount like 500',
  attentionNone: 'Nothing needs attention.',
  rowLabel: 'Needs attention · {n}',
  rowAll: 'All {n}',
  scrollLeft: 'Scroll left',
  scrollRight: 'Scroll right',
  severityWord: { high: 'Urgent', medium: 'Soon', info: 'Note' },
  card: {
    due_not_covered: '{when}, short {short}',
    missed_payment: '{days} d overdue, {amount}',
    amount_changed: '{charged}, was {recorded}',
    credit_high: '{percent}% of the limit',
    overdraft: '{over} past the overdraft',
    overdrawn: 'overdrawn, no limit set',
    reconsent: 'approve access again',
    stale_statement: 'as of {date}, {days} d old',
    stale_connection: 'not read for {hours} h',
  },
  sheetClose: 'Close',
  sheetLabel: 'Details: {name}',
  detail: {
    concerns: 'Concerns',
    amount: 'Amount',
    original: 'In its own currency',
    priority: 'Priority',
    due: 'Due',
    shortBy: 'Short by',
    overdueDays: 'Days overdue',
    lastPaid: 'Last paid',
    recorded: 'Recorded',
    charged: 'Charged',
    difference: 'Difference',
    paidOn: 'Charged on',
    used: 'Used',
    owed: 'Owed',
    limit: 'Limit',
    balance: 'Balance',
    overdraftLimit: 'Overdraft limit',
    overBy: 'Over by',
    since: 'Since',
    asOf: 'Data as of',
    daysOld: 'Days old',
    hoursOld: 'Hours without a read',
    dataAsOf: 'Bank data as of',
    none: 'none set',
  },
  acceptCharged: 'Accept the charged amount',
  uploadStatement: 'Upload statement',
  snoozeHeading: 'Snooze for',
  viewsLabel: 'Money sections',
  viewOverview: 'Overview',
  viewAttention: 'Attention',
  viewRecurring: 'Recurring payments',
  estimateMark: 'estimate',
  scheduledRemaining: 'by schedule about {amount} (estimate)',
  debtsKnown: '{known} of {n} with a known balance',
  debtsNextSoonest: 'next: {date} · {amount}',
  wasDue: 'Was due {date}',
  seenOf: 'seen in the bank: {m} of the last {c}',
  scheduleUnclear: 'schedule unclear',
  aboveOriginal: 'balance above the original amount',
  truth: {
    confirmed: 'confirmed by the bank',
    confirmedOn: 'confirmed by the bank · last {date}',
    noneSeen: 'no charge seen',
    unchecked: 'from your list, not checked',
  },
  endedMark: 'ended by schedule',
  endedTitle: 'Ended by schedule',
  endedList: 'Ended by schedule: {n}',
  scheduleProgress: 'by schedule {scheduled} of {total} · {done} confirmed by the bank',
  scheduleProgressNone: 'by schedule {scheduled} of {total} · none confirmed by the bank',
  confirmedOfTotal: '{done} of {total} confirmed by the bank',
  dueSplit: {
    confirmed: 'Confirmed by the bank: {amount}',
    noneSeen: 'No charge seen: {amount}',
    unchecked: 'From your list, not checked: {amount}',
  },
  dueWhen: { today: 'today', tomorrow: 'tomorrow', inDays: 'in {n} d' },
  markPaid: 'Mark paid',
  openPayment: 'Open payment',
  openBank: 'Open bank',
  snoozeFor: 'Snooze for',
  snooze: 'Snooze',
  snoozeDays: '{n} d',
  dismiss: 'Dismiss',
  restore: 'Restore',
  snoozedUntil: 'snoozed until {date}',
  dismissed: 'dismissed',
  actionFailed: 'That did not work. Try again.',
  alreadyMoved: 'The payment has already changed: the data was refreshed, check it again.',
  noDataSentence: 'No data yet for {bank}: set a balance or upload a statement.',
  noDataFact: 'no data yet',
  needsLook: '{name} needs a look',
  needsLookShort: 'needs a look',
  unnamed: 'This item',
  upcomingTitle: 'Upcoming payments',
  upcomingFailed: 'Could not load the upcoming payments.',
  upcomingNone: 'Nothing is due in the next {days} days.',
  windowLabel: 'Window',
  windowDays: '{n} days',
  today: 'Today',
  tomorrow: 'Tomorrow',
  kinds: { subscription: 'subscription', debt: 'debt', utility: 'utility', insurance: 'insurance', housing: 'housing', service: 'service', one_time: 'one-off' },
  frequencies: { once: 'once', daily: 'daily', weekly: 'weekly', monthly: 'monthly', yearly: 'yearly' },
  everyN: '{label}, every {n}',
  covered: 'covered',
  short: 'account short by {amount} by then',
  shortNote: 'Counts earlier payments from the same account; no income assumed.',
  ofWhich: 'of which',
  showMoreN: 'Show {n} more',
  dueRange: '{from} – {to}',
  shortTotal: 'the account is short {amount} in all, counting earlier payments',
  overdue: 'Overdue',
  overdueSince: 'Overdue since {date}',
  notCovered: 'not covered',
  coverUnknown: 'cover unknown',
  paidFrom: 'from {account}',
  dueTotals: 'Due in the window',
  dueGrand: 'In all',
  dueIncomplete: 'Currencies with no rate are not in the total.',
  allRecurring: 'All recurring payments',
  debtsTitle: 'Debts and installments',
  remaining: 'Remaining',
  installmentsDone: '{done} of {total} installments paid',
  repaidOf: '{paid} of {total} repaid',
  nextPayment: 'Next: {date}',
  creditor: 'Creditor: {name}',
  noNextDate: 'no next date',
  managerTitle: 'Recurring payments',
  managerFailed: 'Could not load the payments.',
  backToMoney: 'Back to Money',
  searchPayments: 'Search payments',
  kindFilter: 'Kind',
  allKinds: 'All kinds',
  showInactive: 'Show inactive',
  paymentCount: '{n} payments',
  add: 'Add payment',
  edit: 'Edit',
  save: 'Save',
  cancel: 'Cancel',
  deactivate: 'Deactivate',
  rowActions: 'Actions: {name}',
  sortLabel: 'Sort',
  sortNext: 'By next date',
  sortName: 'By name',
  activate: 'Activate',
  inactive: 'inactive',
  noMatches: 'Nothing matches.',
  noneYet: 'No recurring payments yet. Add the first one.',
  clearFilters: 'Clear filters',
  fName: 'Name',
  fAmount: 'Amount',
  fCurrency: 'Currency',
  fKind: 'Kind',
  fFrequency: 'Frequency',
  fEvery: 'Every',
  fNextDate: 'Next payment date',
  fAccount: 'Paying account',
  noAccount: 'None (payment method as text)',
  fMethod: 'Payment method',
  fMatch: 'Match text',
  fWebsite: 'Website',
  websiteHint: 'A host such as example.com: the server looks for the payment\'s own icon there',
  refreshIcon: 'Refresh icon',
  iconPending: 'Looking for the icon…',
  iconFailed: 'No icon found',
  uploadIcon: 'Upload icon',
  iconReason: {
    not_public: 'the site could not be checked (not a public address)',
    timeout: 'the site did not answer in time',
    blocked_status_403: 'the site refused access',
    too_large: 'the file is too large',
    not_an_image: 'it is not an image',
    unsafe_svg: 'the SVG is not safe',
    bitmap_ico: 'an .ico without a PNG inside',
    no_icon_found: 'no icon found on the site',
    other: 'the reason is not known',
  },
  iconUploadErrors: { type: 'Send a PNG or SVG file.', size: 'The file is larger than 256 KiB.', invalid: 'The file is not accepted as an icon.', failed: 'Could not upload the icon.' },
  matchHint: 'What its bank text contains, when that differs from the name',
  invalidAmount: 'Enter an amount like 12.99',
  invalidDate: 'A date as YYYY-MM-DD',
  saveFailed: 'Could not save. Try again.',
  saveRefused: 'Could not save: {why}',
  notLinked: 'not linked to an account',
};
