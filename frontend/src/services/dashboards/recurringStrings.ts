import type { AttentionKind, Frequency, RecurringKind } from './recurringApi';

/** The forms of a counted noun: Russian has one, few and many; English one and other (the missing ones fall back to `other`). */
export interface Plural {
  readonly one: string;
  readonly few?: string;
  readonly many?: string;
  readonly other: string;
}

/** The words of the recurring payments, upcoming payments, attention and debts parts of the Money page (both languages). */
export interface RecurringStrings {
  readonly attentionTitle: string;
  readonly attentionFailed: string;
  readonly hiddenCount: string;
  readonly showHidden: string;
  readonly hideHidden: string;
  readonly sentence: Readonly<Record<AttentionKind, string>>;
  readonly sentenceShort: string;
  readonly attentionOpen: string;
  readonly attentionClose: string;
  readonly groupTitle: Readonly<Record<AttentionKind, string>>;
  readonly chip: Readonly<Record<AttentionKind, Plural>>;
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
  readonly setLimit: string;
  readonly fLimit: string;
  readonly saveLimit: string;
  readonly limitInvalid: string;
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
  readonly activate: string;
  readonly inactive: string;
  readonly noMatches: string;
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
  },
  sentenceShort: '{name}: срок {when} ({amount}), счёта для оплаты не хватает на всё.',
  attentionOpen: 'Показать',
  attentionClose: 'Свернуть',
  groupTitle: { overdraft: 'Овердрафт', overdrawn: 'В минусе, лимит не задан', due_not_covered: 'Скоро платёж, денег не хватит', missed_payment: 'Пропущенные платежи', reconsent: 'Нужно подтвердить подключение', credit_high: 'Карты у лимита', stale_statement: 'Устаревшие данные', amount_changed: 'Изменилась сумма' },
  chip: {
    overdraft: { one: '{n} овердрафт', few: '{n} овердрафта', many: '{n} овердрафтов', other: '{n} овердрафта' },
    overdrawn: { one: '{n} в минусе без лимита', few: '{n} в минусе без лимита', many: '{n} в минусе без лимита', other: '{n} в минусе без лимита' },
    due_not_covered: { one: '{n} платёж без покрытия', few: '{n} платежа без покрытия', many: '{n} платежей без покрытия', other: '{n} платежа без покрытия' },
    missed_payment: { one: '{n} пропущенный платёж', few: '{n} пропущенных платежа', many: '{n} пропущенных платежей', other: '{n} пропущенного платежа' },
    reconsent: { one: '{n} подключение к обновлению', few: '{n} подключения к обновлению', many: '{n} подключений к обновлению', other: '{n} подключения к обновлению' },
    credit_high: { one: '{n} карта у лимита', few: '{n} карты у лимита', many: '{n} карт у лимита', other: '{n} карты у лимита' },
    stale_statement: { one: '{n} банк с устаревшими данными', few: '{n} банка с устаревшими данными', many: '{n} банков с устаревшими данными', other: '{n} банка с устаревшими данными' },
    amount_changed: { one: '{n} изменённая сумма', few: '{n} изменённые суммы', many: '{n} изменённых сумм', other: '{n} изменённой суммы' },
  },
  fact: {
    due_not_covered: '{amount} {when} · не хватает {short}',
    missed_payment: '{amount} · просрочка {days} дн.',
    amount_changed: '{charged}, записано {recorded}',
    credit_high: '{percent}% лимита',
    overdraft: 'сверх овердрафта {over}',
    overdrawn: 'в минусе на {over} · лимит не задан',
    reconsent: 'подтвердите доступ заново',
    stale_statement: 'на {date} · {days} дн. назад',
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
  setLimit: 'Задать лимит',
  fLimit: 'Лимит овердрафта ({currency})',
  saveLimit: 'Сохранить лимит',
  limitInvalid: 'Введите сумму вроде 500',
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
  short: 'не хватает {amount}',
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
  activate: 'Включить',
  inactive: 'неактивен',
  noMatches: 'Ничего не найдено.',
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
  },
  sentenceShort: '{name} is due {when} ({amount}) and the paying account cannot cover all of it.',
  attentionOpen: 'Show',
  attentionClose: 'Collapse',
  groupTitle: { overdraft: 'Past the overdraft', overdrawn: 'Overdrawn, no limit set', due_not_covered: 'Due soon, not covered', missed_payment: 'Missed payments', reconsent: 'Connection to approve', credit_high: 'Cards near the limit', stale_statement: 'Out-of-date data', amount_changed: 'Amount changed' },
  chip: {
    overdraft: { one: '{n} past the overdraft', few: '{n} past the overdraft', many: '{n} past the overdraft', other: '{n} past the overdraft' },
    overdrawn: { one: '{n} overdrawn, no limit', few: '{n} overdrawn, no limit', many: '{n} overdrawn, no limit', other: '{n} overdrawn, no limit' },
    due_not_covered: { one: '{n} payment not covered', few: '{n} payments not covered', many: '{n} payments not covered', other: '{n} payments not covered' },
    missed_payment: { one: '{n} missed payment', few: '{n} missed payments', many: '{n} missed payments', other: '{n} missed payments' },
    reconsent: { one: '{n} connection to approve', few: '{n} connections to approve', many: '{n} connections to approve', other: '{n} connections to approve' },
    credit_high: { one: '{n} card near its limit', few: '{n} cards near their limit', many: '{n} cards near their limit', other: '{n} cards near their limit' },
    stale_statement: { one: '{n} bank out of date', few: '{n} banks out of date', many: '{n} banks out of date', other: '{n} banks out of date' },
    amount_changed: { one: '{n} amount changed', few: '{n} amounts changed', many: '{n} amounts changed', other: '{n} amounts changed' },
  },
  fact: {
    due_not_covered: '{amount} {when} · short {short}',
    missed_payment: '{amount} · {days} d overdue',
    amount_changed: '{charged}, recorded {recorded}',
    credit_high: '{percent}% of the limit',
    overdraft: '{over} past the overdraft',
    overdrawn: '{over} overdrawn · no limit set',
    reconsent: 'approve access again',
    stale_statement: 'as of {date} · {days} d old',
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
  setLimit: 'Set limit',
  fLimit: 'Overdraft limit ({currency})',
  saveLimit: 'Save limit',
  limitInvalid: 'Enter an amount like 500',
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
  short: 'short by {amount}',
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
  activate: 'Activate',
  inactive: 'inactive',
  noMatches: 'Nothing matches.',
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
  matchHint: 'What its bank text contains, when that differs from the name',
  invalidAmount: 'Enter an amount like 12.99',
  invalidDate: 'A date as YYYY-MM-DD',
  saveFailed: 'Could not save. Try again.',
  saveRefused: 'Could not save: {why}',
  notLinked: 'not linked to an account',
};
