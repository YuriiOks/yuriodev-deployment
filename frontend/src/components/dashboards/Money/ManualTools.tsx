import React, { useId, useState } from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { fill } from '../../../services/dashboards/calendarLabels';
import type { FinanceAccount } from '../../../services/dashboards/financeApi';
import { setManualBalance, uploadStatement, type StatementResult } from '../../../services/dashboards/manualApi';
import { formatMinor, minorToInput, parseMinor } from '../../../services/dashboards/money';
import { refusal } from '../../../services/dashboards/recurringApi';
import { dayLabel } from './labels';
import styles from './Manual.module.css';

type Panel = 'balance' | 'statement' | null;

/** The file's bytes (a FileReader works wherever a file input does). */
const readFile = (file: File) =>
  new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('unreadable file'));
    reader.readAsArrayBuffer(file);
  });

/** The form for a balance with a date: the balance (a card: what is owed), and the day it is as of (empty: now). */
const BalanceForm: React.FC<{ account: FinanceAccount; onDone: (saved: boolean) => void }> = ({ account, onDone }) => {
  const { t } = useDashboardLang();
  const x = t.money.manual;
  const id = useId();
  const card = account.kind === 'credit_card';
  const [amount, setAmount] = useState(minorToInput(card ? -account.ownBalance : account.ownBalance, account.currency));
  const [asOf, setAsOf] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    // A balance may be nothing or below it; what is owed on a card may be nothing (a card paid off) but never below it.
    const minor = parseMinor(amount, account.currency, { signed: true });
    if (minor === null) return setProblem(card ? x.owedInvalid : x.balanceInvalid);
    if (card && minor < 0) return setProblem(x.owedInvalid);
    setBusy(true);
    setProblem(null);
    try {
      await setManualBalance(account.id, card ? { owed: minor } : { balance: minor }, asOf || null);
      onDone(true);
    } catch (error) {
      const why = refusal(error);
      setProblem(why ?? x.balanceFailed);
      setBusy(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={submit} aria-label={`${x.updateBalance}: ${account.name}`}>
      <div className={styles.fields}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${id}-amount`}>
            {card ? x.fOwed : x.fBalance} ({account.currency})
          </label>
          <input id={`${id}-amount`} className={styles.input} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${id}-asof`}>
            {x.fAsOf}
          </label>
          <input id={`${id}-asof`} className={styles.input} type="date" value={asOf} aria-describedby={`${id}-asof-hint`} onChange={(event) => setAsOf(event.target.value)} />
          <span id={`${id}-asof-hint`} className={styles.note}>
            {x.asOfHint}
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
          {x.saveBalance}
        </button>
        <button type="button" className={styles.ghost} disabled={busy} onClick={() => onDone(false)}>
          {x.close}
        </button>
      </div>
    </form>
  );
};

/** What a statement upload did, or with a dry run would do: the totals to check against the bank's own statement, and every bad line. */
const Summary: React.FC<{ result: StatementResult; currency: string }> = ({ result, currency }) => {
  const { t, lang } = useDashboardLang();
  const x = t.money.manual;
  return (
    <div className={styles.summary}>
      {result.errors.length > 0 ? (
        <>
          <h4 className={styles.summaryTitle}>{fill(x.errorsTitle, { n: result.errors.length })}</h4>
          <ul className={styles.errorList}>
            {result.errors.map((error, index) => (
              <li key={`${error.row}-${index}`}>{fill(x.errorLine, { row: error.row, message: error.field ? `${error.field}: ${error.message}` : error.message })}</li>
            ))}
          </ul>
        </>
      ) : (
        <ul className={styles.summaryList}>
          {result.layout && <li>{fill(x.layoutLine, { layout: result.layout })}</li>}
          <li>{fill(x.parsedLine, { n: result.parsed })}</li>
          <li>{fill(x.createdLine, { n: result.created })}</li>
          <li>{fill(x.duplicatesLine, { n: result.duplicates })}</li>
          {result.firstDate && result.lastDate && <li>{fill(x.rangeLine, { from: dayLabel(result.firstDate, lang), to: dayLabel(result.lastDate, lang) })}</li>}
          <li>{fill(x.moneyInLine, { amount: formatMinor(result.moneyIn, currency, lang) })}</li>
          <li>{fill(x.moneyOutLine, { amount: formatMinor(result.moneyOut, currency, lang) })}</li>
          {result.balanceApplied && <li>{x.balanceApplied}</li>}
        </ul>
      )}
    </div>
  );
};

type Stage = { kind: 'idle' } | { kind: 'busy'; what: 'check' | 'import' } | { kind: 'checked'; result: StatementResult } | { kind: 'done'; result: StatementResult } | { kind: 'failed'; message: string };

