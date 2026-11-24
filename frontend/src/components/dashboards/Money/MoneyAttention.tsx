import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { fill } from '../../../services/dashboards/calendarLabels';
import type { FinanceAccount } from '../../../services/dashboards/financeApi';
import { formatMinor } from '../../../services/dashboards/money';
import { readAttentionOpen, writeAttentionOpen, type MoneyDisplay } from '../../../services/dashboards/preferences';
import type { ProviderLogo } from '../../../services/dashboards/financeApi';
import { dismissAttention, markPaid, restoreAttention, snoozeAttention, updateRecurring, type Attention, type AttentionItem, type Recurring } from '../../../services/dashboards/recurringApi';
import DashIcon from '../DashIcon/DashIcon';
import BankMark from './BankMark';
import RecurringIcon from './RecurringIcon';
import { groupAttention, isUrgent, mostUrgent, pluralForm, type AttentionGroup } from './attentionModel';
import { dayLabel } from './labels';
import { bankLabel, reconnectPath } from './providers';
import { amountText, dueWhen } from './recurringLabels';
import styles from './Recurring.module.css';

const SNOOZE_CHOICES = [1, 3, 7, 30] as const;
/** Rows shown per group before "Show all". */
const GROUP_ROWS = 3;
/** What "Snooze all" snoozes for, in days. */
const SNOOZE_ALL_DAYS = 7;

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

export interface MoneyAttentionProps {
  data: Attention;
  recurring: readonly Recurring[];
  accounts: readonly FinanceAccount[];
  /** The banks' names as the server gives them. */
  logos: Readonly<Record<string, ProviderLogo>>;
  mode: MoneyDisplay;
  showHidden: boolean;
  onToggleHidden: () => void;
  /** Something changed on the server (paid, snoozed, dismissed, restored): the page asks again. */
  onChanged: () => void;
  onOpenBank: (provider: string) => void;
}

/** The item's subject: the payment, the account or the bank it is about. */
function useSubject(item: AttentionItem, recurring: readonly Recurring[], accounts: readonly FinanceAccount[], logos: Readonly<Record<string, ProviderLogo>>) {
  const payment = item.subjectType === 'recurring' ? recurring.find((row) => row.id === item.subjectId) : undefined;
  const account = item.subjectType === 'account' ? accounts.find((row) => row.id === item.subjectId) : undefined;
  const provider = account?.provider ?? (typeof item.facts.provider === 'string' ? item.facts.provider : null);
  return { payment, account, provider, name: payment?.name ?? account?.name ?? (provider ? bankLabel(provider, logos[provider]) : item.title) };
}

/** The facts behind an item as one plain sentence in the page's language; the server's English title only when a fact is missing. */
function useSentence(item: AttentionItem, name: string, mode: MoneyDisplay): string {
  const { t, lang } = useDashboardLang();
  const r = t.money.rec;
  const money = (minor: number | null, code: string | null) => (minor !== null && code ? formatMinor(minor, code, lang) : null);
  const own = item.amount !== null && item.currency ? amountText(item.amount, item.currency, item.display, mode, lang) : null;
  const f = item.facts;
  switch (item.kind) {
    case 'due_not_covered': {
      const days = num(f.due_in_days);
      if (days === null || own === null) return item.title;
      const shortfall = money(num(f.shortfall), typeof f.account_currency === 'string' ? f.account_currency : null);
      return shortfall ? fill(r.sentence.due_not_covered, { name, when: dueWhen(days, r), amount: own, short: shortfall }) : fill(r.sentenceShort, { name, when: dueWhen(days, r), amount: own });
    }
    case 'missed_payment': {
      const days = num(f.days_overdue);
      return days === null || own === null ? item.title : fill(r.sentence.missed_payment, { name, days, amount: own });
    }
    case 'amount_changed': {
      const recorded = money(num(f.recorded_amount), item.currency);
      return recorded === null || own === null ? item.title : fill(r.sentence.amount_changed, { name, charged: own, recorded });
    }
    case 'credit_high': {
      const percent = num(f.used_percent);
      const owed = money(num(f.owed), item.currency);
      const limit = money(num(f.credit_limit), item.currency);
      return percent === null || !owed || !limit ? item.title : fill(r.sentence.credit_high, { name, percent, owed, limit });
    }
    case 'overdraft':
      return own === null ? item.title : fill(r.sentence.overdraft, { name, over: own });
    case 'reconsent':
      return fill(r.sentence.reconsent, { bank: name });
    case 'stale_statement': {
      const days = num(f.days_old);
      return days === null || typeof f.as_of !== 'string' ? item.title : fill(r.sentence.stale_statement, { bank: name, days, date: dayLabel(f.as_of, lang) });
    }
  }
}

