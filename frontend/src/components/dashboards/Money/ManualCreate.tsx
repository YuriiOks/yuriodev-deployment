import React, { useId, useState } from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { useLimit } from '../../../hooks/useLimit';
import { contrastRatio } from '../../../services/dashboards/providerBrand';
import { useManualCurrencies } from '../../../hooks/useManualCurrencies';
import { todayIso } from './recurringLabels';
import FieldIssue from './FieldIssue';
import { issueProps, NO_ISSUES, splitRefusal, type FieldIssues } from './fieldIssues';
import { fill } from '../../../services/dashboards/calendarLabels';
import { createManualAccount, createManualConnection, type ManualAccountKind } from '../../../services/dashboards/manualApi';
import { buildAccountBody, hasEnoughContrast, providerIdFor, type AccountFields, type AccountProblem } from './manualCreateModel';
import styles from './Manual.module.css';

const KINDS: readonly ManualAccountKind[] = ['current', 'savings', 'business', 'credit_card'];
const CUSTOM = '__custom';

/** The fields of one new account: its name and type, currency, balance (a card: its limit and what is owed), last four digits and the day it is as of. */
/** The server's field names of an account and of a bank entered by hand, which these forms show an input for (a refusal about one is told under it). */
const ACCOUNT_FIELDS = ['name', 'kind', 'currency', 'balance', 'credit_limit', 'owed', 'mask_last4', 'as_of'] as const;
const BANK_FIELDS = ['display_name'] as const;

