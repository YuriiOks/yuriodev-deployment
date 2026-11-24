import React, { useState } from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { fill } from '../../../services/dashboards/calendarLabels';
import { grandTotal, shownTotals } from '../../../services/dashboards/display';
import type { FinanceAccount, FinanceAccounts, FinanceCategories, FinanceSummary, ProviderLogo } from '../../../services/dashboards/financeApi';
import { formatMinor } from '../../../services/dashboards/money';
import type { MoneyDisplay } from '../../../services/dashboards/preferences';
import { markPaid, movedOn, snoozeAttention, updateRecurring, type AttentionItem, type Recurring, type Upcoming, type UpcomingItem } from '../../../services/dashboards/recurringApi';
import { groupBanks } from '../../../services/dashboards/wallet';
import DashIcon from '../DashIcon/DashIcon';
import TodayLayout, { SideCard, SideRow, TodayCard, TodaySoonRow, type TodayAction } from '../Today/TodayLayout';
import BankMark from './BankMark';
import CategoryMark from './CategoryMark';
import RecurringIcon from './RecurringIcon';
import { useCardFact, useSubject } from './attentionText';
import { splitDue, truthOf } from './evidenceModel';
import { dayLabel, monthName } from './labels';
import { biggestRise, nextPayment, partOfDay, spendView, topCategories } from './todayModel';
import { bankLabel } from './providers';
import { amountText, dueWhen } from './recurringLabels';

/** How many decisions the queue shows, and how many days the "due" figure covers. */
const QUEUE_SIZE = 3;
const DUE_DAYS = 14;
const SOON_ROWS = 3;

interface Context {
  recurring: readonly Recurring[];
  accounts: readonly FinanceAccount[];
  logos: Readonly<Record<string, ProviderLogo>>;
  mode: MoneyDisplay;
}

/** One decision of the queue: what the item asks, phrased as a question, one line of fact, and exactly two actions. */
const QueueCard: React.FC<Context & { item: AttentionItem; onOpenSheet: (item: AttentionItem, trigger: HTMLElement | null) => void; onChanged: () => Promise<void> }> = ({ item, onOpenSheet, onChanged, ...context }) => {
  const { t } = useDashboardLang();
  const r = t.money.rec;
  const td = t.money.today;
  const subject = useSubject(item, context.recurring, context.accounts, context.logos);
  const fact = useCardFact(item, context.mode);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const payment = subject.payment;
  const provider = subject.provider;
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setNote(null);
    try {
      await action();
      await onChanged();
    } catch (error) {
      if (movedOn(error)) await onChanged().catch(() => undefined);
      setNote(movedOn(error) ? r.alreadyMoved : r.actionFailed);
    } finally {
      setBusy(false);
    }
  };
  const details: TodayAction = { label: td.actions.details, onClick: () => onOpenSheet(item, null), busy };
  const snooze: TodayAction = { label: td.actions.snooze, onClick: () => void act(() => snoozeAttention(item.key, 7)), busy };
  const charged = item.kind === 'amount_changed' && payment && item.amount !== null && item.amount > 0 && item.currency === payment.currency ? item.amount : null;
  let primary = details;
  let secondary = snooze;
  if (charged !== null && payment) {
    primary = { label: td.actions.accept, onClick: () => void act(() => updateRecurring(payment.id, { amount: charged })), busy };
    secondary = { label: td.actions.openPayment, to: `?view=recurring&edit=${encodeURIComponent(payment.id)}` };
  } else if ((item.kind === 'missed_payment' || item.kind === 'due_not_covered') && payment) {
    primary = { label: td.actions.markPaid, onClick: () => void act(() => markPaid(payment.id, item.dueDate ?? payment.nextDate)), busy };
    secondary = details;
  }
  const icon = payment ? <RecurringIcon name={payment.name} iconUrl={payment.iconUrl} color={payment.color} /> : provider ? <BankMark provider={provider} logo={context.logos[provider]} /> : <DashIcon name="alert" size={16} />;
  return <TodayCard item={{ key: item.key, icon, title: fill(td.decision[item.kind], { name: subject.name }), fact: note ? `${fact} · ${note}` : `${r.severityWord[item.severity]} · ${fact}`, primary, secondary, severity: item.severity }} />;
};