/** The fact behind an item in short form for its row ("£19.99, recorded £12.99"); the server's title when a fact is missing. */
function useFact(item: AttentionItem, mode: MoneyDisplay): string {
  const { t, lang } = useDashboardLang();
  const r = t.money.rec;
  const money = (minor: number | null, code: string | null) => (minor !== null && code ? formatMinor(minor, code, lang) : null);
  const own = item.amount !== null && item.currency ? amountText(item.amount, item.currency, item.display, mode, lang) : null;
  const f = item.facts;
  switch (item.kind) {
    case 'due_not_covered': {
      const days = num(f.due_in_days);
      if (days === null || own === null) return item.title;
      const shortfall = money(num(f.shortfall), typeof f.account_currency === 'string' ? f.account_currency : null);
      return shortfall ? fill(r.fact.due_not_covered, { amount: own, when: dueWhen(days, r), short: shortfall }) : `${own} ${dueWhen(days, r)} · ${r.notCovered}`;
    }
    case 'missed_payment': {
      const days = num(f.days_overdue);
      return days === null || own === null ? item.title : fill(r.fact.missed_payment, { amount: own, days });
    }
    case 'amount_changed': {
      const recorded = money(num(f.recorded_amount), item.currency);
      return recorded === null || own === null ? item.title : fill(r.fact.amount_changed, { charged: own, recorded });
    }
    case 'credit_high': {
      const percent = num(f.used_percent);
      return percent === null ? item.title : fill(r.fact.credit_high, { percent });
    }
    case 'overdraft':
      return own === null ? item.title : fill(r.fact.overdraft, { over: own });
    case 'reconsent':
      return r.fact.reconsent;
    case 'stale_statement': {
      const days = num(f.days_old);
      return days === null || typeof f.as_of !== 'string' ? item.title : fill(r.fact.stale_statement, { date: dayLabel(f.as_of, lang), days });
    }
  }
}

type RowContext = Omit<MoneyAttentionProps, 'data' | 'showHidden' | 'onToggleHidden'>;