const AccountFieldset: React.FC<{ fields: AccountFields; onChange: (next: AccountFields) => void; idBase: string; issues?: FieldIssues }> = ({ fields, onChange, idBase, issues = NO_ISSUES }) => {
  const { t } = useDashboardLang();
  const nameMax = useLimit('account', 'name', 120);
  const x = t.money.manual;
  const currencies = useManualCurrencies();
  const set = <K extends keyof AccountFields>(key: K, value: AccountFields[K]) => onChange({ ...fields, [key]: value });
  const card = fields.kind === 'credit_card';
  // The account's name follows its kind until the owner types a name of their own.
  const setKind = (kind: ManualAccountKind) => {
    const followed = fields.name.trim() === '' || Object.values(x.defaultNameByKind).includes(fields.name.trim());
    onChange({ ...fields, kind, ...(followed ? { name: x.defaultNameByKind[kind] } : {}) });
  };
  // The server's names for the fields, as this form's inputs are named (a card's limit and a balance share the amount input).
  const view: FieldIssues = { name: issues.name, kind: issues.kind, currency: issues.currency, amount: issues.balance ?? issues.credit_limit, owed: issues.owed, last4: issues.mask_last4, asof: issues.as_of } as FieldIssues;
  const kindLabel: Record<ManualAccountKind, string> = { current: x.kindCurrent, savings: x.kindSavings, business: x.kindBusiness, credit_card: x.kindCard };
  return (
    <div className={styles.fields}>
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor={`${idBase}-name`}>
          {x.fAccountName}
        </label>
        <input id={`${idBase}-name`} className={styles.input} {...issueProps(view, 'name', idBase)} value={fields.name} maxLength={nameMax} onChange={(event) => set('name', event.target.value)} />
        <FieldIssue issues={view} field="name" id={idBase} />
      </div>
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor={`${idBase}-kind`}>
          {x.fKind}
        </label>
        <select id={`${idBase}-kind`} className={styles.select} {...issueProps(view, 'kind', idBase)} value={fields.kind} onChange={(event) => setKind(event.target.value as ManualAccountKind)}>
          {KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kindLabel[kind]}
            </option>
          ))}
        </select>
        <FieldIssue issues={view} field="kind" id={idBase} />
      </div>
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor={`${idBase}-currency`}>
          {x.fCurrency}
        </label>
        {currencies.length > 0 ? (
          <select id={`${idBase}-currency`} className={styles.select} {...issueProps(view, 'currency', idBase)} value={fields.currency} onChange={(event) => set('currency', event.target.value)}>
            {(currencies.includes(fields.currency) ? currencies : [fields.currency, ...currencies]).map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        ) : (
          <input id={`${idBase}-currency`} className={styles.input} {...issueProps(view, 'currency', idBase)} value={fields.currency} maxLength={3} onChange={(event) => set('currency', event.target.value.toUpperCase())} />
        )}
        <FieldIssue issues={view} field="currency" id={idBase} />
      </div>
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor={`${idBase}-amount`}>
          {card ? x.fCreditLimit : x.fBalance}
        </label>
        <input id={`${idBase}-amount`} className={styles.input} {...issueProps(view, 'amount', idBase)} inputMode="decimal" value={fields.amount} onChange={(event) => set('amount', event.target.value)} />
        <FieldIssue issues={view} field="amount" id={idBase} />
      </div>
      {card && (
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${idBase}-owed`}>
            {x.fOwedNow}
          </label>
          <input id={`${idBase}-owed`} className={styles.input} {...issueProps(view, 'owed', idBase)} inputMode="decimal" value={fields.owed} onChange={(event) => set('owed', event.target.value)} />
        <FieldIssue issues={view} field="owed" id={idBase} />
        </div>
      )}
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor={`${idBase}-last4`}>
          {x.fLast4}
        </label>
        <input id={`${idBase}-last4`} className={styles.input} {...issueProps(view, 'last4', idBase)} inputMode="numeric" value={fields.last4} maxLength={4} onChange={(event) => set('last4', event.target.value)} />
        <FieldIssue issues={view} field="last4" id={idBase} />
      </div>
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor={`${idBase}-asof`}>
          {x.fAsOfOptional}
        </label>
        <input id={`${idBase}-asof`} className={styles.input} {...issueProps(view, 'asof', idBase)} type="date" max={todayIso()} value={fields.asOf} onChange={(event) => set('asOf', event.target.value)} />
        <FieldIssue issues={view} field="asof" id={idBase} />
      </div>
    </div>
  );
};

const emptyFields = (name: string): AccountFields => ({ name, kind: 'current', currency: 'GBP', amount: '', owed: '', last4: '', asOf: '' });

/** The words for the field a new account was refused on. */
function useProblemText() {
  const { t } = useDashboardLang();
  const x = t.money.manual;
  return (problem: AccountProblem): string =>
    ({ name: x.nameRequired, currency: x.currencyInvalid, amount: x.balanceInvalid, limit: x.limitInvalid, owed: x.owedInvalid, last4: x.last4Invalid })[problem];
}

/** A new account on a bank entered by hand. */
export const AddAccountForm: React.FC<{ connectionId: string; onDone: (saved: boolean) => void }> = ({ connectionId, onDone }) => {
  const { t } = useDashboardLang();
  const x = t.money.manual;
  const id = useId();
  const problemText = useProblemText();
  const [fields, setFields] = useState(() => emptyFields(x.defaultAccountName));
  const [problem, setProblem] = useState<string | null>(null);
  const [issues, setIssues] = useState<FieldIssues>(NO_ISSUES);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIssues(NO_ISSUES);
    const built = buildAccountBody(fields, connectionId);
    if ('problem' in built) return setProblem(problemText(built.problem));
    setBusy(true);
    setProblem(null);
    try {
      await createManualAccount(built.body);
      onDone(true);
    } catch (error) {
      const split = splitRefusal(error, t.money.refusal, ACCOUNT_FIELDS);
      setIssues(split.issues);
      setProblem(split.other ? fill(x.createRefused, { why: split.other }) : Object.keys(split.issues).length > 0 ? null : x.createFailed);
      setBusy(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={submit} aria-label={x.addAccount}>
      <AccountFieldset fields={fields} onChange={setFields} idBase={id} issues={issues} />
      {problem && (
        <p role="alert" className={styles.error}>
          {problem}
        </p>
      )}
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={busy}>
          {busy ? x.creating : x.createAccount}
        </button>
        <button type="button" className={styles.ghost} disabled={busy} onClick={() => onDone(false)}>
          {x.close}
        </button>
      </div>
    </form>
  );
};

export interface AddBankFormProps {
  /** Built-in brands that can be entered by hand and have no connection yet (the server's list). */
  candidates: readonly { readonly id: string; readonly name: string }[];
  /** Every provider id in use (a custom bank's id must not repeat one). */
  taken: ReadonlySet<string>;
  /** Done: the new bank's provider id, or null when closed without adding. */
  onDone: (provider: string | null) => void;
  /** The bank exists as soon as its connection is made (before its first account): the wallet reloads and opens it however the form is closed. */
  onBankMade?: (provider: string) => void;
}

/**
 * A new bank entered by hand with its first account: a brand from the server's list, or another bank by name and colours (the card colour
 * and its text held to the contrast the server asks for). The bank is made first and then its account; if only the account is refused the
 * bank stays made and a second try only adds the account.
 */
export const AddBankForm: React.FC<AddBankFormProps> = ({ candidates, taken, onDone, onBankMade }) => {
  const { t } = useDashboardLang();
  const x = t.money.manual;
  const bankNameMax = useLimit('connection', 'display_name', 60);
  const id = useId();
  const problemText = useProblemText();
  const [choice, setChoice] = useState(candidates[0]?.id ?? CUSTOM);
  const [name, setName] = useState('');
  const [background, setBackground] = useState('#1f4e79');
  const [foreground, setForeground] = useState('#ffffff');
  const [fields, setFields] = useState(() => emptyFields(x.defaultAccountName));
  const [made, setMade] = useState<{ id: string; provider: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [issues, setIssues] = useState<FieldIssues>(NO_ISSUES);
  const [busy, setBusy] = useState(false);
  // A refusal about the bank's own name (the server calls it display_name) is told under the bank name input.
  const bankIssues: FieldIssues = { name: issues.display_name } as FieldIssues;
  const custom = choice === CUSTOM;
  const contrastOk = hasEnoughContrast(background, foreground);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIssues(NO_ISSUES);
    const check = buildAccountBody(fields, 'pending');
    if ('problem' in check) return setProblem(problemText(check.problem));
    let provider = made?.provider ?? choice;
    if (!made && custom) {
      const derived = name.trim() ? providerIdFor(name, taken) : null;
      if (!derived) return setProblem(x.nameRequired);
      if (!contrastOk) return setProblem(x.contrastLow);
      provider = derived;
    }
    setBusy(true);
    setProblem(null);
    let connectionId = made?.id ?? null;
    if (!connectionId) {
      try {
        connectionId = await createManualConnection(custom ? { provider, displayName: name.trim(), brandBg: background, brandFg: foreground } : { provider });
        setMade({ id: connectionId, provider });
        onBankMade?.(provider);
      } catch (error) {
        const split = splitRefusal(error, t.money.refusal, BANK_FIELDS);
        setIssues(split.issues);
        setProblem(split.other ? fill(x.createRefused, { why: split.other }) : Object.keys(split.issues).length > 0 ? null : x.createFailed);
        setBusy(false);
        return;
      }
    }
    const built = buildAccountBody(fields, connectionId);
    if ('problem' in built) {
      setProblem(problemText(built.problem));
      setBusy(false);
      return;
    }
    try {
      await createManualAccount(built.body);
      onDone(provider);
    } catch (error) {
      const split = splitRefusal(error, t.money.refusal, ACCOUNT_FIELDS);
      setIssues(split.issues);
      setProblem(split.other ? fill(x.accountAfterBank, { why: split.other }) : Object.keys(split.issues).length > 0 ? null : x.createFailed);
      setBusy(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={submit} aria-label={x.addBank}>
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>{x.sectionBank}</legend>
        <div className={styles.fields}>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor={`${id}-bank`}>
              {x.fBank}
            </label>
            <select id={`${id}-bank`} className={styles.select} value={choice} disabled={made !== null} onChange={(event) => setChoice(event.target.value)}>
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
              <option value={CUSTOM}>{x.otherBank}</option>
            </select>
          </div>
          {custom && (
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor={`${id}-name`}>
                {x.fBankName}
              </label>
              <input id={`${id}-name`} className={styles.input} {...issueProps(bankIssues, 'name', id)} value={name} maxLength={bankNameMax} disabled={made !== null} onChange={(event) => setName(event.target.value)} />
              <FieldIssue issues={bankIssues} field="name" id={id} />
            </div>
          )}
        </div>
        {custom && (
          <>
            <div className={styles.colours}>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor={`${id}-bg`}>
                  {x.fBgColor}
                </label>
                <input id={`${id}-bg`} className={styles.colorInput} type="color" value={background} disabled={made !== null} onChange={(event) => setBackground(event.target.value)} />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor={`${id}-fg`}>
                  {x.fFgColor}
                </label>
                <input id={`${id}-fg`} className={styles.colorInput} type="color" value={foreground} disabled={made !== null} onChange={(event) => setForeground(event.target.value)} />
              </div>
              <div className={styles.previewBox}>
                <span className={styles.fieldLabel}>{x.previewLabel}</span>
                <div className={styles.swatch} style={{ background, color: foreground }} role="img" aria-label={`${x.previewLabel}: ${name.trim() || x.fBankName}`}>
                  {name.trim() || x.fBankName}
                </div>
                <span className={styles.note}>{fill(x.contrastIs, { ratio: contrastRatio(background, foreground).toFixed(1) })}</span>
              </div>
            </div>
            {!contrastOk && (
              <p role="alert" className={styles.error}>
                {x.contrastLow}
              </p>
            )}
          </>
        )}
      </fieldset>
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>{x.sectionAccount}</legend>
        <AccountFieldset fields={fields} onChange={setFields} idBase={`${id}-account`} issues={issues} />
      </fieldset>
      {problem && (
        <p role="alert" className={styles.error}>
          {problem}
        </p>
      )}
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={busy}>
          {busy ? x.creating : x.createBank}
        </button>
        <button type="button" className={styles.ghost} disabled={busy} onClick={() => onDone(made ? made.provider : null)}>
          {x.close}
        </button>
      </div>
    </form>
  );
};
