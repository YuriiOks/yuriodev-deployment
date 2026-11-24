import React, { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { fill } from '../../../services/dashboards/calendarLabels';
import type { FinanceAccount } from '../../../services/dashboards/financeApi';
import { minorToInput, parseMinor } from '../../../services/dashboards/money';
import type { MoneyDisplay } from '../../../services/dashboards/preferences';
import { createRecurring, FREQUENCIES, RECURRING_KINDS, refreshIcon, refusal, updateRecurring, type Frequency, type Recurring, type RecurringBody, type RecurringKind } from '../../../services/dashboards/recurringApi';
import type { LoadStatus } from '../../../hooks/useFinance';
import InlineError from '../InlineError/InlineError';
import Amount from './Amount';
import { dayLabel } from './labels';
import RecurringIcon from './RecurringIcon';
import TruthMark from './TruthMark';
import { frequencyLabel } from './recurringLabels';
import styles from './Recurring.module.css';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

interface FormProps {
  /** The payment being changed, or null for a new one. */
  initial: Recurring | null;
  accounts: readonly FinanceAccount[];
  /** False until the accounts have been read: the Account choice waits, so a saved payment never loses its account to an empty list. */
  accountsReady?: boolean;
  onDone: (saved: boolean) => void;
  /** The icon was asked for again (the lists refresh to show it pending). */
  onIconRefreshed?: () => void;
}

/** "Refresh icon": asks the server to look for the payment's icon again; says when it is being looked for or could not be found. */
const RefreshIcon: React.FC<{ row: Recurring; onDone?: () => void }> = ({ row, onDone }) => {
  const { t } = useDashboardLang();
  const r = t.money.rec;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const ask = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await refreshIcon(row.id);
      onDone?.();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" className={styles.ghost} disabled={busy} onClick={() => void ask()}>
        {r.refreshIcon}
      </button>
      {row.iconState === 'pending' && <span className={styles.note}>{r.iconPending}</span>}
      {row.iconState === 'failed' && <span className={styles.note}>{r.iconFailed}</span>}
      {failed && (
        <span role="alert" className={styles.error}>
          {r.actionFailed}
        </span>
      )}
    </>
  );
};

