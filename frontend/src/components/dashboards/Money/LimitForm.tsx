import React, { useState } from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { fill } from '../../../services/dashboards/calendarLabels';
import type { FinanceAccount } from '../../../services/dashboards/financeApi';
import { parseMinor } from '../../../services/dashboards/money';
import { setOverdraftLimit } from '../../../services/dashboards/recurringApi';
import styles from './Recurring.module.css';

/** The overdraft limit of an account that has none on record: one field and Save (the owner's figure wins over a bank's). */
const LimitForm: React.FC<{ account: FinanceAccount; onDone: (saved: boolean) => void }> = ({ account, onDone }) => {
  const { t } = useDashboardLang();
  const r = t.money.rec;
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const minor = parseMinor(value, account.currency, { signed: true });
    if (minor === null || minor < 0) return setProblem(r.limitInvalid);
    setBusy(true);
    setProblem(null);
    try {
      await setOverdraftLimit(account.id, minor);
      onDone(true);
    } catch {
      setProblem(r.actionFailed);
      setBusy(false);
    }
  };
  return (
    <form className={styles.limitForm} onSubmit={submit} aria-label={`${r.setLimit}: ${account.name}`}>
      <label className={styles.limitLabel}>
        <span>{fill(r.fLimit, { currency: account.currency })}</span>
        <input className={styles.limitInput} inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} />
      </label>
      <button type="submit" className={styles.small} disabled={busy}>
        {r.saveLimit}
      </button>
      <button type="button" className={styles.small} disabled={busy} onClick={() => onDone(false)}>
        {r.cancel}
      </button>
      {problem && (
        <p role="alert" className={styles.arowError}>
          {problem}
        </p>
      )}
    </form>
  );
};

export default LimitForm;
