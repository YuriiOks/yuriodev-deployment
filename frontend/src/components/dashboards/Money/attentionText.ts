import { useDashboardLang } from '../../../context/useDashboardLang';
import { fill } from '../../../services/dashboards/calendarLabels';
import type { FinanceAccount, ProviderLogo } from '../../../services/dashboards/financeApi';
import { formatMinor } from '../../../services/dashboards/money';
import type { MoneyDisplay } from '../../../services/dashboards/preferences';
import type { AttentionItem, Recurring } from '../../../services/dashboards/recurringApi';
import { dayLabel } from './labels';
import { bankLabel } from './providers';
import { amountText, dueWhen } from './recurringLabels';

export const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** The item's subject: the payment, the account or the bank it is about. */
export function useSubject(item: AttentionItem, recurring: readonly Recurring[], accounts: readonly FinanceAccount[], logos: Readonly<Record<string, ProviderLogo>>) {
  const payment = item.subjectType === 'recurring' ? recurring.find((row) => row.id === item.subjectId) : undefined;
  const account = item.subjectType === 'account' ? accounts.find((row) => row.id === item.subjectId) : undefined;
  // The item names its subject and provider itself; the lists are only for what needs the whole row (the payment to act on, the account to edit).
  const provider = item.provider ?? account?.provider ?? (typeof item.facts.provider === 'string' ? item.facts.provider : null);
  return { payment, account, provider, name: item.subjectName ?? payment?.name ?? account?.name ?? (provider ? bankLabel(provider, logos[provider]) : item.title) };
}

/** The facts behind an item as one plain sentence in the page's language; the server's English title only when a fact is missing. */
export function useSentence(item: AttentionItem, name: string, mode: MoneyDisplay): string {
  const { t, lang } = useDashboardLang();
  const r = t.money.rec;
  const money = (minor: number | null, code: string | null) => (minor !== null && code ? formatMinor(minor, code, lang) : null);
  const own = item.amount !== null && item.currency ? amountText(item.amount, item.currency, item.display, mode, lang) : null;
  // A comparison (recorded against charged, a payment against what is short) is told in the payment's own currency on both sides.
  const native = item.amount !== null && item.currency ? formatMinor(item.amount, item.currency, lang) : null;
  const f = item.facts;
  switch (item.kind) {
    case 'due_not_covered': {
      const days = num(f.due_in_days);
      if (days === null || native === null) return item.title;
      const shortfall = money(num(f.shortfall), typeof f.account_currency === 'string' ? f.account_currency : null);
      return shortfall ? fill(r.sentence.due_not_covered, { name, when: dueWhen(days, r), amount: native, short: shortfall }) : fill(r.sentenceShort, { name, when: dueWhen(days, r), amount: native });
    }
    case 'missed_payment': {
      const days = num(f.days_overdue);
      return days === null || own === null ? item.title : fill(r.sentence.missed_payment, { name, days, amount: own });
    }
    case 'amount_changed': {
      const recorded = money(num(f.recorded_amount), item.currency);
      return recorded === null || native === null ? item.title : fill(r.sentence.amount_changed, { name, charged: native, recorded });
    }
    case 'credit_high': {
      const percent = num(f.used_percent);
      const owed = money(num(f.owed), item.currency);
      const limit = money(num(f.credit_limit), item.currency);
      return percent === null || !owed || !limit ? item.title : fill(r.sentence.credit_high, { name, percent, owed, limit });
    }
    case 'overdraft':
      return own === null ? item.title : fill(r.sentence.overdraft, { name, over: own });
    case 'overdrawn':
      return own === null ? item.title : fill(r.sentence.overdrawn, { name, over: own });
    case 'reconsent':
      return fill(r.sentence.reconsent, { bank: name });
    case 'stale_statement': {
      if (f.no_data === true) return fill(r.noDataSentence, { bank: name });
      const days = num(f.days_old);
      return days === null || typeof f.as_of !== 'string' ? item.title : fill(r.sentence.stale_statement, { bank: name, days, date: dayLabel(f.as_of, lang) });
    }
    case 'stale_connection': {
      const hours = num(f.hours_old);
      return hours === null || typeof f.since !== 'string' ? item.title : fill(r.sentence.stale_connection, { bank: name, hours, date: dayLabel(f.since, lang) });
    }
  }
}

