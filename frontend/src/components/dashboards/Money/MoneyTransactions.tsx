import React, { useEffect, useId, useState } from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { fill } from '../../../services/dashboards/calendarLabels';
import type { FinanceAccount, FinanceTransaction } from '../../../services/dashboards/financeApi';
import { formatMinor } from '../../../services/dashboards/money';
import { useTransactions } from '../../../hooks/useFinance';
import InlineError from '../InlineError/InlineError';
import LoadingBlock from '../LoadingBlock/LoadingBlock';
import ProjectIcon from '../ProjectIcon/ProjectIcon';
import { whenLabel } from './MoneyAccounts';
import styles from './Money.module.css';

const SEARCH_DELAY_MS = 300;

/** One transaction: an arrow and a sign for money in or out (and a word for a screen reader), what it was, when and where, and its marks. */
const TransactionRow: React.FC<{ item: FinanceTransaction; accountName: string }> = ({ item, accountName }) => {
  const { t, lang } = useDashboardLang();
  const m = t.money;
  const incoming = item.amount > 0;
  const what = item.counterparty ?? (item.description || '—');
  const detail = item.counterparty && item.description && item.description !== item.counterparty ? item.description : '';
  return (
    <li
      className={styles.tx}
      data-pending={item.pending ? 'true' : undefined}
      data-declined={item.declined ? 'true' : undefined}
      data-internal={item.internalTransfer ? 'true' : undefined}
      data-direction={item.amount === 0 ? undefined : incoming ? 'in' : 'out'}
    >
      <span aria-hidden="true" className={styles.arrow}>
        {item.amount !== 0 && <ProjectIcon name={incoming ? 'arrow-down-left' : 'arrow-up-right'} size={16} />}
      </span>
      <span className={styles.main}>
        <span className={styles.what} title={detail ? `${what}: ${detail}` : what}>
          {what}
        </span>
        <span className={styles.meta}>
          <span>{whenLabel(item.bookedAt, lang)}</span>
          <span>{accountName}</span>
          {item.pending && <span className={styles.tag}>{m.pending}</span>}
          {item.declined && <span className={styles.tag}>{m.declined}</span>}
          {item.internalTransfer && <span className={styles.tag}>{m.internal}</span>}
          {item.originalAmount !== null && item.originalCurrency && item.originalCurrency !== item.currency && (
            <span>{fill(m.originalAmount, { amount: formatMinor(Math.abs(item.originalAmount), item.originalCurrency, lang) })}</span>
          )}
        </span>
      </span>
      <span className={styles.amount}>
        {item.amount !== 0 && <span className="sr-only">{incoming ? m.moneyIn : m.moneyOut}: </span>}
        {formatMinor(item.amount, item.currency, lang, { signed: true })}
      </span>
    </li>
  );
};

export interface MoneyTransactionsProps {
  accounts: readonly FinanceAccount[];
  enabled: boolean;
}

/**
 * The transactions, newest first: an account filter, a text search (applied after a short pause in typing) and "Load more" by the
 * server's cursor. Changing the filter or the search starts again from the newest.
 */
const MoneyTransactions: React.FC<MoneyTransactionsProps> = ({ accounts, enabled }) => {
  const { t } = useDashboardLang();
  const m = t.money;
  const id = useId();
  const [account, setAccount] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(typed.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [typed]);
  const list = useTransactions(account, query, enabled);
  const names = new Map(accounts.map((item) => [item.id, item.name]));

  return (
    <>
      <div className={styles.tools}>
        <div className={styles.field}>
          <label htmlFor={`${id}-account`} className={styles.fieldLabel}>
            {m.accountFilter}
          </label>
          <select id={`${id}-account`} className={styles.select} value={account ?? ''} onChange={(event) => setAccount(event.target.value || null)}>
            <option value="">{m.allAccounts}</option>
            {accounts.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.currency})
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-search`} className={styles.fieldLabel}>
            {m.search}
          </label>
          <input
            id={`${id}-search`}
            type="search"
            className={styles.input}
            value={typed}
            maxLength={200}
            placeholder={m.searchPlaceholder}
            onChange={(event) => setTyped(event.target.value)}
          />
        </div>
      </div>
      {list.status === 'loading' && <LoadingBlock rows={4} />}
      {list.status === 'error' && <InlineError message={m.failed} onRetry={list.reload} />}
      {list.status === 'ready' && list.transactions.length === 0 && <p className={styles.empty}>{m.empty}</p>}
      {list.status === 'ready' && list.transactions.length > 0 && (
        <ul className={styles.list}>
          {list.transactions.map((item) => (
            <TransactionRow key={item.id} item={item} accountName={names.get(item.accountId) ?? ''} />
          ))}
        </ul>
      )}
      {list.status === 'ready' && list.hasMore && (
        <div className={styles.more}>
          <button type="button" className={styles.moreButton} disabled={list.loadingMore} onClick={list.loadMore}>
            {list.loadingMore ? m.loadingMore : m.loadMore}
          </button>
          {list.moreFailed && (
            <span role="alert" className={styles.moreFailed}>
              {m.moreFailed}
            </span>
          )}
        </div>
      )}
    </>
  );
};

export default MoneyTransactions;
