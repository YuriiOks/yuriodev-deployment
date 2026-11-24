import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { fill } from '../../../services/dashboards/calendarLabels';
import type { FinanceAccount, FinanceAccounts, FinanceConnection } from '../../../services/dashboards/financeApi';
import { formatMinor } from '../../../services/dashboards/money';
import { cx } from '../../../utils/cx';
import DashIcon from '../DashIcon/DashIcon';
import { providerName, reconnectPath } from './providers';
import styles from './Money.module.css';

/** A date alone, in the page's language. */
export function dayLabel(iso: string | null, lang: string): string {
  if (!iso || Number.isNaN(Date.parse(iso))) return '';
  return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
}

/** When something was last read, as a short date and time in the page's language. */
export function whenLabel(iso: string | null, lang: string): string {
  if (!iso || Number.isNaN(Date.parse(iso))) return '';
  return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

const AccountRow: React.FC<{ account: FinanceAccount }> = ({ account }) => {
  const { t, lang } = useDashboardLang();
  const m = t.money;
  const notes = [
    account.maskLast4 ? `•••• ${account.maskLast4}` : '',
    account.creditLimit > 0 ? fill(m.creditLimit, { amount: formatMinor(account.creditLimit, account.currency, lang) }) : '',
    account.archived ? m.archived : '',
    account.historyFrom && account.type !== 'pot' ? fill(m.historyFrom, { date: dayLabel(account.historyFrom, lang) }) : '',
  ].filter(Boolean);
  return (
    <li className={styles.account} data-pot={account.type === 'pot' ? 'true' : undefined} data-archived={account.archived ? 'true' : undefined}>
      <span className={styles.name} title={account.name}>
        {account.name}
      </span>
      <span className={styles.amount}>{formatMinor(account.ownBalance, account.currency, lang)}</span>
      {notes.length > 0 && <span className={styles.note}>{notes.join(' · ')}</span>}
    </li>
  );
};

const ConnectionLine: React.FC<{ provider: string; connection: FinanceConnection | undefined }> = ({ provider, connection }) => {
  const { t, lang } = useDashboardLang();
  const m = t.money;
  const status = connection?.status;
  const label = status === 'ok' ? m.linkOk : status === 'needs_reconsent' ? m.linkNeedsReconsent : status === 'paused' ? m.linkPaused : m.linkNone;
  const path = status === 'needs_reconsent' ? reconnectPath(provider) : null;
  const updated = connection?.lastOkAt ? fill(m.lastOk, { when: whenLabel(connection.lastOkAt, lang) }) : '';
  return (
    <>
      <span className={styles.link} data-status={status ?? 'none'}>
        {status === 'needs_reconsent' && <DashIcon name="alert" size={14} />}
        {label}
        {updated && <> · {updated}</>}
      </span>
      {path && (
        <a className={styles.reconnect} href={path}>
          {m.reconnect}
        </a>
      )}
      {status === 'needs_reconsent' && <p className={styles.hint}>{m.reconnectHint}</p>}
    </>
  );
};

export interface MoneyAccountsProps {
  data: FinanceAccounts;
}

/**
 * The accounts grouped by provider (in the order the API lists them), each group with the state of its bank link, its
 * current accounts and, under them, its pots; every balance in its own currency, no total across currencies. An archived
 * account is listed last in its group and says so.
 */
const MoneyAccounts: React.FC<MoneyAccountsProps> = ({ data }) => {
  const { t } = useDashboardLang();
  const m = t.money;
  const providers = [...new Set(data.accounts.map((account) => account.provider))];
  for (const connection of data.connections) if (!providers.includes(connection.provider)) providers.push(connection.provider);

  if (providers.length === 0) return <p className={styles.empty}>{m.noAccounts}</p>;
  return (
    <>
      {providers.map((provider) => {
        const own = data.accounts.filter((account) => account.provider === provider);
        const current = own.filter((account) => account.type !== 'pot' && !account.archived);
        const pots = own.filter((account) => account.type === 'pot' && !account.archived);
        const archived = own.filter((account) => account.archived);
        const id = `money-${provider}`;
        return (
          <section key={provider} aria-labelledby={`${id}-name`} className={styles.group}>
            <div className={styles.provider}>
              <h3 id={`${id}-name`} className={styles.providerName}>
                {providerName(provider)}
              </h3>
              <ConnectionLine provider={provider} connection={data.connections.find((connection) => connection.provider === provider)} />
            </div>
            {current.length > 0 && (
              <ul className={styles.accounts}>
                {current.map((account) => (
                  <AccountRow key={account.id} account={account} />
                ))}
              </ul>
            )}
            {pots.length > 0 && (
              <>
                <h4 className={cx(styles.sub)}>{m.pots}</h4>
                <ul className={styles.accounts}>
                  {pots.map((account) => (
                    <AccountRow key={account.id} account={account} />
                  ))}
                </ul>
              </>
            )}
            {archived.length > 0 && (
              <ul className={styles.accounts}>
                {archived.map((account) => (
                  <AccountRow key={account.id} account={account} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </>
  );
};

export default MoneyAccounts;