/** The fact behind an item in short form for its row ("£19.99, recorded £12.99"); the server's title when a fact is missing. */
export function useFact(item: AttentionItem, mode: MoneyDisplay): string {
  const { t, lang } = useDashboardLang();
  const r = t.money.rec;
  const money = (minor: number | null, code: string | null) => (minor !== null && code ? formatMinor(minor, code, lang) : null);
  const own = item.amount !== null && item.currency ? amountText(item.amount, item.currency, item.display, mode, lang) : null;
  // A comparison (recorded against charged, a payment against what is short) is told in the payment's own currency on both sides.
  const native = item.amount !== null && item.currency ? formatMinor(item.amount, item.currency, lang) : null;
  const f = item.facts;
  switch (item.kind) {
    case 'due_not_covered': {
      const days = num(f.due_in_days);
      if (days === null || native === null) return item.title;
      const shortfall = money(num(f.shortfall), typeof f.account_currency === 'string' ? f.account_currency : null);
      return shortfall ? fill(r.fact.due_not_covered, { amount: native, when: dueWhen(days, r), short: shortfall }) : `${native} ${dueWhen(days, r)} · ${r.notCovered}`;
    }
    case 'missed_payment': {
      const days = num(f.days_overdue);
      return days === null || own === null ? item.title : fill(r.fact.missed_payment, { amount: own, days });
    }
    case 'amount_changed': {
      const recorded = money(num(f.recorded_amount), item.currency);
      return recorded === null || native === null ? item.title : fill(r.fact.amount_changed, { charged: native, recorded });
    }
    case 'credit_high': {
      const percent = num(f.used_percent);
      return percent === null ? item.title : fill(r.fact.credit_high, { percent });
    }
    case 'overdraft':
      return own === null ? item.title : fill(r.fact.overdraft, { over: own });
    case 'overdrawn':
      return own === null ? item.title : fill(r.fact.overdrawn, { over: own });
    case 'reconsent':
      return r.fact.reconsent;
    case 'stale_statement': {
      if (f.no_data === true) return r.noDataFact;
      const days = num(f.days_old);
      return days === null || typeof f.as_of !== 'string' ? item.title : fill(r.fact.stale_statement, { date: dayLabel(f.as_of, lang), days });
    }
    case 'stale_connection': {
      const hours = num(f.hours_old);
      return hours === null ? item.title : fill(r.fact.stale_connection, { hours });
    }
  }
}


/** The fact for a card in the row: a few words ("£19.99, was £12.99", "97% of the limit", "tomorrow, short £12.50"); the server's title when a fact is missing. */
export function useCardFact(item: AttentionItem, mode: MoneyDisplay): string {
  const { t, lang } = useDashboardLang();
  const r = t.money.rec;
  const money = (minor: number | null, code: string | null) => (minor !== null && code ? formatMinor(minor, code, lang) : null);
  const own = item.amount !== null && item.currency ? amountText(item.amount, item.currency, item.display, mode, lang) : null;
  // A comparison (recorded against charged, a payment against what is short) is told in the payment's own currency on both sides.
  const native = item.amount !== null && item.currency ? formatMinor(item.amount, item.currency, lang) : null;
  const f = item.facts;
  switch (item.kind) {
    case 'due_not_covered': {
      const days = num(f.due_in_days);
      if (days === null) return item.title;
      const shortfall = money(num(f.shortfall), typeof f.account_currency === 'string' ? f.account_currency : null);
      return shortfall ? fill(r.card.due_not_covered, { when: dueWhen(days, r), short: shortfall }) : `${dueWhen(days, r)}, ${r.notCovered}`;
    }
    case 'missed_payment': {
      const days = num(f.days_overdue);
      return days === null || own === null ? item.title : fill(r.card.missed_payment, { days, amount: own });
    }
    case 'amount_changed': {
      const recorded = money(num(f.recorded_amount), item.currency);
      return recorded === null || native === null ? item.title : fill(r.card.amount_changed, { charged: native, recorded });
    }
    case 'credit_high': {
      const percent = num(f.used_percent);
      return percent === null ? item.title : fill(r.card.credit_high, { percent });
    }
    case 'overdraft':
      return own === null ? item.title : fill(r.card.overdraft, { over: own });
    case 'overdrawn':
      return r.card.overdrawn;
    case 'reconsent':
      return r.card.reconsent;
    case 'stale_statement': {
      if (f.no_data === true) return r.noDataFact;
      const days = num(f.days_old);
      return days === null || typeof f.as_of !== 'string' ? item.title : fill(r.card.stale_statement, { date: dayLabel(f.as_of, lang), days });
    }
    case 'stale_connection': {
      const hours = num(f.hours_old);
      return hours === null ? item.title : fill(r.card.stale_connection, { hours });
    }
  }
}

