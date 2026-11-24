import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { fill } from '../../../services/dashboards/calendarLabels';
import type { FinanceAccount } from '../../../services/dashboards/financeApi';
import { formatMinor } from '../../../services/dashboards/money';
import type { MoneyDisplay } from '../../../services/dashboards/preferences';
import type { ProviderLogo } from '../../../services/dashboards/financeApi';
import { dismissAttention, markPaid, restoreAttention, snoozeAttention, type Attention, type AttentionItem, type Recurring } from '../../../services/dashboards/recurringApi';
import DashIcon from '../DashIcon/DashIcon';
import { dayLabel } from './labels';
import { bankLabel, reconnectPath } from './providers';
import { amountText, dueWhen } from './recurringLabels';
import styles from './Recurring.module.css';

const SNOOZE_CHOICES = [1, 3, 7, 30] as const;

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

const AttentionCard: React.FC<Omit<MoneyAttentionProps, 'data' | 'showHidden' | 'onToggleHidden'> & { item: AttentionItem }> = ({ item, recurring, accounts, logos, mode, onChanged, onOpenBank }) => {
  const { t, lang } = useDashboardLang();
  const m = t.money;
  const r = m.rec;
  const subject = useSubject(item, recurring, accounts, logos);
  const sentence = useSentence(item, subject.name, mode);
  const [days, setDays] = useState<number>(7);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const hidden = item.state !== 'active';
  const reconnect = item.kind === 'reconsent' && subject.provider ? reconnectPath(subject.provider) : null;
  const paymentId = subject.payment?.id ?? null;
  const provider = subject.provider;
  const paymentLink = subject.payment ? `?view=recurring&edit=${encodeURIComponent(subject.payment.id)}` : null;

  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setFailed(false);
    try {
      await action();
      onChanged();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={styles.attention} data-kind={item.kind} data-state={item.state}>
      <span className={styles.attentionMark}>
        <DashIcon name="alert" size={16} />
      </span>
      <div className={styles.attentionBody}>
        <p className={styles.attentionText}>{sentence}</p>
        {hidden && (
          <p className={styles.note}>
            {item.state === 'snoozed' && item.snoozedUntil ? fill(r.snoozedUntil, { date: dayLabel(item.snoozedUntil, lang) }) : r.dismissed}
          </p>
        )}
        <div className={styles.actions}>
          {!hidden && (
            <>
              {(item.kind === 'missed_payment' || item.kind === 'due_not_covered') && paymentId && (
                <button type="button" className={styles.primary} disabled={busy} onClick={() => act(() => markPaid(paymentId))}>
                  {r.markPaid}
                </button>
              )}
              {paymentLink && (item.kind === 'missed_payment' || item.kind === 'due_not_covered' || item.kind === 'amount_changed') && (
                <Link className={item.kind === 'amount_changed' ? styles.primary : styles.secondary} to={paymentLink}>
                  {r.openPayment}
                </Link>
              )}
              {(item.kind === 'credit_high' || item.kind === 'overdraft' || item.kind === 'stale_statement' || (item.kind === 'reconsent' && !reconnect)) && provider && (
                <a className={styles.primary} href="#money-wallet-title" onClick={() => onOpenBank(provider)}>
                  {r.openBank}
                </a>
              )}
              {reconnect && (
                <a className={styles.primary} href={reconnect}>
                  {m.reconnect}
                </a>
              )}
              <span className={styles.snooze}>
                <label className={styles.snoozeLabel}>
                  <span className="sr-only">{r.snoozeFor}</span>
                  <select className={styles.select} value={days} disabled={busy} onChange={(event) => setDays(Number(event.target.value))}>
                    {SNOOZE_CHOICES.map((choice) => (
                      <option key={choice} value={choice}>
                        {fill(r.snoozeDays, { n: choice })}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className={styles.secondary} disabled={busy} onClick={() => act(() => snoozeAttention(item.key, days))}>
                  {r.snooze}
                </button>
              </span>
              <button type="button" className={styles.ghost} disabled={busy} onClick={() => act(() => dismissAttention(item.key))}>
                {r.dismiss}
              </button>
            </>
          )}
          {hidden && (
            <button type="button" className={styles.secondary} disabled={busy} onClick={() => act(() => restoreAttention(item.key))}>
              {r.restore}
            </button>
          )}
        </div>
        {failed && (
          <p role="alert" className={styles.error}>
            {r.actionFailed}
          </p>
        )}
      </div>
    </li>
  );
};

/** "Needs attention": one card per item with the facts as a sentence, the action that fits it, Snooze and Dismiss; nothing at all when there is none. */
const MoneyAttention: React.FC<MoneyAttentionProps> = ({ data, showHidden, onToggleHidden, ...rest }) => {
  const { t } = useDashboardLang();
  const r = t.money.rec;
  if (data.items.length === 0 && data.hidden === 0 && !showHidden) return null;
  return (
    <section aria-labelledby="money-attention-title" className={styles.panel}>
      <div className={styles.head}>
        <h2 id="money-attention-title" className={styles.title}>
          {r.attentionTitle}
        </h2>
        {(data.hidden > 0 || showHidden) && (
          <span className={styles.hiddenLine}>
            {data.hidden > 0 && <span>{fill(r.hiddenCount, { n: data.hidden })}</span>}
            <button type="button" className={styles.ghost} aria-pressed={showHidden} onClick={onToggleHidden}>
              {showHidden ? r.hideHidden : r.showHidden}
            </button>
          </span>
        )}
      </div>
      <ul className={styles.attentionList}>
        {data.items.map((item) => (
          <AttentionCard key={item.key} item={item} {...rest} />
        ))}
      </ul>
    </section>
  );
};

export default MoneyAttention;
