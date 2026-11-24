import React, { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { fill } from '../../../services/dashboards/calendarLabels';
import type { FinanceAccount } from '../../../services/dashboards/financeApi';
import { minorToInput, parseMinor } from '../../../services/dashboards/money';
import type { MoneyDisplay } from '../../../services/dashboards/preferences';
import { createRecurring, FREQUENCIES, RECURRING_KINDS, refusal, updateRecurring, type Frequency, type Recurring, type RecurringBody, type RecurringKind } from '../../../services/dashboards/recurringApi';
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
  onDone: (saved: boolean) => void;
}

/** One payment's fields: name, amount, currency, kind, frequency, next date, the paying account (or a free-text method) and the text its bank line contains. */
const PaymentForm: React.FC<FormProps> = ({ initial, accounts, onDone }) => {
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
          <select id={`${id}-account`} className={styles.select} value={accountId} onChange={(event) => setAccountId(event.target.value)}>
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

const ManagerRow: React.FC<{ row: Recurring; accounts: readonly FinanceAccount[]; mode: MoneyDisplay; editing: boolean; onEdit: () => void; onChanged: () => void; onDone: (saved: boolean) => void }> = ({ row, accounts, mode, editing, onEdit, onChanged, onDone }) => {
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
            {[r.kinds[row.kind], frequencyLabel(row, r), row.scheduleState === 'ended_by_schedule' ? r.endedMark : row.nextDate ? dayLabel(row.nextDate, lang) : ''].filter(Boolean).join(' · ')}
          </span>
          <span className={styles.note}>{account ? fill(r.paidFrom, { account: account.name }) : row.paymentMethod ?? r.notLinked}</span>
          <TruthMark evidence={row.evidence} />
        </span>
        <strong className={styles.dueAmount}>
          <Amount amount={row.amount} currency={row.currency} display={row.display} mode={mode} />
        </strong>
      </div>
      {!editing && (
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={onEdit}>
            {r.edit}
          </button>
          <button type="button" className={styles.ghost} disabled={busy} onClick={toggle}>
            {row.isActive ? r.deactivate : r.activate}
          </button>
        </div>
      )}
      {failed && (
        <p role="alert" className={styles.error}>
          {r.actionFailed}
        </p>
      )}
      {editing && <PaymentForm initial={row} accounts={accounts} onDone={onDone} />}
    </li>
  );
};

export interface RecurringManagerProps {
  rows: readonly Recurring[];
  accounts: readonly FinanceAccount[];
  mode: MoneyDisplay;
  /** The payment to open for editing at once (from an attention card's "Open payment"). */
  editId: string | null;
  onChanged: () => void;
}

/** The plain management view: every recurring payment with search and a kind filter, add, edit (account, amount, next date, match text and the rest) and deactivate. */
const RecurringManager: React.FC<RecurringManagerProps> = ({ rows, accounts, mode, editId, onChanged }) => {
  const { t } = useDashboardLang();
  const r = t.money.rec;
  const searchId = useId();
  const kindId = useId();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<RecurringKind | ''>('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<string | 'new' | null>(editId);
  const needle = q.trim().toLowerCase();
  const editedInactive = rows.some((row) => row.id === editing && !row.isActive);
  const shown = rows.filter(
    (row) =>
      (row.isActive || showInactive || editedInactive || row.id === editing) &&
      (!kind || row.kind === kind) &&
      (!needle || [row.name, row.matchText, row.creditor, row.paymentMethod].some((text) => text?.toLowerCase().includes(needle))),
  );
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
      {editing === 'new' && <PaymentForm initial={null} accounts={accounts} onDone={done} />}
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
        <label className={styles.check}>
          <input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />
          <span>{r.showInactive}</span>
        </label>
      </div>
      <p className={styles.note}>{fill(r.paymentCount, { n: shown.length })}</p>
      {shown.length === 0 ? (
        <p className={styles.none}>{r.noMatches}</p>
      ) : (
        <ul className={styles.managedList}>
          {shown.map((row) => (
            <ManagerRow key={row.id} row={row} accounts={accounts} mode={mode} editing={editing === row.id} onEdit={() => setEditing(row.id)} onChanged={onChanged} onDone={done} />
          ))}
        </ul>
      )}
    </div>
  );
};

export default RecurringManager;