export interface DetailRow {
  readonly label: string;
  readonly value: string;
}

/** The facts behind an item as label and value pairs for the details panel (amounts with their original when converted, dates in words). */
export function useDetailRows(item: AttentionItem, mode: MoneyDisplay): DetailRow[] {
  const { t, lang } = useDashboardLang();
  const r = t.money.rec;
  const d = r.detail;
  const f = item.facts;
  const money = (minor: number | null, code: string | null): string | null => (minor !== null && code ? formatMinor(minor, code, lang) : null);
  const day = (value: unknown): string | null => (typeof value === 'string' && value ? dayLabel(value, lang) : null);
  const rows: (DetailRow | null)[] = [{ label: d.priority, value: r.severityWord[item.severity] }];
  if (item.amount !== null && item.currency) {
    rows.push({ label: d.amount, value: amountText(item.amount, item.currency, item.display, mode, lang) });
    if (mode === 'base' && item.display && item.display.currency !== item.currency) rows.push({ label: d.original, value: formatMinor(item.amount, item.currency, lang) });
  }
  const add = (label: string, value: string | null) => rows.push(value === null ? null : { label, value });
  add(d.due, item.dueDate ? dayLabel(item.dueDate, lang) : null);
  const accountCurrency = typeof f.account_currency === 'string' ? f.account_currency : null;
  switch (item.kind) {
    case 'due_not_covered':
      add(d.shortBy, money(num(f.shortfall), accountCurrency));
      break;
    case 'missed_payment':
      add(d.overdueDays, num(f.days_overdue) === null ? null : String(num(f.days_overdue)));
      add(d.lastPaid, day(f.last_paid_on));
      add(d.dataAsOf, day(f.data_as_of));
      break;
    case 'amount_changed':
      add(d.recorded, money(num(f.recorded_amount), item.currency));
      add(d.charged, money(num(f.charged_amount), item.currency));
      add(d.difference, money(num(f.difference), item.currency));
      add(d.paidOn, day(f.paid_on));
      break;
    case 'credit_high':
      add(d.used, num(f.used_percent) === null ? null : `${num(f.used_percent)}%`);
      add(d.owed, money(num(f.owed), item.currency));
      add(d.limit, money(num(f.credit_limit), item.currency));
      break;
    case 'overdraft':
      add(d.balance, money(num(f.balance), item.currency));
      add(d.overdraftLimit, money(num(f.overdraft_limit), item.currency));
      add(d.overBy, money(num(f.over_by), item.currency));
      break;
    case 'overdrawn':
      add(d.balance, money(num(f.balance), item.currency));
      add(d.overdraftLimit, d.none);
      break;
    case 'reconsent':
      add(d.since, day(f.since));
      break;
    case 'stale_statement':
      add(d.asOf, day(f.as_of));
      add(d.daysOld, num(f.days_old) === null ? null : String(num(f.days_old)));
      break;
    case 'stale_connection':
      add(d.since, day(f.since));
      add(d.hoursOld, num(f.hours_old) === null ? null : String(num(f.hours_old)));
      break;
  }
  return rows.flatMap((row) => (row ? [row] : []));
}
