import React from 'react';
import { Link } from 'react-router-dom';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { pagePath } from '../../../data/site';
import { useFinanceAccounts } from '../../../hooks/useFinance';
import { useIncome } from '../../../hooks/useIncome';
import { formatMinor } from '../../../services/dashboards/money';
import InlineError from '../InlineError/InlineError';
import LoadingBlock from '../LoadingBlock/LoadingBlock';
import BankMark from './BankMark';
import { whenLabel } from './labels';
import { providerName } from './providers';
import styles from './Money.module.css';

/**
 * The personal space's "Work and income" tab on real data: this month's income per currency (the server's own "income" sorting; moves
 * between the owner's accounts and declined payments are not income) and the last ten incoming transactions, with the way to every
 * transaction on the Money page. Read-only.
 */
const WorkIncome: React.FC = () => {
  const { t, lang } = useDashboardLang();
  const m = t.money;
  const income = useIncome(true);
  const accounts = useFinanceAccounts(true);
  const byId = new Map((accounts.value?.accounts ?? []).map((account) => [account.id, account]));

  return (
    <>
      <section aria-labelledby="income-month-title" className={styles.panel}>
        <div className={styles.head}>
          <h2 id="income-month-title" className={styles.title}>
            {m.incomeMonth}
          </h2>
        </div>
        {income.status === 'loading' && <LoadingBlock rows={2} />}
        {income.status === 'error' && <InlineError message={m.incomeFailed} onRetry={income.reload} />}
        {income.income && income.income.totals.length === 0 && <p className={styles.none}>{m.incomeNone}</p>}
        {income.income && income.income.totals.length > 0 && (
          <ul className={styles.totals}>
            {income.income.totals.map((total) => (
              <li key={total.currency} className={styles.total}>
                <span className={styles.totalLabel}>{total.currency}</span>
                <span className={styles.totalSum}>{formatMinor(total.amount, total.currency, lang)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="income-latest-title" className={styles.panel}>
        <div className={styles.head}>
          <h2 id="income-latest-title" className={styles.title}>
            {m.incomeLatest}
          </h2>
        </div>
        {income.status === 'loading' && <LoadingBlock rows={4} />}
        {income.income && income.income.latest.length === 0 && <p className={styles.none}>{m.incomeNone}</p>}
        {income.income && income.income.latest.length > 0 && (
          <ul className={styles.list}>
            {income.income.latest.map((item) => {
              const account = byId.get(item.accountId);
              return (
                <li key={item.id} className={styles.tx} data-direction="in">
                  <span aria-hidden="true" className={styles.arrow} />
                  {account ? <BankMark provider={account.provider} /> : <span aria-hidden="true" />}
                  <span className={styles.main}>
                    <span className={styles.what} title={item.description}>
                      {item.counterparty ?? (item.description || '—')}
                    </span>
                    <span className={styles.meta}>
                      <span>{whenLabel(item.bookedAt, lang)}</span>
                      {account && (
                        <span>
                          {providerName(account.provider)} · {account.name}
                        </span>
                      )}
                      {item.pending && <span className={styles.tag}>{m.pending}</span>}
                    </span>
                  </span>
                  <span className={styles.amount}>
                    <span className="sr-only">{m.moneyIn}: </span>
                    {formatMinor(item.amount, item.currency, lang, { signed: true })}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <div className={styles.more}>
          <Link to={pagePath('dashboards-money')} className={styles.moreButton}>
            {m.incomeAll}
          </Link>
        </div>
      </section>
    </>
  );
};

export default WorkIncome;
