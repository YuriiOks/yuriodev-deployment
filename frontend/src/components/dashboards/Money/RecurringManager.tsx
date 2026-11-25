import React, { useEffect, useId, useRef, useState } from 'react';
import { cx } from '../../../utils/cx';
import { Link } from 'react-router-dom';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { useLimit } from '../../../hooks/useLimit';
import { fill } from '../../../services/dashboards/calendarLabels';
import type { FinanceAccount } from '../../../services/dashboards/financeApi';
import { formatMinor, minorToInput, parseMinor } from '../../../services/dashboards/money';
import type { MoneyDisplay } from '../../../services/dashboards/preferences';
import { createRecurring, deleteRecurring, FREQUENCIES, RECURRING_KINDS, refreshIcon, updateRecurring, uploadIcon, type Frequency, type Recurring, type RecurringBody, type RecurringKind } from '../../../services/dashboards/recurringApi';
import FieldIssue from './FieldIssue';
import { issueProps, NO_ISSUES, splitRefusal, type FieldIssues } from './fieldIssues';
import type { LoadStatus } from '../../../hooks/useFinance';
import InlineError from '../InlineError/InlineError';
import { ApiError } from '../../../services/dashboards/liveApi';
import Amount from './Amount';
import { dayLabel } from './labels';
import RecurringIcon from './RecurringIcon';
import TruthMark from './TruthMark';
import { frequencyLabel, todayIso } from './recurringLabels';
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

/** The short code the server gives for a failed fetch, as words (a code we do not know says so; `blocked_status_NNN` is a refusal by the site). */
function iconReason(code: string | null, reasons: Readonly<Record<string, string>>): string {
  if (!code) return reasons.other;
  if (code.startsWith('blocked_status_') && !(code in reasons)) return reasons.blocked_status_403;
  return reasons[code] ?? reasons.other;
}

/** "Refresh icon" asks the server to look for the payment's icon again; "Upload icon" sets one by hand (PNG or SVG). Says when it is being looked for or why it failed. */
const RefreshIcon: React.FC<{ row: Recurring; onDone?: () => void }> = ({ row, onDone }) => {
  const { t } = useDashboardLang();
  const r = t.money.rec;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const run = async (action: () => Promise<unknown>, why: (error: unknown) => string) => {
    setBusy(true);
    setFailed(null);
    try {
      await action();
      onDone?.();
    } catch (error) {
      setFailed(why(error));
    } finally {
      setBusy(false);
    }
  };
  const uploadWhy = (error: unknown): string => {
    const status = error instanceof ApiError ? error.status : 0;
    if (status === 415) return r.iconUploadErrors.type;
    if (status === 413) return r.iconUploadErrors.size;
    if (status === 422 && error instanceof ApiError && error.code === 'invalid_icon') return r.iconUploadErrors.invalid;
    return r.iconUploadErrors.failed;
  };
  return (
    <>
      <button type="button" className={styles.ghost} disabled={busy} onClick={() => void run(() => refreshIcon(row.id), () => r.actionFailed)}>
        {r.refreshIcon}
      </button>
      <button type="button" className={styles.ghost} disabled={busy} onClick={() => file.current?.click()}>
        {r.uploadIcon}
      </button>
      <input
        ref={file}
        type="file"
        accept="image/png,image/svg+xml"
        className="sr-only"
        tabIndex={-1}
        aria-label={r.uploadIcon}
        onChange={(event) => {
          const chosen = event.target.files?.[0];
          event.target.value = '';
          if (chosen) void run(() => uploadIcon(row.id, chosen), uploadWhy);
        }}
      />
      {row.iconState === 'pending' && <span className={styles.note}>{r.iconPending}</span>}
      {row.iconState === 'failed' && (
        <span className={styles.note}>
          {r.iconFailed}: {iconReason(row.iconError, r.iconReason)}
        </span>
      )}
      {failed && (
        <span role="alert" className={styles.error}>
          {failed}
        </span>
      )}
    </>
  );
};

/** The server's field names the payment form shows an input for (a refusal about one of them is told under it). */
const SHOWN = ['name', 'amount', 'currency', 'kind', 'frequency', 'frequency_interval', 'next_payment_date', 'start_date', 'account_id', 'payment_method', 'match_text', 'website', 'notes', 'reminder_days', 'total_installments', 'completed_installments', 'total_owed', 'remaining_balance', 'creditor'] as const;

