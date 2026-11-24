import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { fill } from '../../../services/dashboards/calendarLabels';
import type { FinanceAccount, ProviderLogo } from '../../../services/dashboards/financeApi';
import type { MoneyDisplay } from '../../../services/dashboards/preferences';
import { dismissAttention, markPaid, movedOn, snoozeAttention, updateRecurring, type AttentionItem, type Recurring } from '../../../services/dashboards/recurringApi';
import LimitForm from './LimitForm';
import { useDetailRows, useSentence, useSubject } from './attentionText';
import { reconnectPath } from './providers';
import styles from './Attention.module.css';

const SNOOZE_CHOICES = [1, 3, 7, 30] as const;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface AttentionSheetProps {
  item: AttentionItem;
  recurring: readonly Recurring[];
  accounts: readonly FinanceAccount[];
  logos: Readonly<Record<string, ProviderLogo>>;
  mode: MoneyDisplay;
  /** The card that opened the sheet: focus goes back to it when the sheet closes. */
  opener: HTMLElement | null;
  onClose: () => void;
  /** The item was dealt with (paid, accepted, snoozed, dismissed): the page asks again and the sheet moves on. */
  onActed: (item: AttentionItem) => void | Promise<void>;
  /** Refetches the lists without moving on (after the payment turned out to have moved already). */
  onRefresh: () => Promise<void>;
  onOpenBank: (provider: string) => void;
}

/**
 * One item in detail, in a sheet from the right (from the bottom on a phone): the full sentence, the facts as a definition list with a link to
 * what it concerns, and the actions as buttons: the primary one for its kind, Snooze for 1, 3, 7 or 30 days, and Dismiss. Focus is held
 * inside, Escape closes it and focus returns to the card that opened it.
 */
