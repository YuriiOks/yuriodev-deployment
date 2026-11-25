import React, { useId, useState } from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { useLimit } from '../../../hooks/useLimit';
import { todayIso } from './recurringLabels';
import FieldIssue from './FieldIssue';
import { issueProps, NO_ISSUES, splitRefusal, type FieldIssues } from './fieldIssues';
import { fill } from '../../../services/dashboards/calendarLabels';
import { providerName } from './providers';
import { hasEnoughContrast } from './manualCreateModel';
import { contrastRatio } from '../../../services/dashboards/providerBrand';
import type { FinanceAccount } from '../../../services/dashboards/financeApi';
import { setManualBalance, updateManualAccount, updateManualConnection, type ManualConnectionPatch, uploadStatement, type ManualAccountKind, type ManualAccountPatch, type StatementResult } from '../../../services/dashboards/manualApi';
import { formatMinor, minorToInput, parseMinor } from '../../../services/dashboards/money';
import { refusal } from '../../../services/dashboards/recurringApi';
import { dayLabel } from './labels';
import styles from './Manual.module.css';

type Panel = 'balance' | 'statement' | 'edit' | null;

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
  const { t, lang } = useDashboardLang();
  const x = t.money.manual;
  const id = useId();
  const card = account.kind === 'credit_card';
  const [amount, setAmount] = useState(minorToInput(card ? -account.ownBalance : account.ownBalance, account.currency));
  const [asOf, setAsOf] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [issues, setIssues] = useState<FieldIssues>(NO_ISSUES);
  const [busy, setBusy] = useState(false);
  // A day before the balance the account already has is asked about once before it is saved.
  const [asked, setAsked] = useState(false);
  const standsAt = account.balanceAt ? account.balanceAt.slice(0, 10) : null;
  const older = asOf !== '' && standsAt !== null && asOf < standsAt;
  // The server's names for these inputs: the amount is a balance or what is owed.
  const view: FieldIssues = { amount: issues.balance ?? issues.owed, asof: issues.as_of } as FieldIssues;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIssues(NO_ISSUES);
    // A balance may be nothing or below it; what is owed on a card may be nothing (a card paid off) but never below it.
    const minor = parseMinor(amount, account.currency, { signed: true });
    if (minor === null) return setProblem(card ? x.owedInvalid : x.balanceInvalid);
    if (card && minor < 0) return setProblem(x.owedInvalid);
    if (older && !asked) {
      setAsked(true);
      return setProblem(null);
    }
    setBusy(true);
    setProblem(null);
    try {
      await setManualBalance(account.id, card ? { owed: minor } : { balance: minor }, asOf || null);
      onDone(true);
    } catch (error) {
      const split = splitRefusal(error, t.money.refusal, ['balance', 'owed', 'as_of']);
      setIssues(split.issues);
      setProblem(split.other ?? (Object.keys(split.issues).length > 0 ? null : x.balanceFailed));
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
          <input id={`${id}-amount`} className={styles.input} {...issueProps(view, 'amount', id)} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
          <FieldIssue issues={view} field="amount" id={id} />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${id}-asof`}>
            {x.fAsOf}
          </label>
          <input id={`${id}-asof`} className={styles.input} type="date" max={todayIso()} value={asOf} {...issueProps(view, 'asof', id, `${id}-asof-hint`)} onChange={(event) => {
              setAsOf(event.target.value);
              setAsked(false);
            }} />
          <FieldIssue issues={view} field="asof" id={id} />
          <span id={`${id}-asof-hint`} className={styles.note}>
            {x.asOfHint}
            {standsAt ? ` · ${fill(x.currentAsOf, { date: dayLabel(standsAt, lang) })}` : ''}
          </span>
        </div>
      </div>
      {asked && older && standsAt && (
        <p role="alert" className={styles.error}>
          {fill(x.olderThanBalance, { date: dayLabel(standsAt, lang) })}
        </p>
      )}
      {problem && (
        <p role="alert" className={styles.error}>
          {problem}
        </p>
      )}
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={busy}>
          {asked && older ? x.saveAnyway : x.saveBalance}
        </button>
        <button type="button" className={styles.ghost} disabled={busy} onClick={() => onDone(false)}>
          {x.close}
        </button>
      </div>
    </form>
  );
};

/** What a statement upload did, or with a dry run would do: the totals to check against the bank's own statement, and every bad line. */
const Summary: React.FC<{ result: StatementResult; currency: string; current: number; applyBalance: boolean; done: boolean }> = ({ result, currency, current, applyBalance, done }) => {
  const { t, lang } = useDashboardLang();
  const x = t.money.manual;
  return (
    <div className={styles.summary}>
      {result.errors.length > 0 ? (
        <>
          <h4 className={styles.summaryTitle}>{fill(x.errorsTitle, { n: result.errors.length })}</h4>
          <ul className={styles.errorList}>
            {result.errors.map((error, index) => (
              <li key={`${error.row}-${index}`}>{fill(x.errorLine, { row: error.row, message: error.field && Object.prototype.hasOwnProperty.call(t.money.refusal.fields, error.field) ? `${t.money.refusal.fields[error.field]}: ${t.money.refusal.line}` : t.money.refusal.line })}</li>
            ))}
          </ul>
        </>
      ) : (
        <ul className={styles.summaryList}>
          {result.layout && <li>{fill(x.layoutLine, { layout: result.layout === 'generic' ? x.layoutGeneric : result.layout === 'ofx' ? x.layoutOfx : fill(x.layoutBank, { bank: providerName(result.layout) }) })}</li>}
          <li>{fill(x.parsedLine, { n: result.parsed })}</li>
          <li>{fill(x.createdLine, { n: result.created })}</li>
          <li>{fill(x.duplicatesLine, { n: result.duplicates })}</li>
          {result.firstDate && result.lastDate && <li>{fill(x.rangeLine, { from: dayLabel(result.firstDate, lang), to: dayLabel(result.lastDate, lang) })}</li>}
          <li>{fill(x.moneyInLine, { amount: formatMinor(result.moneyIn, currency, lang) })}</li>
          <li>{fill(x.moneyOutLine, { amount: formatMinor(result.moneyOut, currency, lang) })}</li>
          {result.balance !== null && result.balanceDate && (
            <li>
              {fill(x.balanceInFile, { amount: formatMinor(result.balance, currency, lang), date: dayLabel(result.balanceDate, lang) })}
              {' · '}
              {applyBalance && result.balanceWouldApply ? fill(x.balanceReplaces, { old: formatMinor(current, currency, lang) }) : x.balanceNotUsed}
            </li>
          )}
          {result.balanceApplied && <li>{x.balanceApplied}</li>}
          {done && applyBalance && result.balance !== null && !result.balanceApplied && <li>{x.balanceNotApplied}</li>}
          {result.created === 0 && result.duplicates > 0 && <li>{x.nothingNew}</li>}
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
      const result = await uploadStatement(account.id, await readFile(file), { dryRun, dateOrder: dateOrder || null, applyBalance: applyBalance && account.kind !== 'credit_card' });
      if (result.errors.length > 0) setStage({ kind: 'checked', result });
      else if (dryRun) setStage({ kind: 'checked', result });
      else {
        setStage({ kind: 'done', result });
        onImported();
      }
    } catch (error) {
      const why = refusal(error, t.money.refusal);
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
      {account.kind === 'credit_card' ? (
        <p className={styles.note}>{x.cardBalanceNote}</p>
      ) : (
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
      )}
      {stage.kind === 'checked' && <Summary result={stage.result} currency={account.currency} current={account.ownBalance} applyBalance={applyBalance} done={false} />}
      {stage.kind === 'checked' && stage.result.errors.length === 0 && <p className={styles.note}>{x.checkNote}</p>}
      {stage.kind === 'done' && (
        <>
          <Summary result={stage.result} currency={account.currency} current={account.ownBalance} applyBalance={applyBalance} done={stage.kind === 'done'} />
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

const KINDS: readonly ManualAccountKind[] = ['current', 'savings', 'business', 'credit_card'];

/** Changes the name and the type of an account entered by hand, and a card's limit ("this is a credit card", with its limit). Sends only what changed. */
const EditAccountForm: React.FC<{ account: FinanceAccount; onDone: (saved: boolean) => void }> = ({ account, onDone }) => {
  const { t } = useDashboardLang();
  const nameMax = useLimit('account', 'name', 120);
  const x = t.money.manual;
  const id = useId();
  const startKind: ManualAccountKind = KINDS.includes(account.kind as ManualAccountKind) ? (account.kind as ManualAccountKind) : 'current';
  const [name, setName] = useState(account.name);
  const [kind, setKind] = useState<ManualAccountKind>(startKind);
  const [limit, setLimit] = useState(account.creditLimit > 0 ? minorToInput(account.creditLimit, account.currency) : '');
  const [last4, setLast4] = useState(account.maskLast4 ?? '');
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [issues, setIssues] = useState<FieldIssues>(NO_ISSUES);
  const [busy, setBusy] = useState(false);
  const view: FieldIssues = { name: issues.name, kind: issues.kind, limit: issues.credit_limit, last4: issues.mask_last4 } as FieldIssues;
  const kindLabel: Record<ManualAccountKind, string> = { current: x.kindCurrent, savings: x.kindSavings, business: x.kindBusiness, credit_card: x.kindCard };

  const archive = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await updateManualAccount(account.id, { archived: true });
      onDone(true);
    } catch {
      setProblem(x.createFailed);
      setBusy(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIssues(NO_ISSUES);
    if (!name.trim()) return setProblem(x.nameRequired);
    const body: { name?: string; kind?: ManualAccountKind; credit_limit?: number; mask_last4?: string } = {};
    if (name.trim() !== account.name) body.name = name.trim();
    if (last4.trim() !== (account.maskLast4 ?? '')) {
      if (!/^[0-9]{4}$/.test(last4.trim())) return setProblem(x.last4Invalid);
      body.mask_last4 = last4.trim();
    }
    if (kind !== startKind) body.kind = kind;
    if (kind === 'credit_card') {
      const minor = parseMinor(limit, account.currency);
      if (minor === null) return setProblem(x.limitInvalid);
      if (kind !== startKind || minor !== account.creditLimit) body.credit_limit = minor;
    }
    if (Object.keys(body).length === 0) return onDone(false);
    setBusy(true);
    setProblem(null);
    try {
      await updateManualAccount(account.id, body as ManualAccountPatch);
      onDone(true);
    } catch (error) {
      const split = splitRefusal(error, t.money.refusal, ['name', 'kind', 'credit_limit', 'mask_last4']);
      setIssues(split.issues);
      setProblem(split.other ? fill(x.createRefused, { why: split.other }) : Object.keys(split.issues).length > 0 ? null : x.createFailed);
      setBusy(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={submit} aria-label={`${x.editAccount}: ${account.name}`}>
      <div className={styles.fields}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${id}-name`}>
            {x.fAccountName}
          </label>
          <input id={`${id}-name`} className={styles.input} {...issueProps(view, 'name', id)} value={name} maxLength={nameMax} onChange={(event) => setName(event.target.value)} />
          <FieldIssue issues={view} field="name" id={id} />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${id}-kind`}>
            {x.fKind}
          </label>
          <select id={`${id}-kind`} className={styles.select} {...issueProps(view, 'kind', id)} value={kind} onChange={(event) => setKind(event.target.value as ManualAccountKind)}>
            {KINDS.map((choice) => (
              <option key={choice} value={choice}>
                {kindLabel[choice]}
              </option>
            ))}
          </select>
          <FieldIssue issues={view} field="kind" id={id} />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${id}-last4`}>
            {x.fLast4}
          </label>
          <input id={`${id}-last4`} className={styles.input} {...issueProps(view, 'last4', id)} inputMode="numeric" value={last4} maxLength={4} onChange={(event) => setLast4(event.target.value)} />
          <FieldIssue issues={view} field="last4" id={id} />
        </div>
        {kind === 'credit_card' && (
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor={`${id}-limit`}>
              {x.fCreditLimit}
            </label>
            <input id={`${id}-limit`} className={styles.input} {...issueProps(view, 'limit', id)} inputMode="decimal" value={limit} onChange={(event) => setLimit(event.target.value)} />
            <FieldIssue issues={view} field="limit" id={id} />
          </div>
        )}
      </div>
      {problem && (
        <p role="alert" className={styles.error}>
          {problem}
        </p>
      )}
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={busy}>
          {x.saveAccount}
        </button>
        {confirmArchive ? (
          <button type="button" className={styles.secondary} disabled={busy} onClick={() => void archive()}>
            {x.archiveConfirm}
          </button>
        ) : (
          <button type="button" className={styles.secondary} disabled={busy} onClick={() => setConfirmArchive(true)}>
            {x.archiveAccount}
          </button>
        )}
        <button type="button" className={styles.ghost} disabled={busy} onClick={() => onDone(false)}>
          {x.close}
        </button>
      </div>
    </form>
  );
};