/** One item as one dense row: its subject (a bank's icon or the payment's picture), the fact in short form, one primary action and a "⋯" menu with Open payment, Snooze (the days inside) and Dismiss. */
const AttentionRow: React.FC<RowContext & { item: AttentionItem }> = ({ item, recurring, accounts, logos, mode, onChanged, onOpenBank }) => {
  const { t, lang } = useDashboardLang();
  const m = t.money;
  const r = m.rec;
  const subject = useSubject(item, recurring, accounts, logos);
  const fact = useFact(item, mode);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const hidden = item.state !== 'active';
  const provider = subject.provider;
  const reconnect = item.kind === 'reconsent' && provider ? reconnectPath(provider) : null;
  const payment = subject.payment;
  const paymentLink = payment ? `?view=recurring&edit=${encodeURIComponent(payment.id)}` : null;
  const charged = item.kind === 'amount_changed' && payment && item.amount !== null && item.amount > 0 && item.currency === payment.currency ? item.amount : null;

  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setFailed(false);
    try {
      await action();
      setMenu(false);
      onChanged();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  let primary: React.ReactNode = null;
  if (!hidden) {
    if (item.kind === 'amount_changed' && payment && charged !== null) {
      primary = (
        <button type="button" className={styles.small} disabled={busy} onClick={() => act(async () => void (await updateRecurring(payment.id, { amount: charged })))}>
          {r.accept}
        </button>
      );
    } else if ((item.kind === 'missed_payment' || item.kind === 'due_not_covered') && payment) {
      primary = (
        <button type="button" className={styles.small} disabled={busy} onClick={() => act(() => markPaid(payment.id))}>
          {r.markPaid}
        </button>
      );
    } else if (reconnect) {
      primary = (
        <a className={styles.small} href={reconnect}>
          {m.reconnect}
        </a>
      );
    } else if (provider && (item.kind === 'credit_high' || item.kind === 'overdraft' || item.kind === 'stale_statement' || item.kind === 'reconsent')) {
      primary = (
        <a className={styles.small} href="#money-wallet-title" onClick={() => onOpenBank(provider)}>
          {r.openBank}
        </a>
      );
    }
  } else {
    primary = (
      <button type="button" className={styles.small} disabled={busy} onClick={() => act(() => restoreAttention(item.key))}>
        {r.restore}
      </button>
    );
  }

  const subjectIcon = payment ? (
    <RecurringIcon name={payment.name} iconUrl={payment.iconUrl} color={payment.color} />
  ) : provider ? (
    <BankMark provider={provider} logo={logos[provider]} />
  ) : (
    <span aria-hidden="true" className={styles.arowAlert}>
      <DashIcon name="alert" size={16} />
    </span>
  );

  return (
    <li className={styles.arow} data-kind={item.kind} data-state={item.state}>
      <span className={styles.arowIcon}>{subjectIcon}</span>
      <span className={styles.arowMain}>
        <strong className={styles.arowName}>{subject.name}</strong>
        <span className={styles.arowFact}>{hidden ? (item.state === 'snoozed' && item.snoozedUntil ? fill(r.snoozedUntil, { date: dayLabel(item.snoozedUntil, lang) }) : r.dismissed) : fact}</span>
      </span>
      <span className={styles.arowActions}>
        {primary}
        {!hidden && (
          <button type="button" className={styles.dots} aria-expanded={menu} aria-label={fill(r.more, { name: subject.name })} onClick={() => setMenu((open) => !open)}>
            <span aria-hidden="true">⋯</span>
          </button>
        )}
      </span>
      {menu && !hidden && (
        <div role="group" aria-label={fill(r.more, { name: subject.name })} className={styles.arowMenu}>
          {paymentLink && (
            <Link className={styles.small} to={paymentLink}>
              {r.openPayment}
            </Link>
          )}
          {SNOOZE_CHOICES.map((days) => (
            <button key={days} type="button" className={styles.small} disabled={busy} onClick={() => act(() => snoozeAttention(item.key, days))}>
              {fill(r.snoozeItem, { n: days })}
            </button>
          ))}
          <button type="button" className={styles.small} disabled={busy} onClick={() => act(() => dismissAttention(item.key))}>
            {r.dismiss}
          </button>
        </div>
      )}
      {failed && (
        <p role="alert" className={styles.arowError}>
          {r.actionFailed}
        </p>
      )}
    </li>
  );
};

/** A kind's group: its title and count, the group actions (Accept charged amounts for a changed amount; Snooze all; Dismiss all after a confirmation) and its first three rows, the rest on "Show all". */
const AttentionGroupBlock: React.FC<RowContext & { group: AttentionGroup }> = ({ group, ...context }) => {
  const { t } = useDashboardLang();
  const r = t.money.rec;
  const [all, setAll] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState(0);
  const items = group.items;
  const shown = all ? items : items.slice(0, GROUP_ROWS);
  const payments = new Map(context.recurring.map((row) => [row.id, row]));

  /** One request per item, one after the other; what fails is counted and the rest goes on. */
  const bulk = async (each: (item: AttentionItem) => Promise<void>, list: readonly AttentionItem[] = items) => {
    setBusy(true);
    setFailures(0);
    let failed = 0;
    for (const item of list) {
      try {
        await each(item);
      } catch {
        failed += 1;
      }
    }
    setFailures(failed);
    setConfirming(false);
    setBusy(false);
    context.onChanged();
  };

  const acceptable = group.kind === 'amount_changed' ? items.filter((item) => item.amount !== null && item.amount > 0 && payments.get(item.subjectId)?.currency === item.currency) : [];
  const titleId = `money-attention-${group.kind}`;
  return (
    <div role="group" aria-labelledby={titleId} className={styles.agroup} data-kind={group.kind}>
      <div className={styles.agroupHead}>
        <h3 id={titleId} className={styles.agroupTitle}>
          {r.groupTitle[group.kind]} <span className={styles.agroupCount}>{items.length}</span>
        </h3>
        <span className={styles.agroupActions}>
          {acceptable.length > 0 && (
            <button type="button" className={styles.small} disabled={busy} onClick={() => bulk(async (item) => void (await updateRecurring(item.subjectId, { amount: item.amount ?? 0 })), acceptable)}>
              {r.acceptAll}
            </button>
          )}
          <button type="button" className={styles.small} disabled={busy} onClick={() => bulk((item) => snoozeAttention(item.key, SNOOZE_ALL_DAYS))}>
            {r.snoozeAll}
          </button>
          {confirming ? (
            <span role="group" aria-label={fill(r.confirmDismiss, { n: items.length })} className={styles.confirm}>
              <span>{fill(r.confirmDismiss, { n: items.length })}</span>
              <button type="button" className={styles.small} disabled={busy} onClick={() => bulk((item) => dismissAttention(item.key))}>
                {r.confirmYes}
              </button>
              <button type="button" className={styles.small} disabled={busy} onClick={() => setConfirming(false)}>
                {r.cancel}
              </button>
            </span>
          ) : (
            <button type="button" className={styles.small} disabled={busy} onClick={() => setConfirming(true)}>
              {r.dismissAll}
            </button>
          )}
        </span>
      </div>
      <ul className={styles.arows}>
        {shown.map((item) => (
          <AttentionRow key={item.key} item={item} {...context} />
        ))}
      </ul>
      {items.length > GROUP_ROWS && (
        <button type="button" className={styles.more} aria-expanded={all} onClick={() => setAll((on) => !on)}>
          {all ? r.showFewer : fill(r.showAllN, { n: items.length })}
        </button>
      )}
      {failures > 0 && (
        <p role="alert" className={styles.arowError}>
          {fill(r.bulkFailed, { n: failures })}
        </p>
      )}
    </div>
  );
};

/** The most urgent item in words, for the collapsed strip. */
const UrgentLine: React.FC<RowContext & { item: AttentionItem }> = ({ item, recurring, accounts, logos, mode }) => {
  const subject = useSubject(item, recurring, accounts, logos);
  const sentence = useSentence(item, subject.name, mode);
  return (
    <p className={styles.urgent} data-kind={item.kind}>
      <DashIcon name="alert" size={14} />
      <span>{sentence}</span>
    </p>
  );
};

/**
 * "Needs attention": ONE compact strip, collapsed by default (remembered per viewer): the count, a chip per kind, and the most urgent item in
 * words. Opened, the items are grouped by kind in severity order, each as one dense row with its primary action and a "⋯" menu, three rows
 * per group before "Show all", and the group actions in the group's head. Nothing is rendered when there is nothing to look at.
 */
const MoneyAttention: React.FC<MoneyAttentionProps> = ({ data, showHidden, onToggleHidden, ...context }) => {
  const { t, lang } = useDashboardLang();
  const r = t.money.rec;
  const [open, setOpen] = useState(readAttentionOpen);
  const groups = groupAttention(data.items);
  const active = groups.reduce((n, group) => n + group.items.length, 0);
  const hiddenItems = data.items.filter((item) => item.state !== 'active');
  if (active === 0 && data.hidden === 0 && !showHidden) return null;
  const expanded = open || (active === 0 && showHidden);
  const toggle = () => {
    setOpen(!open);
    writeAttentionOpen(!open);
  };
  const urgent = mostUrgent(data.items);
  return (
    <section aria-labelledby="money-attention-title" className={styles.strip}>
      <div className={styles.stripHead}>
        <h2 id="money-attention-title" className={styles.stripTitle}>
          {r.attentionTitle}
        </h2>
        {active > 0 && <span className={styles.stripCount}>{active}</span>}
        {active > 0 && (
          <button type="button" className={styles.stripToggle} aria-expanded={expanded} aria-controls="money-attention-body" onClick={toggle}>
            {expanded ? r.attentionClose : r.attentionOpen}
          </button>
        )}
      </div>
      <div id="money-attention-body">
        {!expanded && active > 0 && (
          <>
            <ul className={styles.stripChips}>
              {groups.map((group) => (
                <li key={group.kind} className={styles.stripChip} data-kind={group.kind} data-urgent={isUrgent(group.kind) ? 'true' : 'false'}>
                  {fill(pluralForm(r.chip[group.kind], group.items.length, lang), { n: group.items.length })}
                </li>
              ))}
            </ul>
            {urgent && <UrgentLine item={urgent} {...context} />}
          </>
        )}
        {expanded && (
          <div className={styles.agroups}>
            {groups.map((group) => (
              <AttentionGroupBlock key={group.kind} group={group} {...context} />
            ))}
            {showHidden && hiddenItems.length > 0 && (
              <div role="group" aria-label={r.hiddenTitle} className={styles.agroup}>
                <div className={styles.agroupHead}>
                  <h3 className={styles.agroupTitle}>
                    {r.hiddenTitle} <span className={styles.agroupCount}>{hiddenItems.length}</span>
                  </h3>
                </div>
                <ul className={styles.arows}>
                  {hiddenItems.map((item) => (
                    <AttentionRow key={item.key} item={item} {...context} />
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
      {(expanded || active === 0) && (data.hidden > 0 || showHidden) && (
        <p className={styles.hiddenLine}>
          {data.hidden > 0 && <span>{fill(r.hiddenCount, { n: data.hidden })}</span>}
          <button type="button" className={styles.linkButton} aria-pressed={showHidden} onClick={onToggleHidden}>
            {showHidden ? r.hideHidden : r.showHidden}
          </button>
        </p>
      )}
    </section>
  );
};

export default MoneyAttention;