/** One payment's fields: name, amount, currency, kind, frequency, next date, the paying account (or a free-text method) and the text its bank line contains. */
const PaymentForm: React.FC<FormProps> = ({ initial, accounts, accountsReady = true, onDone, onIconRefreshed }) => {
  const { t } = useDashboardLang();
  const r = t.money.rec;
  const id = useId();
  const [name, setName] = useState(initial?.name ?? '');
  const [currency, setCurrency] = useState(initial?.currency ?? 'GBP');
  const [amount, setAmount] = useState(initial ? minorToInput(initial.amount, initial.currency) : '');
  const [kind, setKind] = useState<RecurringKind>(initial?.kind ?? 'service');
  const [frequency, setFrequency] = useState<Frequency>(initial?.frequency ?? 'monthly');
  const [every, setEvery] = useState(String(initial?.frequencyInterval ?? 1));
  const [nextDate, setNextDate] = useState(initial?.nextDate ?? '');
  const [accountId, setAccountId] = useState(initial?.accountId ?? '');
  const [method, setMethod] = useState(initial?.paymentMethod ?? '');
  const [match, setMatch] = useState(initial?.matchText ?? '');
  const [website, setWebsite] = useState(initial?.website ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const payable = accounts.filter((account) => !account.archived && account.kind !== 'pot');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const code = currency.trim().toUpperCase();
    const minor = parseMinor(amount, code);
    const interval = Number(every);
    if (!name.trim()) return setProblem(fill(r.saveRefused, { why: r.fName }));
    if (minor === null || !/^[A-Z]{3}$/.test(code)) return setProblem(r.invalidAmount);
    if (nextDate && !DATE.test(nextDate)) return setProblem(r.invalidDate);
    if (!Number.isInteger(interval) || interval < 1) return setProblem(fill(r.saveRefused, { why: r.fEvery }));
    const next = nextDate || null;
    const body: RecurringBody = {};
    const set = <K extends keyof RecurringBody>(key: K, value: RecurringBody[K], was: unknown) => {
      if (!initial || value !== was) body[key] = value;
    };
    set('name', name.trim(), initial?.name);
    set('amount', minor, initial?.amount);
    set('currency', code, initial?.currency);
    set('kind', kind, initial?.kind);
    set('frequency', frequency, initial?.frequency);
    set('frequency_interval', interval, initial?.frequencyInterval);
    if (initial ? next !== initial.nextDate : next !== null) body.next_payment_date = next;
    if (initial ? (accountId || null) !== initial.accountId : accountId !== '') body.account_id = accountId || null;
    if (initial ? (method.trim() || null) !== initial.paymentMethod : method.trim() !== '') body.payment_method = method.trim() || null;
    if (initial ? (match.trim() || null) !== initial.matchText : match.trim() !== '') body.match_text = match.trim() || null;
    if (initial ? (website.trim() || null) !== initial.website : website.trim() !== '') body.website = website.trim() || null;
    setBusy(true);
    setProblem(null);
    try {
      if (initial) await updateRecurring(initial.id, body);
      else await createRecurring(body);
      onDone(true);
    } catch (error) {
      const why = refusal(error);
      setProblem(why ? fill(r.saveRefused, { why }) : r.saveFailed);
      setBusy(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={submit} aria-label={initial ? `${r.edit}: ${initial.name}` : r.add}>
      <div className={styles.formFields}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${id}-name`}>
            {r.fName}
          </label>
          <input id={`${id}-name`} className={styles.input} value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${id}-amount`}>
            {r.fAmount}
          </label>
          <input id={`${id}-amount`} className={styles.input} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${id}-currency`}>
            {r.fCurrency}
          </label>
          <input id={`${id}-currency`} className={styles.input} value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${id}-kind`}>
            {r.fKind}
          </label>
          <select id={`${id}-kind`} className={styles.select} value={kind} onChange={(event) => setKind(event.target.value as RecurringKind)}>
            {RECURRING_KINDS.map((choice) => (
              <option key={choice} value={choice}>
                {r.kinds[choice]}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${id}-frequency`}>
            {r.fFrequency}
          </label>
          <select id={`${id}-frequency`} className={styles.select} value={frequency} onChange={(event) => setFrequency(event.target.value as Frequency)}>
            {FREQUENCIES.map((choice) => (
              <option key={choice} value={choice}>
                {r.frequencies[choice]}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${id}-every`}>
            {r.fEvery}
          </label>
          <input id={`${id}-every`} className={styles.input} inputMode="numeric" value={every} onChange={(event) => setEvery(event.target.value)} />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${id}-next`}>
            {r.fNextDate}
          </label>
          <input id={`${id}-next`} className={styles.input} type="date" value={nextDate} onChange={(event) => setNextDate(event.target.value)} />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${id}-account`}>
            {r.fAccount}
          </label>
          <select id={`${id}-account`} className={styles.select} value={accountId} disabled={!accountsReady} onChange={(event) => setAccountId(event.target.value)}>
            <option value="">{r.noAccount}</option>
            {payable.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} · {account.currency}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${id}-method`}>
            {r.fMethod}
          </label>
          <input id={`${id}-method`} className={styles.input} value={method} maxLength={80} onChange={(event) => setMethod(event.target.value)} />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${id}-match`}>
            {r.fMatch}
          </label>
          <input id={`${id}-match`} className={styles.input} value={match} maxLength={80} aria-describedby={`${id}-match-hint`} onChange={(event) => setMatch(event.target.value)} />
          <span id={`${id}-match-hint`} className={styles.note}>
            {r.matchHint}
          </span>
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${id}-website`}>
            {r.fWebsite}
          </label>
          <input id={`${id}-website`} className={styles.input} value={website} maxLength={255} placeholder="example.com" aria-describedby={`${id}-website-hint`} onChange={(event) => setWebsite(event.target.value)} />
          <span id={`${id}-website-hint`} className={styles.note}>
            {r.websiteHint}
          </span>
          {initial && <RefreshIcon row={initial} onDone={onIconRefreshed} />}
        </div>
      </div>
      {problem && (
        <p role="alert" className={styles.error}>
          {problem}
        </p>
      )}
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={busy}>
          {r.save}
        </button>
        <button type="button" className={styles.ghost} disabled={busy} onClick={() => onDone(false)}>
          {r.cancel}
        </button>
      </div>
    </form>
  );
};

const ManagerRow: React.FC<{ row: Recurring; accounts: readonly FinanceAccount[]; accountsReady: boolean; mode: MoneyDisplay; editing: boolean; onEdit: () => void; onChanged: () => void; onDone: (saved: boolean) => void }> = ({ row, accounts, accountsReady, mode, editing, onEdit, onChanged, onDone }) => {
  const { t, lang } = useDashboardLang();
  const r = t.money.rec;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (editing) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [editing]);
  const account = row.accountId ? accounts.find((candidate) => candidate.id === row.accountId) : undefined;
  const toggle = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await updateRecurring(row.id, { is_active: !row.isActive });
      onChanged();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <li ref={ref} className={styles.managed} data-active={row.isActive ? 'true' : 'false'} data-payment={row.id}>
      <div className={styles.managedTop}>
        <RecurringIcon name={row.name} iconUrl={row.iconUrl} color={row.color} />
        <span className={styles.dueMain}>
          <strong className={styles.dueName}>
            {row.name}
            {!row.isActive && <span className={styles.badge}> · {r.inactive}</span>}
          </strong>
          <span className={styles.note}>
            {[r.kinds[row.kind], frequencyLabel(row, r), account ? fill(r.paidFrom, { account: account.name }) : row.paymentMethod ?? r.notLinked].filter(Boolean).join(' · ')}
          </span>
          <TruthMark evidence={row.evidence} />
        </span>
        <span className={styles.managedNext}>{row.scheduleState === 'ended_by_schedule' ? r.endedMark : row.nextDate ? dayLabel(row.nextDate, lang) : ''}</span>
        <strong className={styles.dueAmount}>
          <Amount amount={row.amount} currency={row.currency} display={row.display} mode={mode} />
        </strong>
        {!editing && <RowMenu name={row.name} active={row.isActive} busy={busy} onEdit={onEdit} onToggle={toggle} />}
      </div>
      {failed && (
        <p role="alert" className={styles.error}>
          {r.actionFailed}
        </p>
      )}
      {editing && <PaymentForm initial={row} accounts={accounts} accountsReady={accountsReady} onDone={onDone} onIconRefreshed={onChanged} />}
    </li>
  );
};

/** The row-end menu: Edit and Deactivate (or Activate). Escape and a click outside close it, and focus goes back to its button. */
const RowMenu: React.FC<{ name: string; active: boolean; busy: boolean; onEdit: () => void; onToggle: () => void }> = ({ name, active, busy, onEdit, onToggle }) => {
  const { t } = useDashboardLang();
  const r = t.money.rec;
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);
  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };
  return (
    <span
      ref={wrap}
      className={styles.menuWrap}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          setOpen(false);
          button.current?.focus();
        }
      }}
    >
      <button ref={button} type="button" className={styles.menuButton} aria-haspopup="menu" aria-expanded={open} aria-label={fill(r.rowActions, { name })} onClick={() => setOpen((on) => !on)}>
        <span aria-hidden="true">...</span>
      </button>
      {open && (
        <div role="menu" className={styles.menu}>
          <button type="button" role="menuitem" className={styles.menuItem} onClick={() => choose(onEdit)}>
            {r.edit}
          </button>
          <button type="button" role="menuitem" className={styles.menuItem} disabled={busy} onClick={() => choose(onToggle)}>
            {active ? r.deactivate : r.activate}
          </button>
        </div>
      )}
    </span>
  );
};

export interface RecurringManagerProps {
  rows: readonly Recurring[];
  accounts: readonly FinanceAccount[];
  /** How the accounts load went: the payments are listed without them, but their names and the Account choice wait. */
  accountsStatus?: LoadStatus;
  onRetryAccounts?: () => void;
  mode: MoneyDisplay;
  /** The payment to open for editing at once (from an attention card's "Open payment"). */
  editId: string | null;
  onChanged: () => void;
}

/** The plain management view: every recurring payment with search and a kind filter, add, edit (account, amount, next date, match text and the rest) and deactivate. */
const RecurringManager: React.FC<RecurringManagerProps> = ({ rows, accounts, accountsStatus = 'ready', onRetryAccounts, mode, editId, onChanged }) => {
  const accountsReady = accountsStatus === 'ready';
  const { t } = useDashboardLang();
  const r = t.money.rec;
  const searchId = useId();
  const kindId = useId();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<RecurringKind | ''>('');
  const [showInactive, setShowInactive] = useState(false);
  const [sort, setSort] = useState<'next' | 'name'>('next');
  const sortId = useId();
  const [editing, setEditing] = useState<string | 'new' | null>(editId);
  const needle = q.trim().toLowerCase();
  const editedInactive = rows.some((row) => row.id === editing && !row.isActive);
  const shown = rows.filter(
    (row) =>
      (row.isActive || showInactive || editedInactive || row.id === editing) &&
      (!kind || row.kind === kind) &&
      (!needle || [row.name, row.matchText, row.creditor, row.paymentMethod].some((text) => text?.toLowerCase().includes(needle))),
  );
  // One row per payment, by its next date (those with none, and the switched off, last) or by name.
  const ordered = [...shown].sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    // The switched off and the plans their own schedule has finished go last.
    const rank = (row: Recurring) => (row.isActive && row.scheduleState !== 'ended_by_schedule' ? 0 : 1);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.nextDate !== b.nextDate) return a.nextDate === null ? 1 : b.nextDate === null ? -1 : a.nextDate.localeCompare(b.nextDate);
    return a.name.localeCompare(b.name);
  });
  const done = (saved: boolean) => {
    setEditing(null);
    if (saved) onChanged();
  };
  return (
    <div className={styles.body}>
      <div className={styles.toolbar}>
        <Link className={styles.secondary} to="?">
          {r.backToMoney}
        </Link>
        <button type="button" className={styles.primary} onClick={() => setEditing('new')}>
          {r.add}
        </button>
      </div>
      {accountsStatus === 'error' && <InlineError message={t.money.accountsFailed} onRetry={onRetryAccounts} />}
      {editing === 'new' && <PaymentForm initial={null} accounts={accounts} accountsReady={accountsReady} onDone={done} />}
      <div className={styles.stickyTools}>
      <div className={styles.fields}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={searchId}>
            {r.searchPayments}
          </label>
          <input id={searchId} className={styles.input} type="search" value={q} onChange={(event) => setQ(event.target.value)} />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={kindId}>
            {r.kindFilter}
          </label>
          <select id={kindId} className={styles.select} value={kind} onChange={(event) => setKind(event.target.value as RecurringKind | '')}>
            <option value="">{r.allKinds}</option>
            {RECURRING_KINDS.map((choice) => (
              <option key={choice} value={choice}>
                {r.kinds[choice]}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={sortId}>
            {r.sortLabel}
          </label>
          <select id={sortId} className={styles.select} value={sort} onChange={(event) => setSort(event.target.value as 'next' | 'name')}>
            <option value="next">{r.sortNext}</option>
            <option value="name">{r.sortName}</option>
          </select>
        </div>
        <label className={styles.check}>
          <input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />
          <span>{r.showInactive}</span>
        </label>
      </div>
      <p className={styles.note}>{fill(r.paymentCount, { n: shown.length })}</p>
      </div>
      {shown.length === 0 ? (
        rows.length === 0 ? (
          <p className={styles.none}>{r.noneYet}</p>
        ) : (
          <p className={styles.none}>
            {r.noMatches}{' '}
            <button
              type="button"
              className={styles.more}
              onClick={() => {
                setQ('');
                setKind('');
                // Everything that is switched off is the only thing left to show when no payment is active.
                setShowInactive(!rows.some((row) => row.isActive));
              }}
            >
              {r.clearFilters}
            </button>
          </p>
        )
      ) : (
        <ul className={styles.managedList}>
          {ordered.map((row) => (
            <ManagerRow key={row.id} row={row} accounts={accounts} accountsReady={accountsReady} mode={mode} editing={editing === row.id} onEdit={() => setEditing(row.id)} onChanged={onChanged} onDone={done} />
          ))}
        </ul>
      )}
    </div>
  );
};

export default RecurringManager;