/** One row of "due soon": the payment, its amount and when, and one action: "Paid". */
const SoonRow: React.FC<{ item: UpcomingItem; mode: MoneyDisplay; onChanged: () => Promise<void> }> = ({ item, mode, onChanged }) => {
  const { t, lang } = useDashboardLang();
  const r = t.money.rec;
  const td = t.money.today;
  const [busy, setBusy] = useState(false);
  const paid = async () => {
    setBusy(true);
    try {
      await markPaid(item.recurringId, item.dueDate);
      await onChanged();
    } catch (error) {
      if (movedOn(error)) await onChanged().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };
  const when = item.overdue ? `${td.overdueChip} · ${dayLabel(item.dueDate, lang)}` : item.daysUntil <= 1 ? dueWhen(item.daysUntil, r) : dayLabel(item.dueDate, lang);
  return <TodaySoonRow item={{ key: `${item.recurringId}-${item.dueDate}`, name: item.name, chips: [amountText(item.amount, item.currency, item.display, mode, lang), when], action: { label: td.paid, onClick: () => void paid(), busy }, late: item.overdue }} />;
};

/** How long ago a moment was, in the page's language ("5 minutes ago"). */
function ago(iso: string, lang: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  const formatter = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  if (minutes < 60) return formatter.format(-minutes, 'minute');
  if (minutes < 60 * 24) return formatter.format(-Math.round(minutes / 60), 'hour');
  return formatter.format(-Math.round(minutes / (60 * 24)), 'day');
}

export interface MoneyTodayProps extends Context {
  /** The section tabs, as the page builds them. */
  nav: React.ReactNode;
  /** What needs attention, in the order to show it (all of it: the queue takes the first three, "One at a time" walks them all). */
  ordered: readonly AttentionItem[];
  upcoming: Upcoming | null;
  spend: FinanceCategories | null;
  summary: FinanceSummary | null;
  bankData: FinanceAccounts | null;
  /** Some of what it shows could not be loaded. */
  failed: boolean;
  onOpenSheet: (item: AttentionItem, trigger: HTMLElement | null) => void;
  /** The attention, payments and upcoming lists are asked again. */
  onChanged: () => Promise<void>;
}

/**
 * The Today view of the Money page, on the shared Today structure: one sentence of what matters now, the queue ("First this": at most three
 * decisions, each with two actions, and "One at a time" to walk through all of them), what is due soon, two figures (spent this month against
 * the same day last month; due in the next two weeks and how much of it the bank confirmed), where the money went with its finding, and the
 * banks with how fresh each one's data is. Everything is the server's data; nothing is invented.
 */
const MoneyToday: React.FC<MoneyTodayProps> = ({ nav, ordered, upcoming, spend, summary, bankData, failed, onOpenSheet, onChanged, ...context }) => {
  const { t, lang } = useDashboardLang();
  const m = t.money;
  const td = m.today;
  const { mode } = context;
  const queue = ordered.slice(0, QUEUE_SIZE);

  // The one sentence.
  const total = grandTotal(context.accounts, summary);
  const natives = shownTotals(context.accounts, 'native');
  const totalText = mode === 'base' && total ? `${total.approx ? '≈ ' : ''}${formatMinor(total.amount, total.currency, lang)}` : natives.length === 1 ? formatMinor(natives[0].amount, natives[0].currency, lang) : null;
  const ahead = upcoming ? nextPayment(upcoming.items) : null;
  const lateCount = upcoming ? upcoming.items.filter((item) => item.overdue).length : 0;
  const parts = [
    totalText ? fill(td.summary.total, { amount: totalText }) : '',
    ordered.length > 0 ? fill(td.summary.waiting, { n: ordered.length }) : td.summary.nothingWaiting,
    lateCount > 0 ? fill(td.summary.overdue, { n: lateCount }) : '',
    ahead ? fill(td.summary.nextPayment, { when: dueWhen(ahead.days, m.rec) }) : '',
  ].filter(Boolean);

  // Due soon and the figure for the next two weeks.
  const byId = new Map(context.recurring.map((row) => [row.id, row]));
  const items = (upcoming?.items ?? []).filter((item) => byId.get(item.recurringId)?.scheduleState !== 'ended_by_schedule');
  const soon = items.slice(0, SOON_ROWS);
  const window = items.filter((item) => item.daysUntil < DUE_DAYS);
  const dueSums = new Map<string, { amount: number; approx: boolean }>();
  for (const item of window) {
    const shown = mode === 'base' && item.display && item.display.currency !== item.currency ? { amount: item.display.amount, currency: item.display.currency, approx: true } : { amount: item.amount, currency: item.currency, approx: false };
    const before = dueSums.get(shown.currency);
    dueSums.set(shown.currency, { amount: (before?.amount ?? 0) + shown.amount, approx: (before?.approx ?? false) || shown.approx });
  }
  const dueText = window.length === 0 ? td.stats.dueEmpty : [...dueSums.entries()].map(([code, sum]) => `${sum.approx ? '≈ ' : ''}${formatMinor(sum.amount, code, lang)}`).join(' · ');
  const confirmed = splitDue(window, (id) => truthOf(byId.get(id)?.evidence ?? null), mode).confirmed;
  const confirmedText = confirmed.length === 0 ? formatMinor(0, [...dueSums.keys()][0] ?? 'GBP', lang) : confirmed.map((sum) => `${sum.approx ? '≈ ' : ''}${formatMinor(sum.amount, sum.currency, lang)}`).join(' · ');

  // This month's spending.
  const view = spend ? spendView(spend, mode) : null;
  const month = spend ? monthName(spend.month, lang) : '';
  let spentNote = td.stats.spentFirst;
  if (view && view.previousToDate !== null && view.previousToDate > 0 && view.previousDay) {
    const percent = Math.round((Math.abs(view.spent - view.previousToDate) / view.previousToDate) * 100);
    const date = dayLabel(view.previousDay, lang);
    spentNote = percent === 0 ? fill(td.stats.spentSame, { date }) : fill(view.spent < view.previousToDate ? td.stats.spentLess : td.stats.spentMore, { percent, date });
  }
  const rows = view ? topCategories(view.categories) : [];
  const largest = rows[0]?.spent ?? 0;
  const rise = view ? biggestRise(view.categories) : null;
  let insight: { title: string; text: string } | null = null;
  if (view && rise && view.previousDay) {
    insight = {
      title: fill(td.insight.rose, { category: m.categories[rise.category.category] }),
      text: fill(td.insight.roseText, { date: dayLabel(view.previousDay, lang), previous: formatMinor(rise.category.previousToDate ?? 0, view.currency, lang), spent: formatMinor(rise.category.spent, view.currency, lang) }),
    };
  } else if (view && rows[0]) {
    insight = { title: fill(td.insight.top, { category: m.categories[rows[0].category] }), text: fill(td.insight.topText, { percent: Math.round((rows[0].spent / Math.max(view.spent, 1)) * 100) }) };
  }

  // The banks, the stalest first.
  const banks = bankData ? groupBanks(bankData.accounts, bankData.connections).filter((bank) => bank.accounts.length > 0) : [];
  const stamp = (iso: string | null | undefined) => (iso ? Date.parse(iso) : 0);
  const freshest = [...banks].sort((a, b) => stamp(a.connection?.lastOkAt) - stamp(b.connection?.lastOkAt)).slice(0, 3);
  const hour = new Date().getHours();

  return (
    <TodayLayout
      mark="£"
      place={m.title}
      nav={nav}
      hello={td.greeting[partOfDay(hour)]}
      summary={parts.join(' ')}
      queue={{
        title: td.queueTitle,
        count: ordered.length,
        countLabel: fill(td.queueOpen, { n: ordered.length }),
        countTo: '?view=attention',
        cards: queue.map((item) => <QueueCard key={item.key} item={item} onOpenSheet={onOpenSheet} onChanged={onChanged} {...context} />),
        shown: queue.length,
        empty: td.queueEmpty,
        oneAtATime: ordered.length > 1 ? { label: td.oneAtATime, onClick: () => onOpenSheet(ordered[0], null) } : null,
      }}
      soon={{ title: td.soonTitle, linkLabel: td.soonLink, linkTo: '?view=payments', rows: soon.map((item) => <SoonRow key={`${item.recurringId}-${item.dueDate}`} item={item} mode={mode} onChanged={onChanged} />), shown: soon.length, empty: td.soonEmpty }}
      stats={[
        { key: 'spent', label: fill(td.stats.spentIn, { month }), value: view ? `${view.approx ? '≈ ' : ''}${formatMinor(view.spent, view.currency, lang)}` : '—', note: view ? spentNote : td.breakdown.empty },
        { key: 'due', label: fill(td.stats.dueIn, { days: DUE_DAYS }), value: dueText, note: fill(td.stats.dueConfirmed, { amount: confirmedText }) },
      ]}
      breakdown={{
        title: td.breakdown.title,
        period: month,
        rows: rows.map((row) => ({ key: row.category, icon: <CategoryMark category={row.category} />, name: m.categories[row.category], value: formatMinor(row.spent, view?.currency ?? 'GBP', lang), width: largest > 0 ? Math.round((row.spent / largest) * 100) : 0 })),
        insight,
        empty: td.breakdown.empty,
      }}
      side={
        <>
          {failed && <p role="alert">{td.failed}</p>}
          <SideCard title={td.banksTitle} linkLabel={td.banksLink} linkTo="?view=wallet">
            {freshest.length === 0 ? (
              <p>{td.banksEmpty}</p>
            ) : (
              freshest.map((bank) => {
                const lead = shownTotals(bank.accounts, mode)[0];
                const when = bank.connection?.manual ? (bank.connection.lastOkAt ? fill(td.bank.byHand, { date: dayLabel(bank.connection.lastOkAt, lang) }) : td.bank.never) : bank.connection?.lastOkAt ? fill(td.bank.updated, { when: ago(bank.connection.lastOkAt, lang) }) : td.bank.never;
                const amount = lead ? `${lead.approx ? '≈ ' : ''}${formatMinor(lead.amount, lead.currency, lang)}` : '';
                return <SideRow key={bank.provider} when={when} what={`${bankLabel(bank.provider, context.logos[bank.provider])}${amount ? ` · ${amount}` : ''}`} />;
              })
            )}
          </SideCard>
        </>
      }
    />
  );
};

export default MoneyToday;