/**
 * Uploading a statement: choose the file, check it first (a dry run: nothing is saved, the totals are shown to compare with the bank's own
 * statement, every bad line is listed), then import. A changed choice after a check asks for the check again.
 */
const StatementUpload: React.FC<{ account: FinanceAccount; onDone: (saved: boolean) => void; onImported: () => void }> = ({ account, onDone, onImported }) => {
  const { t } = useDashboardLang();
  const x = t.money.manual;
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [dateOrder, setDateOrder] = useState<'' | 'dmy' | 'mdy'>('');
  const [applyBalance, setApplyBalance] = useState(false);
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });

  const reset = () => setStage({ kind: 'idle' });
  const run = async (dryRun: boolean) => {
    if (!file) return setStage({ kind: 'failed', message: x.noFile });
    setStage({ kind: 'busy', what: dryRun ? 'check' : 'import' });
    try {
      const result = await uploadStatement(account.id, await readFile(file), { dryRun, dateOrder: dateOrder || null, applyBalance });
      if (result.errors.length > 0) setStage({ kind: 'checked', result });
      else if (dryRun) setStage({ kind: 'checked', result });
      else {
        setStage({ kind: 'done', result });
        onImported();
      }
    } catch (error) {
      const why = refusal(error);
      setStage({ kind: 'failed', message: why ? fill(x.uploadRefused, { why }) : x.uploadFailed });
    }
  };

  const busy = stage.kind === 'busy';
  return (
    <div className={styles.form} role="group" aria-label={`${x.uploadStatement}: ${account.name}`}>
      <div className={styles.fields}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${id}-file`}>
            {x.fFile}
          </label>
          <input
            id={`${id}-file`}
            className={styles.input}
            type="file"
            accept=".ofx,.qfx,.csv,.txt"
            aria-describedby={`${id}-file-hint`}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              reset();
            }}
          />
          <span id={`${id}-file-hint`} className={styles.note}>
            {x.fileHint}
          </span>
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${id}-order`}>
            {x.fDateOrder}
          </label>
          <select
            id={`${id}-order`}
            className={styles.select}
            value={dateOrder}
            onChange={(event) => {
              setDateOrder(event.target.value as '' | 'dmy' | 'mdy');
              reset();
            }}
          >
            <option value="">{x.dateAuto}</option>
            <option value="dmy">{x.dateDmy}</option>
            <option value="mdy">{x.dateMdy}</option>
          </select>
        </div>
      </div>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={applyBalance}
          onChange={(event) => {
            setApplyBalance(event.target.checked);
            reset();
          }}
        />
        <span>{x.applyBalance}</span>
      </label>
      {stage.kind === 'checked' && <Summary result={stage.result} currency={account.currency} />}
      {stage.kind === 'checked' && stage.result.errors.length === 0 && <p className={styles.note}>{x.checkNote}</p>}
      {stage.kind === 'done' && (
        <>
          <Summary result={stage.result} currency={account.currency} />
          <p role="status" className={styles.note}>
            {x.importedNote}
          </p>
        </>
      )}
      {stage.kind === 'failed' && (
        <p role="alert" className={styles.error}>
          {stage.message}
        </p>
      )}
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} disabled={busy} onClick={() => run(true)}>
          {busy && stage.what === 'check' ? x.checking : x.checkFile}
        </button>
        {stage.kind === 'checked' && stage.result.errors.length === 0 && (
          <button type="button" className={styles.primary} disabled={busy} onClick={() => run(false)}>
            {x.importFile}
          </button>
        )}
        {busy && stage.what === 'import' && <span className={styles.note}>{x.importing}</span>}
        <button type="button" className={styles.ghost} disabled={busy} onClick={() => onDone(false)}>
          {x.close}
        </button>
      </div>
    </div>
  );
};

/** What an account of a bank entered by hand can do: set its balance with a date, or load a downloaded statement. */
const ManualTools: React.FC<{ account: FinanceAccount; onChanged: () => void }> = ({ account, onChanged }) => {
  const { t } = useDashboardLang();
  const x = t.money.manual;
  const [panel, setPanel] = useState<Panel>(null);
  const done = (saved: boolean) => {
    setPanel(null);
    if (saved) onChanged();
  };
  const toggle = (next: Exclude<Panel, null>) => setPanel((current) => (current === next ? null : next));
  return (
    <div className={styles.tools}>
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} aria-expanded={panel === 'balance'} onClick={() => toggle('balance')}>
          {x.updateBalance}
        </button>
        <button type="button" className={styles.secondary} aria-expanded={panel === 'statement'} onClick={() => toggle('statement')}>
          {x.uploadStatement}
        </button>
      </div>
      {panel === 'balance' && <BalanceForm account={account} onDone={done} />}
      {panel === 'statement' && <StatementUpload account={account} onDone={done} onImported={onChanged} />}
    </div>
  );
};

export default ManualTools;
