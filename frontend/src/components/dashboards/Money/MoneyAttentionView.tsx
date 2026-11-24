import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { fill } from '../../../services/dashboards/calendarLabels';
import type { FinanceAccount, ProviderLogo } from '../../../services/dashboards/financeApi';
import type { MoneyDisplay } from '../../../services/dashboards/preferences';
import { bulkAttention, dismissAttention, markPaid, restoreAttention, snoozeAttention, updateRecurring, type Attention, type AttentionItem, type Recurring } from '../../../services/dashboards/recurringApi';
import DashIcon from '../DashIcon/DashIcon';
import BankMark from './BankMark';
import LimitForm from './LimitForm';
import RecurringIcon from './RecurringIcon';
import { groupAttention, type AttentionGroup } from './attentionModel';
import { useFact, useSubject } from './attentionText';
import { dayLabel } from './labels';
import { reconnectPath } from './providers';
import styles from './Recurring.module.css';

const SNOOZE_CHOICES = [1, 3, 7, 30] as const;
/** Rows shown per group before "Show all". */
const GROUP_ROWS = 3;
/** What "Snooze all" snoozes for, in days. */
const SNOOZE_ALL_DAYS = 7;

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


type RowContext = Omit<MoneyAttentionProps, 'data' | 'showHidden' | 'onToggleHidden'>;

/** One item as one dense row: its subject (a bank's icon or the payment's picture), the fact in short form, one primary action and a "⋯" menu with Open payment, Snooze (the days inside) and Dismiss. */
const AttentionRow: React.FC<RowContext & { item: AttentionItem }> = ({ item, recurring, accounts, logos, mode, onChanged, onOpenBank }) => {
  const { t, lang } = useDashboardLang();
  const m = t.money;
  const r = m.rec;
  const subject = useSubject(item, recurring, accounts, logos);
  const fact = useFact(item, mode);
  const [menu, setMenu] = useState(false);
  const [limitForm, setLimitForm] = useState(false);
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
    } else if (item.kind === 'overdrawn' && subject.account) {
      primary = (
        <button type="button" className={styles.small} aria-expanded={limitForm} onClick={() => setLimitForm((open) => !open)}>
          {r.setLimit}
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
      {limitForm && !hidden && subject.account && (
        <LimitForm account={subject.account} onDone={(saved) => { setLimitForm(false); if (saved) onChanged(); }} />
      )}
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

  /** One request for the whole group (the server's bulk endpoint); a failure is counted as the whole group. */
  const bulkAll = async (send: (keys: string[]) => Promise<void>) => {
    setBusy(true);
    setFailures(0);
    try {
      await send(items.map((item) => item.key));
    } catch {
      setFailures(items.length);
    }
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
        {/* A group of one has its row's own buttons: the group actions are for two or more. */}
        {(items.length > 1 || acceptable.length > 0) && (
        <span className={styles.agroupActions}>
          {acceptable.length > 0 && (
            <button type="button" className={styles.small} disabled={busy} onClick={() => bulk(async (item) => void (await updateRecurring(item.subjectId, { amount: item.amount ?? 0 })), acceptable)}>
              {r.acceptAll}
            </button>
          )}
          {items.length > 1 && (
            <>
          <button type="button" className={styles.small} disabled={busy} onClick={() => bulkAll((keys) => bulkAttention(keys, 'snooze', SNOOZE_ALL_DAYS))}>
            {r.snoozeAll}
          </button>
          {confirming ? (
            <span role="group" aria-label={fill(r.confirmDismiss, { n: items.length })} className={styles.confirm}>
              <span>{fill(r.confirmDismiss, { n: items.length })}</span>
              <button type="button" className={styles.small} disabled={busy} onClick={() => bulkAll((keys) => bulkAttention(keys, 'dismiss'))}>
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
            </>
          )}
        </span>
        )}
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


/**
 * The whole list of what needs attention (the "Attention" view): groups by the server's severity, one dense row per item with its primary
 * action and a "⋯" menu, three rows per group before "Show all", the group actions in each group's head, and the hidden items on request.
 * Nothing at all when there is nothing to look at.
 */
const MoneyAttentionView: React.FC<MoneyAttentionProps> = ({ data, showHidden, onToggleHidden, ...context }) => {
  const { t } = useDashboardLang();
  const r = t.money.rec;
  const groups = groupAttention(data.items);
  const hiddenItems = data.items.filter((item) => item.state !== 'active');
  const active = groups.reduce((n, group) => n + group.items.length, 0);
  return (
    <section aria-labelledby="money-attention-title" className={styles.panel}>
      <div className={styles.head}>
        <h2 id="money-attention-title" className={styles.title}>
          {r.attentionTitle}
        </h2>
        {active > 0 && <span className={styles.count}>{active}</span>}
      </div>
      <div className={styles.attentionBody}>
        {active === 0 && <p className={styles.none}>{r.attentionNone}</p>}
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
        {(data.hidden > 0 || showHidden) && (
          <p className={styles.hiddenLine}>
            {data.hidden > 0 && <span>{fill(r.hiddenCount, { n: data.hidden })}</span>}
            <button type="button" className={styles.linkButton} aria-pressed={showHidden} onClick={onToggleHidden}>
              {showHidden ? r.hideHidden : r.showHidden}
            </button>
          </p>
        )}
      </div>
    </section>
  );
};

export default MoneyAttentionView;