/** Changes a bank entered by hand: its name and its card colours (held to the contrast the server asks for). Sends only what changed. */
export const EditBankForm: React.FC<{ connectionId: string; name: string; background: string | null; foreground: string | null; onDone: (saved: boolean) => void }> = ({ connectionId, name: startName, background: startBg, foreground: startFg, onDone }) => {
  const { t } = useDashboardLang();
  const x = t.money.manual;
  const id = useId();
  const nameMax = useLimit('connection', 'display_name', 60);
  const [name, setName] = useState(startName);
  const [bg, setBg] = useState(startBg ?? '#1f4e79');
  const [fg, setFg] = useState(startFg ?? '#ffffff');
  const [problem, setProblem] = useState<string | null>(null);
  const [issues, setIssues] = useState<FieldIssues>(NO_ISSUES);
  const [busy, setBusy] = useState(false);
  const view: FieldIssues = { name: issues.display_name } as FieldIssues;
  const ok = hasEnoughContrast(bg, fg);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIssues(NO_ISSUES);
    if (!name.trim()) return setProblem(x.nameRequired);
    if (!ok) return setProblem(x.contrastLow);
    const patch: ManualConnectionPatch = {
      ...(name.trim() !== startName ? { displayName: name.trim() } : {}),
      ...(bg !== (startBg ?? '#1f4e79') || fg !== (startFg ?? '#ffffff') || startBg === null ? { brandBg: bg, brandFg: fg } : {}),
    };
    if (Object.keys(patch).length === 0) return onDone(false);
    setBusy(true);
    setProblem(null);
    try {
      await updateManualConnection(connectionId, patch);
      onDone(true);
    } catch (error) {
      const split = splitRefusal(error, t.money.refusal, ['display_name']);
      setIssues(split.issues);
      setProblem(split.other ? fill(x.createRefused, { why: split.other }) : Object.keys(split.issues).length > 0 ? null : x.createFailed);
      setBusy(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={submit} aria-label={x.editBank}>
      <div className={styles.fields}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${id}-name`}>
            {x.fBankName}
          </label>
          <input id={`${id}-name`} className={styles.input} {...issueProps(view, 'name', id)} value={name} maxLength={nameMax} onChange={(event) => setName(event.target.value)} />
          <FieldIssue issues={view} field="name" id={id} />
        </div>
      </div>
      <div className={styles.colours}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${id}-bg`}>
            {x.fBgColor}
          </label>
          <input id={`${id}-bg`} className={styles.colorInput} type="color" value={bg} onChange={(event) => setBg(event.target.value)} />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${id}-fg`}>
            {x.fFgColor}
          </label>
          <input id={`${id}-fg`} className={styles.colorInput} type="color" value={fg} onChange={(event) => setFg(event.target.value)} />
        </div>
        <div className={styles.previewBox}>
          <span className={styles.fieldLabel}>{x.previewLabel}</span>
          <div className={styles.swatch} style={{ background: bg, color: fg }} role="img" aria-label={`${x.previewLabel}: ${name.trim() || x.fBankName}`}>
            {name.trim() || x.fBankName}
          </div>
          <span className={styles.note}>{fill(x.contrastIs, { ratio: contrastRatio(bg, fg).toFixed(1) })}</span>
        </div>
      </div>
      {problem && (
        <p role="alert" className={styles.error}>
          {problem}
        </p>
      )}
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={busy}>
          {x.saveBank}
        </button>
        <button type="button" className={styles.ghost} disabled={busy} onClick={() => onDone(false)}>
          {x.close}
        </button>
      </div>
    </form>
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
        <button type="button" className={styles.ghost} aria-expanded={panel === 'edit'} onClick={() => toggle('edit')}>
          {x.editAccount}
        </button>
      </div>
      {panel === 'balance' && <BalanceForm account={account} onDone={done} />}
      {panel === 'statement' && <StatementUpload account={account} onDone={done} onImported={onChanged} />}
      {panel === 'edit' && <EditAccountForm account={account} onDone={done} />}
    </div>
  );
};

export default ManualTools;