const AttentionSheet: React.FC<AttentionSheetProps> = ({ item, recurring, accounts, logos, mode, opener, onClose, onActed, onRefresh, onOpenBank }) => {
  const { t } = useDashboardLang();
  const m = t.money;
  const r = m.rec;
  const subject = useSubject(item, recurring, accounts, logos);
  const sentence = useSentence(item, subject.name, mode);
  const rows = useDetailRows(item, mode);
  const dialog = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [limitForm, setLimitForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<'failed' | 'moved' | null>(null);

  // Focus goes in when the sheet opens and back to the card when it closes.
  useEffect(() => {
    closeButton.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
      else document.getElementById('money-attention-row')?.querySelector<HTMLElement>('button[data-key]')?.focus();
    };
    // Only on open and close (the opener stays the same while the sheet moves on to the next item, which keeps the focus where it is).
  }, [opener]);

  // A new item shows with its own form closed.
  useEffect(() => {
    setLimitForm(false);
    setFailed(null);
  }, [item.key]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setFailed(null);
    try {
      await action();
      await onActed(item);
    } catch (error) {
      // The payment moved on since the page showed it: nothing was done, the page is refreshed and says so (no retry).
      if (movedOn(error)) await onRefresh().catch(() => undefined);
      setFailed(movedOn(error) ? 'moved' : 'failed');
    } finally {
      setBusy(false);
    }
  };

  const payment = subject.payment;
  const provider = subject.provider;
  const charged = item.kind === 'amount_changed' && payment && item.amount !== null && item.amount > 0 && item.currency === payment.currency ? item.amount : null;
  const reconnect = item.kind === 'reconsent' && provider ? reconnectPath(logos[provider]) : null;
  const paymentLink = payment ? `?view=recurring&edit=${encodeURIComponent(payment.id)}` : null;
  const titleId = 'money-attention-sheet-title';

  let primary: React.ReactNode = null;
  if ((item.kind === 'missed_payment' || item.kind === 'due_not_covered') && payment) {
    primary = (
      <button type="button" className={styles.primary} disabled={busy} onClick={() => act(() => markPaid(payment.id, item.dueDate ?? payment.nextDate))}>
        {r.markPaid}
      </button>
    );
  } else if (item.kind === 'amount_changed' && payment && charged !== null) {
    primary = (
      <button type="button" className={styles.primary} disabled={busy} onClick={() => act(async () => void (await updateRecurring(payment.id, { amount: charged })))}>
        {r.acceptCharged}
      </button>
    );
  } else if (item.kind === 'overdrawn' && subject.account) {
    primary = (
      <button type="button" className={styles.primary} aria-expanded={limitForm} onClick={() => setLimitForm((open) => !open)}>
        {r.setLimit}
      </button>
    );
  } else if (reconnect) {
    primary = (
      <a className={styles.primary} href={reconnect}>
        {m.reconnect}
      </a>
    );
  } else if (provider && (item.kind === 'credit_high' || item.kind === 'overdraft' || item.kind === 'stale_statement' || item.kind === 'stale_connection' || item.kind === 'reconsent')) {
    primary = (
      <a
        className={styles.primary}
        href="#money-wallet-title"
        onClick={() => {
          onOpenBank(provider);
          onClose();
        }}
      >
        {item.kind === 'stale_statement' ? r.uploadStatement : r.openBank}
      </a>
    );
  }

  return (
    <div className={styles.sheetLayer}>
      <div className={styles.sheetBackdrop} aria-hidden="true" onClick={onClose} />
      <aside ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} className={styles.sheet} onKeyDown={onKeyDown} data-kind={item.kind}>
        <header className={styles.sheetHead}>
          <h2 id={titleId} className={styles.sheetTitle}>
            {subject.name}
          </h2>
          <button ref={closeButton} type="button" className={styles.sheetClose} onClick={onClose}>
            {r.sheetClose}
          </button>
        </header>
        <p className={styles.sheetSentence}>{sentence}</p>
        <dl className={styles.facts}>
          <div className={styles.fact}>
            <dt>{r.detail.concerns}</dt>
            <dd className={styles.factValue}>
              {paymentLink ? (
                <Link to={paymentLink} onClick={onClose}>
                  {subject.name}
                </Link>
              ) : provider ? (
                <a
                  href="#money-wallet-title"
                  onClick={() => {
                    onOpenBank(provider);
                    onClose();
                  }}
                >
                  {subject.name}
                </a>
              ) : (
                subject.name
              )}
            </dd>
          </div>
          {rows.map((row) => (
            <div key={row.label} className={styles.fact}>
              <dt>{row.label}</dt>
              <dd className={styles.factValue}>{row.value}</dd>
            </div>
          ))}
        </dl>
        {limitForm && subject.account && (
          <LimitForm
            account={subject.account}
            onDone={(saved) => {
              setLimitForm(false);
              if (saved) void onActed(item);
            }}
          />
        )}
        <div className={styles.sheetActions}>
          {primary}
          {paymentLink && primary !== null && (
            <Link className={styles.secondary} to={paymentLink} onClick={onClose}>
              {r.openPayment}
            </Link>
          )}
        </div>
        <div role="group" aria-label={r.snoozeHeading} className={styles.sheetActions}>
          <span className={styles.sheetLabel}>{r.snoozeHeading}</span>
          {SNOOZE_CHOICES.map((days) => (
            <button key={days} type="button" className={styles.secondary} disabled={busy} onClick={() => act(() => snoozeAttention(item.key, days))}>
              {fill(r.snoozeDays, { n: days })}
            </button>
          ))}
          <button type="button" className={styles.secondary} disabled={busy} onClick={() => act(() => dismissAttention(item.key))}>
            {r.dismiss}
          </button>
        </div>
        {failed && (
          <p role="alert" className={styles.error}>
            {failed === 'moved' ? r.alreadyMoved : r.actionFailed}
          </p>
        )}
      </aside>
    </div>
  );
};

export default AttentionSheet;