/** One payment's fields: name, amount, currency, kind, frequency, next date, the paying account (or a free-text method) and the text its bank line contains. */
const PaymentForm: React.FC<FormProps> = ({ initial, accounts, accountsReady = true, onDone, onIconRefreshed }) => {
  const { t, lang } = useDashboardLang();
  const amountMax = useLimit('recurring', 'amount', Number.MAX_SAFE_INTEGER);
  const limits = { notes: useLimit('recurring', 'notes', 2000), name: useLimit('recurring', 'name', 120), method: useLimit('recurring', 'payment_method', 80), match: useLimit('recurring', 'match_text', 80) };
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
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [reminder, setReminder] = useState(initial?.reminderDays !== null && initial?.reminderDays !== undefined ? String(initial.reminderDays) : '');
  const [startDate, setStartDate] = useState(initial?.startDate ?? '');
  const [autoRenew, setAutoRenew] = useState(initial?.autoRenew ?? false);
  const [isInstallment, setIsInstallment] = useState(initial?.isInstallment ?? false);
  const [totalInst, setTotalInst] = useState(initial?.totalInstallments !== null && initial?.totalInstallments !== undefined ? String(initial.totalInstallments) : '');
  const [doneInst, setDoneInst] = useState(initial?.completedInstallments !== null && initial?.completedInstallments !== undefined ? String(initial.completedInstallments) : '');
  const [totalOwed, setTotalOwed] = useState(initial?.totalOwed !== null && initial?.totalOwed !== undefined ? minorToInput(initial.totalOwed, initial.currency) : '');
  const [remaining, setRemaining] = useState(initial?.remainingBalance !== null && initial?.remainingBalance !== undefined ? minorToInput(initial.remainingBalance, initial.currency) : '');
  const [creditor, setCreditor] = useState(initial?.creditor ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const [issues, setIssues] = useState<FieldIssues>(NO_ISSUES);
  const [busy, setBusy] = useState(false);
  const code3 = currency.trim().toUpperCase();
  // The paying accounts, those in the payment's own currency first; the account the payment is linked to is always among them (marked when it is archived or a pot).
  const open = accounts.filter((account) => !account.archived && account.kind !== 'pot');
  const linked = accountId ? accounts.find((account) => account.id === accountId) : undefined;
  const payable = [...open, ...(linked && !open.includes(linked) ? [linked] : [])].sort((a, b) => Number(b.currency === code3) - Number(a.currency === code3));
  const accountMissing = accountsReady && accountId !== '' && !linked;
  const mismatch = linked && linked.currency !== code3 ? linked : null;
  const today = todayIso();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const code = currency.trim().toUpperCase();
    const minor = parseMinor(amount, code);
    const interval = Number(every);
    if (!name.trim()) return setProblem(fill(r.saveRefused, { why: r.fName }));
    if (minor === null || !/^[A-Z]{3}$/.test(code)) return setProblem(r.invalidAmount);
    // The largest figure the server takes is checked before it is sent, and told under the amount like the server would.
    if (minor > amountMax) {
      setProblem(null);
      return setIssues({ amount: t.money.refusal.issues.out_of_range_max.replace('{limit}', formatMinor(amountMax, code, lang)) });
    }
    if (nextDate && !DATE.test(nextDate)) return setProblem(r.invalidDate);
    if (!Number.isInteger(interval) || interval < 1) return setProblem(fill(r.saveRefused, { why: r.fEvery }));
    const next = nextDate || null;
    // An active repeating payment needs a date to count from.
    if (frequency !== 'once' && (initial ? initial.isActive : true) && !next && !startDate) return setIssues({ next_payment_date: r.dateRequired });
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
    if (initial ? (startDate || null) !== initial.startDate : startDate !== '') body.start_date = startDate || null;
    if (initial ? (notes.trim() || null) !== initial.notes : notes.trim() !== '') body.notes = notes.trim() || null;
    const days = reminder.trim() === '' ? null : Number(reminder);
    if (days !== null && (!Number.isInteger(days) || days < 0 || days > 90)) return setIssues({ reminder_days: t.money.refusal.issues.out_of_range_max.replace('{limit}', '90') });
    if (initial ? days !== initial.reminderDays : days !== null) body.reminder_days = days;
    if (initial ? autoRenew !== initial.autoRenew : autoRenew) body.auto_renew = autoRenew;
    if (initial ? isInstallment !== initial.isInstallment : isInstallment) body.is_installment = isInstallment;
    if (isInstallment) {
      const count = (text: string): number | null | undefined => (text.trim() === '' ? null : Number.isInteger(Number(text)) && Number(text) >= 0 ? Number(text) : undefined);
      const total = count(totalInst);
      const paid = count(doneInst);
      if (total === undefined) return setIssues({ total_installments: t.money.refusal.issues.not_a_number });
      if (paid === undefined) return setIssues({ completed_installments: t.money.refusal.issues.not_a_number });
      if (total !== null && paid !== null && paid > total) return setIssues({ completed_installments: t.money.refusal.issues.exceeds_total });
      const owed = totalOwed.trim() === '' ? null : parseMinor(totalOwed, code);
      const left = remaining.trim() === '' ? null : parseMinor(remaining, code, { signed: true });
      if (totalOwed.trim() !== '' && owed === null) return setIssues({ total_owed: r.invalidAmount });
      if (remaining.trim() !== '' && left === null) return setIssues({ remaining_balance: r.invalidAmount });
      if (initial ? total !== initial.totalInstallments : total !== null) body.total_installments = total;
      if (initial ? paid !== initial.completedInstallments : paid !== null) body.completed_installments = paid;
      if (initial ? owed !== initial.totalOwed : owed !== null) body.total_owed = owed;
      if (initial ? left !== initial.remainingBalance : left !== null) body.remaining_balance = left;
      if (initial ? (creditor.trim() || null) !== initial.creditor : creditor.trim() !== '') body.creditor = creditor.trim() || null;
    }
    if (initial ? next !== initial.nextDate : next !== null) body.next_payment_date = next;
    if (initial ? (accountId || null) !== initial.accountId : accountId !== '') body.account_id = accountId || null;
    if (initial ? (method.trim() || null) !== initial.paymentMethod : method.trim() !== '') body.payment_method = method.trim() || null;
    if (initial ? (match.trim() || null) !== initial.matchText : match.trim() !== '') body.match_text = match.trim() || null;
    if (initial ? (website.trim() || null) !== initial.website : website.trim() !== '') body.website = website.trim() || null;
    // Nothing changed: the form closes without a request.
    if (initial && Object.keys(body).length === 0) return onDone(false);
    setBusy(true);
    setProblem(null);
    setIssues(NO_ISSUES);
    try {
      if (initial) await updateRecurring(initial.id, body);
      else await createRecurring(body);
      onDone(true);
    } catch (error) {
      // A 2xx whose body cannot be read was saved all the same: the list asks again.
      if (!(error instanceof ApiError)) return onDone(true);
      const split = splitRefusal(error, t.money.refusal, SHOWN);
      setIssues(split.issues);
      setProblem(split.other ? fill(r.saveRefused, { why: split.other }) : Object.keys(split.issues).length > 0 ? null : r.saveFailed);
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
          <input id={`${id}-name`} className={styles.input} {...issueProps(issues, 'name', id)} value={name} maxLength={limits.name} onChange={(event) => setName(event.target.value)} />
          <FieldIssue issues={issues} field="name" id={id} />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${id}-amount`}>
            {r.fAmount}
          </label>
          <input id={`${id}-amount`} className={styles.input} {...issueProps(issues, 'amount', id)} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
          <FieldIssue issues={issues} field="amount" id={id} />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${id}-currency`}>
            {r.fCurrency}
          </label>
          <input id={`${id}-currency`} className={styles.input} {...issueProps(issues, 'currency', id)} value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
          <FieldIssue issues={issues} field="currency" id={id} />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${id}-kind`}>
            {r.fKind}
          </label>
          <select id={`${id}-kind`} className={styles.select} {...issueProps(issues, 'kind', id)} value={kind} onChange={(event) => setKind(event.target.value as RecurringKind)}>
            {RECURRING_KINDS.map((choice) => (
              <option key={choice} value={choice}>
                {r.kinds[choice]}
              </option>
            ))}
          </select>
          <FieldIssue issues={issues} field="kind" id={id} />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${id}-frequency`}>
            {r.fFrequency}
          </label>
          <select id={`${id}-frequency`} className={styles.select} {...issueProps(issues, 'frequency', id)} value={frequency} onChange={(event) => setFrequency(event.target.value as Frequency)}>
            {FREQUENCIES.map((choice) => (
              <option key={choice} value={choice}>
                {r.frequencies[choice]}
              </option>
            ))}
          </select>
          <FieldIssue issues={issues} field="frequency" id={id} />
        </div>
        {frequency !== 'once' && (
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor={`${id}-every`}>
              {r.fEvery}
            </label>
            <span className={styles.everyRow}>
              <input id={`${id}-every`} className={styles.input} {...issueProps(issues, 'frequency_interval', id)} inputMode="numeric" value={every} onChange={(event) => setEvery(event.target.value)} />
              <span className={styles.note}>{r.everyUnits[frequency]}</span>
            </span>
            <FieldIssue issues={issues} field="frequency_interval" id={id} />
          </div>
        )}
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${id}-next`}>
            {r.fNextDate}
          </label>
          <input id={`${id}-next`} className={styles.input} {...issueProps(issues, 'next_payment_date', id)} type="date" value={nextDate} onChange={(event) => setNextDate(event.target.value)} />
          <FieldIssue issues={issues} field="next_payment_date" id={id} />
          {nextDate && nextDate < today && <span className={styles.note}>{r.datePast}</span>}
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${id}-start`}>
            {r.fStart}
          </label>
          <input id={`${id}-start`} className={styles.input} {...issueProps(issues, 'start_date', id)} type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          <FieldIssue issues={issues} field="start_date" id={id} />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${id}-account`}>
            {r.fAccount}
          </label>
          <select id={`${id}-account`} className={styles.select} {...issueProps(issues, 'account_id', id)} value={accountId} disabled={!accountsReady} onChange={(event) => setAccountId(event.target.value)}>
            <option value="">{r.noAccount}</option>
            {payable.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} · {account.currency}
                {account.archived ? ` · ${r.accountArchived}` : account.kind === 'pot' ? ` · ${r.accountPot}` : ''}
              </option>
            ))}
            {accountMissing && <option value={accountId}>{r.accountGone}</option>}
          </select>
          <FieldIssue issues={issues} field="account_id" id={id} />
          {mismatch && <span className={styles.note}>{fill(r.currencyMismatch, { account: mismatch.currency, payment: code3 })}</span>}
          {accountMissing && <span className={styles.note}>{r.accountGone}</span>}
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${id}-method`}>
            {r.fMethod}
          </label>
          <input id={`${id}-method`} className={styles.input} {...issueProps(issues, 'payment_method', id)} value={method} maxLength={limits.method} onChange={(event) => setMethod(event.target.value)} />
          <FieldIssue issues={issues} field="payment_method" id={id} />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${id}-match`}>
            {r.fMatch}
          </label>
          <input id={`${id}-match`} className={styles.input} {...issueProps(issues, 'match_text', id, `${id}-match-hint`)} value={match} maxLength={limits.match} onChange={(event) => setMatch(event.target.value)} />
          <FieldIssue issues={issues} field="match_text" id={id} />
          <span id={`${id}-match-hint`} className={styles.note}>
            {r.matchHint}
          </span>
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${id}-website`}>
            {r.fWebsite}
          </label>
          <input id={`${id}-website`} className={styles.input} {...issueProps(issues, 'website', id, `${id}-website-hint`)} value={website} maxLength={255} placeholder="example.com" onChange={(event) => setWebsite(event.target.value)} />
          <FieldIssue issues={issues} field="website" id={id} />
          <span id={`${id}-website-hint`} className={styles.note}>
            {r.websiteHint}
          </span>
          {initial && <RefreshIcon row={initial} onDone={onIconRefreshed} />}
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${id}-reminder`}>
            {r.fReminder}
          </label>
          <input id={`${id}-reminder`} className={styles.input} {...issueProps(issues, 'reminder_days', id)} inputMode="numeric" value={reminder} onChange={(event) => setReminder(event.target.value)} />
          <FieldIssue issues={issues} field="reminder_days" id={id} />
        </div>
        <label className={styles.check}>
          <input type="checkbox" checked={autoRenew} onChange={(event) => setAutoRenew(event.target.checked)} />
          <span>{r.fAutoRenew}</span>
        </label>
        <div className={cx(styles.field, styles.fieldWide)}>
          <label className={styles.fieldLabel} htmlFor={`${id}-notes`}>
            {r.fNotes}
          </label>
          <textarea id={`${id}-notes`} className={styles.textarea} {...issueProps(issues, 'notes', id)} value={notes} maxLength={limits.notes} onChange={(event) => setNotes(event.target.value)} />
          <FieldIssue issues={issues} field="notes" id={id} />
        </div>
      </div>
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>{r.sectionDebt}</legend>
        <label className={styles.check}>
          <input type="checkbox" checked={isInstallment} onChange={(event) => setIsInstallment(event.target.checked)} />
          <span>{r.fIsInstallment}</span>
        </label>
        {isInstallment && (
          <div className={styles.formFields}>
            {(
              [
                ['total_installments', r.fTotalInst, totalInst, setTotalInst, 'numeric'],
                ['completed_installments', r.fDoneInst, doneInst, setDoneInst, 'numeric'],
                ['total_owed', r.fTotalOwed, totalOwed, setTotalOwed, 'decimal'],
                ['remaining_balance', r.fRemaining, remaining, setRemaining, 'decimal'],
              ] as const
            ).map(([field, label, value, setValue, mode]) => (
              <div key={field} className={styles.field}>
                <label className={styles.fieldLabel} htmlFor={`${id}-${field}`}>
                  {label}
                </label>
                <input id={`${id}-${field}`} className={styles.input} {...issueProps(issues, field, id)} inputMode={mode} value={value} onChange={(event) => setValue(event.target.value)} />
                <FieldIssue issues={issues} field={field} id={id} />
              </div>
            ))}
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor={`${id}-creditor`}>
                {r.fCreditor}
              </label>
              <input id={`${id}-creditor`} className={styles.input} {...issueProps(issues, 'creditor', id)} value={creditor} maxLength={120} onChange={(event) => setCreditor(event.target.value)} />
              <FieldIssue issues={issues} field="creditor" id={id} />
            </div>
          </div>
        )}
      </fieldset>
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

const ManagerRow: React.FC<{ row: Recurring; accounts: readonly FinanceAccount[]; accountsReady: boolean; mode: MoneyDisplay; editing: boolean; onEdit: () => void; onChanged: () => void; onToggled: (id: string) => void; onDone: (saved: boolean) => void }> = ({ row, accounts, accountsReady, mode, editing, onEdit, onChanged, onToggled, onDone }) => {
  const { t, lang } = useDashboardLang();
  const r = t.money.rec;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (editing) ref.current?.scrollIntoView?.({ block: 'start' });
  }, [editing]);
  const account = row.accountId ? accounts.find((candidate) => candidate.id === row.accountId) : undefined;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const remove = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await deleteRecurring(row.id);
      onChanged();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };
  const toggle = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await updateRecurring(row.id, { is_active: !row.isActive });
      // A payment switched off stays where it is, dimmed, with "Activate" as its undo, until the list is left.
      onToggled(row.id);
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
            {[r.kinds[row.kind], frequencyLabel(row, r)].join(' · ')}
          </span>
        </span>
        <span className={styles.managedNext}>
          {row.scheduleState === 'ended_by_schedule' ? r.endedMark : row.nextDate ? dayLabel(row.nextDate, lang) : ''}
          <TruthMark evidence={row.evidence} />
        </span>
        <strong className={styles.dueAmount}>
          <Amount amount={row.amount} currency={row.currency} display={row.display} mode={mode} />
        </strong>
        {!editing && (
          <span className={styles.inlineActions}>
            <button type="button" className={styles.ghost} aria-label={`${r.edit}: ${row.name}`} onClick={onEdit}>
              {r.edit}
            </button>
            <button type="button" className={styles.ghost} aria-label={`${row.isActive ? r.deactivate : r.activate}: ${row.name}`} disabled={busy} onClick={() => void toggle()}>
              {row.isActive ? r.deactivate : r.activate}
            </button>
            <button type="button" className={styles.ghost} aria-label={`${r.deleteLabel}: ${row.name}`} disabled={busy} onClick={() => setConfirmDelete(true)}>
              {r.deleteLabel}
            </button>
          </span>
        )}
        {!editing && <RowMenu name={row.name} active={row.isActive} busy={busy} onDelete={() => setConfirmDelete(true)} payer={account ? fill(r.paidFrom, { account: account.name }) : row.paymentMethod ?? r.notLinked} onEdit={onEdit} onToggle={toggle} />}
      </div>
      {confirmDelete && (
        <div role="alertdialog" aria-label={fill(r.deleteAsk, { name: row.name })} className={styles.actions}>
          <span className={styles.note}>{fill(r.deleteAsk, { name: row.name })}</span>
          <button type="button" className={styles.secondary} disabled={busy} onClick={() => void remove()}>
            {r.deleteYes}
          </button>
          <button type="button" className={styles.ghost} disabled={busy} onClick={() => setConfirmDelete(false)}>
            {r.cancel}
          </button>
        </div>
      )}
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
const RowMenu: React.FC<{ name: string; active: boolean; busy: boolean; onDelete: () => void; /** What pays it (the account, the method, or "not linked to an account"): said here, not on the row. */ payer: string; onEdit: () => void; onToggle: () => void }> = ({ name, active, busy, payer, onEdit, onToggle, onDelete }) => {
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
          <span className={styles.menuNote}>{payer}</span>
          <button type="button" role="menuitem" className={styles.menuItem} onClick={() => choose(onEdit)}>
            {r.edit}
          </button>
          <button type="button" role="menuitem" className={styles.menuItem} disabled={busy} onClick={() => choose(onToggle)}>
            {active ? r.deactivate : r.activate}
          </button>
          <button type="button" role="menuitem" className={styles.menuItem} disabled={busy} onClick={() => choose(onDelete)}>
            {r.deleteLabel}
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
  /** The editing was closed (saved or not): the page drops `?edit=` from the address. */
  onEditClosed?: () => void;
  onChanged: () => void;
}

/** The plain management view: every recurring payment with search and a kind filter, add, edit (account, amount, next date, match text and the rest) and deactivate. */
const RecurringManager: React.FC<RecurringManagerProps> = ({ rows, accounts, accountsStatus = 'ready', onRetryAccounts, mode, editId, onEditClosed, onChanged }) => {
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
  // The address names the payment to edit (from an attention card's "Open payment"): a new name opens it, with the search and the filters left as they are.
  const [seenEditId, setSeenEditId] = useState(editId);
  if (editId !== seenEditId) {
    setSeenEditId(editId);
    setEditing(editId);
  }
  // Payments switched off in this view stay in place (dimmed, with "Activate" as the undo) until the view is left.
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  const needle = q.trim().toLowerCase();
  const matches = (row: Recurring) => (!kind || row.kind === kind) && (!needle || [row.name, row.matchText, row.creditor, row.paymentMethod].some((text) => text?.toLowerCase().includes(needle)));
  // The row being edited is always shown, whatever the search, the kind and the switched-off choice say.
  const shown = rows.filter((row) => row.id === editing || ((row.isActive || showInactive || kept.has(row.id)) && matches(row)));
  const hiddenInactive = rows.filter((row) => !row.isActive && !showInactive && !kept.has(row.id) && row.id !== editing && matches(row)).length;
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
    onEditClosed?.();
    if (saved) onChanged();
  };
  const missing = editing !== null && editing !== 'new' && !rows.some((row) => row.id === editing);
  return (
    <div className={styles.body}>
      <div className={styles.toolbar}>
        <Link className={styles.secondary} to="?view=payments">
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
      <p className={styles.note} role="status">
        {hiddenInactive > 0 ? fill(r.inactiveHidden, { n: shown.length, m: hiddenInactive }) : fill(r.paymentCount, { n: shown.length })}
      </p>
      {missing && (
        <p role="status" className={styles.note}>
          {r.gone}{' '}
          <button type="button" className={styles.more} onClick={() => done(false)}>
            {r.cancel}
          </button>
        </p>
      )}
      </div>
      {shown.length === 0 && hiddenInactive > 0 && rows.some((row) => row.isActive && matches(row)) === false ? (
        <p className={styles.none}>
          {r.onlyInactive}{' '}
          <button type="button" className={styles.more} onClick={() => setShowInactive(true)}>
            {r.showInactive}
          </button>
        </p>
      ) : shown.length === 0 ? (
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
            <ManagerRow key={row.id} row={row} accounts={accounts} accountsReady={accountsReady} mode={mode} editing={editing === row.id} onEdit={() => setEditing(row.id)} onChanged={onChanged} onToggled={(id) => setKept((before) => new Set(before).add(id))} onDone={done} />
          ))}
        </ul>
      )}
    </div>
  );
};

export default RecurringManager;
