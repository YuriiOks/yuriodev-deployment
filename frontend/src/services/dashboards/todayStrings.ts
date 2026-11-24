import type { AttentionKind } from './recurringApi';

/** The words of the Today view of the Money page (both languages): the page's one sentence, the decisions of the queue, the figures, the side column. */
export interface TodayStrings {
  readonly tabs: { readonly today: string; readonly wallet: string; readonly payments: string; readonly spending: string; readonly transactions: string };
  readonly navLabel: string;
  readonly greeting: { readonly morning: string; readonly afternoon: string; readonly evening: string };
  readonly summary: {
    readonly total: string;
    readonly waiting: string;
    readonly nothingWaiting: string;
    readonly nextPayment: string;
    readonly overdue: string;
  };
  readonly queueTitle: string;
  readonly queueOpen: string;
  readonly queueEmpty: string;
  readonly oneAtATime: string;
  /** The decision each kind of item asks for, as a question. */
  readonly decision: Readonly<Record<AttentionKind, string>>;
  readonly actions: {
    readonly accept: string;
    readonly openPayment: string;
    readonly markPaid: string;
    readonly details: string;
    readonly snooze: string;
    readonly openBank: string;
  };
  readonly soonTitle: string;
  readonly soonLink: string;
  readonly soonEmpty: string;
  readonly paid: string;
  readonly overdueChip: string;
  readonly stats: {
    readonly spentIn: string;
    readonly spentMore: string;
    readonly spentLess: string;
    readonly spentSame: string;
    readonly spentFirst: string;
    readonly dueIn: string;
    readonly dueConfirmed: string;
    readonly dueEmpty: string;
  };
  readonly breakdown: { readonly title: string; readonly empty: string };
  readonly insight: { readonly rose: string; readonly roseText: string; readonly top: string; readonly topText: string };
  readonly banksTitle: string;
  readonly banksLink: string;
  readonly banksEmpty: string;
  readonly bank: { readonly updated: string; readonly byHand: string; readonly never: string; readonly owed: string };
  readonly failed: string;
}

export const TODAY_RU: TodayStrings = {
  tabs: { today: 'Сегодня', wallet: 'Кошелёк', payments: 'Платежи', spending: 'Траты', transactions: 'Операции' },
  navLabel: 'Разделы денег',
  greeting: { morning: 'Доброе утро', afternoon: 'Добрый день', evening: 'Добрый вечер' },
  summary: {
    total: 'На всех счетах {amount}.',
    waiting: 'Ждёт решения: {n}.',
    nothingWaiting: 'Ничего не требует внимания.',
    nextPayment: 'Ближайший платёж: {when}.',
    overdue: 'Просрочено платежей: {n}.',
  },
  queueTitle: 'Сначала это',
  queueOpen: 'Все {n}',
  queueEmpty: 'Решать нечего.',
  oneAtATime: 'По одному',
  decision: {
    due_not_covered: 'Хватит ли денег на {name}?',
    missed_payment: 'Заплачено ли за {name}?',
    amount_changed: 'Принять новую сумму {name}?',
    credit_high: 'Карта {name} почти у лимита',
    overdraft: 'Овердрафт {name} превышен',
    overdrawn: 'Задать лимит овердрафта {name}?',
    reconsent: 'Подтвердить доступ к {name} заново?',
    stale_statement: 'Обновить данные {name}?',
    stale_connection: '{name} давно не читался',
  },
  actions: { accept: 'Принять', openPayment: 'Открыть платёж', markPaid: 'Оплачено', details: 'Подробнее', snooze: 'Отложить на 7 дней', openBank: 'Открыть банк' },
  soonTitle: 'Скоро спишется',
  soonLink: 'Все платежи →',
  soonEmpty: 'В ближайшие дни ничего не спишется.',
  paid: 'Оплачено',
  overdueChip: 'просрочено',
  stats: {
    spentIn: 'Потрачено в {month}',
    spentMore: 'на {percent}% больше, чем к {date}',
    spentLess: 'на {percent}% меньше, чем к {date}',
    spentSame: 'как к {date}',
    spentFirst: 'сравнить не с чем',
    dueIn: 'Спишется за {days} дней',
    dueConfirmed: 'из них подтверждено банком: {amount}',
    dueEmpty: 'платежей нет',
  },
  breakdown: { title: 'Куда ушли деньги', empty: 'В этом месяце трат пока нет.' },
  insight: {
    rose: 'Что выросло: {category}',
    roseText: 'К {date} прошлого месяца было {previous}, сейчас {spent}. Посмотрите операции этой категории.',
    top: 'Больше всего: {category}',
    topText: 'Это {percent}% трат месяца. Выросшего заметно больше нет.',
  },
  banksTitle: 'Банки сегодня',
  banksLink: 'Кошелёк →',
  banksEmpty: 'Банков пока нет.',
  bank: { updated: 'обновлён {when}', byHand: 'баланс введён вручную {date}', never: 'данных ещё нет', owed: 'долг {amount}' },
  failed: 'Не удалось загрузить часть данных.',
};

export const TODAY_EN: TodayStrings = {
  tabs: { today: 'Today', wallet: 'Wallet', payments: 'Payments', spending: 'Spending', transactions: 'Transactions' },
  navLabel: 'Money sections',
  greeting: { morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening' },
  summary: {
    total: 'Across all accounts {amount}.',
    waiting: '{n} waiting for a decision.',
    nothingWaiting: 'Nothing needs attention.',
    nextPayment: 'Next payment: {when}.',
    overdue: 'Overdue payments: {n}.',
  },
  queueTitle: 'First this',
  queueOpen: 'All {n}',
  queueEmpty: 'Nothing to decide.',
  oneAtATime: 'One at a time',
  decision: {
    due_not_covered: 'Is there enough money for {name}?',
    missed_payment: 'Was {name} paid?',
    amount_changed: 'Accept the new amount of {name}?',
    credit_high: '{name} is almost at its limit',
    overdraft: '{name} is past its overdraft',
    overdrawn: 'Set an overdraft limit for {name}?',
    reconsent: 'Approve {name} again?',
    stale_statement: 'Update the data of {name}?',
    stale_connection: '{name} has not been read lately',
  },
  actions: { accept: 'Accept', openPayment: 'Open payment', markPaid: 'Mark paid', details: 'Details', snooze: 'Snooze 7 days', openBank: 'Open bank' },
  soonTitle: 'Due soon',
  soonLink: 'All payments →',
  soonEmpty: 'Nothing is due in the next few days.',
  paid: 'Paid',
  overdueChip: 'overdue',
  stats: {
    spentIn: 'Spent in {month}',
    spentMore: '{percent}% more than by {date}',
    spentLess: '{percent}% less than by {date}',
    spentSame: 'same as by {date}',
    spentFirst: 'nothing to compare with',
    dueIn: 'Due in {days} days',
    dueConfirmed: 'of which confirmed by the bank: {amount}',
    dueEmpty: 'no payments',
  },
  breakdown: { title: 'Where the money went', empty: 'No spending this month yet.' },
  insight: {
    rose: 'What rose: {category}',
    roseText: 'By {date} last month it was {previous}, now {spent}. Look at the transactions of this category.',
    top: 'Largest: {category}',
    topText: 'That is {percent}% of the month\'s spending. Nothing else rose sharply.',
  },
  banksTitle: 'Banks today',
  banksLink: 'Wallet →',
  banksEmpty: 'No banks yet.',
  bank: { updated: 'updated {when}', byHand: 'balance entered by hand {date}', never: 'no data yet', owed: 'owed {amount}' },
  failed: 'Part of the data could not be loaded.',
};
