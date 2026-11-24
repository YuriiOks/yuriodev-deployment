import React, { useId, useState } from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { fill } from '../../../services/dashboards/calendarLabels';
import { createManualAccount, createManualConnection, type ManualAccountKind } from '../../../services/dashboards/manualApi';
import { refusal } from '../../../services/dashboards/recurringApi';
import { buildAccountBody, hasEnoughContrast, providerIdFor, type AccountFields, type AccountProblem } from './manualCreateModel';
import styles from './Manual.module.css';

const KINDS: readonly ManualAccountKind[] = ['current', 'savings', 'business', 'credit_card'];
const CUSTOM = '__custom';

/** The fields of one new account: its name and type, currency, balance (a card: its limit and what is owed), last four digits and the day it is as of. */
const AccountFieldset: React.FC<{ fields: AccountFields; onChange: (next: AccountFields) => void; idBase: string }> = ({ fields, onChange, idBase }) => {
  const { t } = useDashboardLang();
  const x = t.money.manual;
  const set = <K extends keyof AccountFields>(key: K, value: AccountFields[K]) => onChange({ ...fields, [key]: value });
  const card = fields.kind === 'credit_card';
  const kindLabel: Record<ManualAccountKind, string> = { current: x.kindCurrent, savings: x.kindSavings, business: x.kindBusiness, credit_card: x.kindCard };
  return (
    <div className={styles.fields}>
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor={`${idBase}-name`}>
          {x.fAccountName}
        </label>
        <input id={`${idBase}-name`} className={styles.input} value={fields.name} maxLength={120} onChange={(event) => set('name', event.target.value)} />
      </div>
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor={`${idBase}-kind`}>
          {x.fKind}
        </label>
        <select id={`${idBase}-kind`} className={styles.select} value={fields.kind} onChange={(event) => set('kind', event.target.value as ManualAccountKind)}>
          {KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kindLabel[kind]}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor={`${idBase}-currency`}>
          {x.fCurrency}
        </label>
        <input id={`${idBase}-currency`} className={styles.input} value={fields.currency} maxLength={3} onChange={(event) => set('currency', event.target.value.toUpperCase())} />
      </div>
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor={`${idBase}-amount`}>
          {card ? x.fCreditLimit : x.fBalance}
        </label>
        <input id={`${idBase}-amount`} className={styles.input} inputMode="decimal" value={fields.amount} onChange={(event) => set('amount', event.target.value)} />
      </div>
      {card && (
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${idBase}-owed`}>
            {x.fOwedNow}
          </label>
          <input id={`${idBase}-owed`} className={styles.input} inputMode="decimal" value={fields.owed} onChange={(event) => set('owed', event.target.value)} />
        </div>
      )}
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor={`${idBase}-last4`}>
          {x.fLast4}
        </label>
        <input id={`${idBase}-last4`} className={styles.input} inputMode="numeric" value={fields.last4} maxLength={4} onChange={(event) => set('last4', event.target.value)} />
      </div>
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor={`${idBase}-asof`}>
          {x.fAsOfOptional}
        </label>
        <input id={`${idBase}-asof`} className={styles.input} type="date" value={fields.asOf} onChange={(event) => set('asOf', event.target.value)} />
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
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const built = buildAccountBody(fields, connectionId);
    if ('problem' in built) return setProblem(problemText(built.problem));
    setBusy(true);
    setProblem(null);
    try {
      await createManualAccount(built.body);
      onDone(true);
    } catch (error) {
      const why = refusal(error);
      setProblem(why ? fill(x.createRefused, { why }) : x.createFailed);
      setBusy(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={submit} aria-label={x.addAccount}>
      <AccountFieldset fields={fields} onChange={setFields} idBase={id} />
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
}

/**
 * A new bank entered by hand with its first account: a brand from the server's list, or another bank by name and colours (the card colour
 * and its text held to the contrast the server asks for). The bank is made first and then its account; if only the account is refused the
 * bank stays made and a second try only adds the account.
 */
export const AddBankForm: React.FC<AddBankFormProps> = ({ candidates, taken, onDone }) => {
  const { t } = useDashboardLang();
  const x = t.money.manual;
  const id = useId();
  const problemText = useProblemText();
  const [choice, setChoice] = useState(candidates[0]?.id ?? CUSTOM);
  const [name, setName] = useState('');
  const [background, setBackground] = useState('#1f4e79');
  const [foreground, setForeground] = useState('#ffffff');
  const [fields, setFields] = useState(() => emptyFields(x.defaultAccountName));
  const [made, setMade] = useState<{ id: string; provider: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const custom = choice === CUSTOM;
  const contrastOk = hasEnoughContrast(background, foreground);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
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
      } catch (error) {
        const why = refusal(error);
        setProblem(why ? fill(x.createRefused, { why }) : x.createFailed);
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
      const why = refusal(error);
      setProblem(why ? fill(x.accountAfterBank, { why }) : x.createFailed);
      setBusy(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={submit} aria-label={x.addBank}>
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
          <>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor={`${id}-name`}>
                {x.fBankName}
              </label>
              <input id={`${id}-name`} className={styles.input} value={name} maxLength={60} disabled={made !== null} onChange={(event) => setName(event.target.value)} />
            </div>
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
            <div className={styles.swatch} style={{ background, color: foreground }} aria-hidden="true">
              {name.trim() || x.fBankName}
            </div>
          </>
        )}
      </div>
      {custom && !contrastOk && (
        <p role="alert" className={styles.error}>
          {x.contrastLow}
        </p>
      )}
      <AccountFieldset fields={fields} onChange={setFields} idBase={`${id}-account`} />
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
