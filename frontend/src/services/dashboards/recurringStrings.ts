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
    reconsent: 'Подключение {bank} нужно подтвердить заново.',
    stale_statement: 'Данные {bank} устарели: последние на {date} ({days} дн. назад).',
  },
  sentenceShort: '{name}: срок {when} ({amount}), счёта для оплаты не хватает на всё.',
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
    reconsent: 'The {bank} connection needs to be approved again.',
    stale_statement: 'The data of {bank} is out of date: the newest is from {date} ({days} d ago).',
  },
  sentenceShort: '{name} is due {when} ({amount}) and the paying account cannot cover all of it.',
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
