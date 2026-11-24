import { Link } from 'react-router-dom';
import { useDashboardLang } from '../context/useDashboardLang';
import InlineError from '../components/dashboards/InlineError/InlineError';
import LoadingBlock from '../components/dashboards/LoadingBlock/LoadingBlock';
import MoneyAccounts from '../components/dashboards/Money/MoneyAccounts';
import MoneySummary from '../components/dashboards/Money/MoneySummary';
import MoneyTransactions from '../components/dashboards/Money/MoneyTransactions';
import money from '../components/dashboards/Money/Money.module.css';
import { pagePath } from '../data/site';
import { useDashboardMode } from '../hooks/useDashboardMode';
import { useFinanceAccounts, useFinanceSummary } from '../hooks/useFinance';
import { usePageTitle } from '../hooks/usePageTitle';
import styles from './dashboards-money.module.css';

/**
 * /dashboards/personal/money: the personal space's money, read-only, from the finance API. On the left the accounts grouped by
 * provider (each with its link's state and, for one that needs reconnecting, a clear call to do it) and this month per
 * currency; on the right the transactions with an account filter, a search and "Load more". Real data only: on the sample
 * data there is no finance, and the page says so.
 */
const DashboardsMoney = () => {
  const { t } = useDashboardLang();
  const m = t.money;
  usePageTitle(t.titles.money);
  const { mode } = useDashboardMode();
  const live = mode === 'live';
  const accounts = useFinanceAccounts(live);
  const summary = useFinanceSummary(live);

  return (
    <>
      <div className={styles.head}>
        <h1 className={styles.title}>{m.title}</h1>
        <Link to={pagePath('dashboards-personal')} className={styles.back}>
          {m.back}
        </Link>
      </div>
      {!live ? (
        <p className={money.empty}>{m.needsData}</p>
      ) : (
        <div className={styles.columns}>
          <div className={styles.side}>
            <section aria-labelledby="money-accounts-title" className={money.panel}>
              <div className={money.head}>
                <h2 id="money-accounts-title" className={money.title}>
                  {m.accountsTitle}
                </h2>
              </div>
              {accounts.status === 'loading' && <LoadingBlock rows={4} />}
              {accounts.status === 'error' && <InlineError message={m.accountsFailed} onRetry={accounts.reload} />}
              {accounts.value && <MoneyAccounts data={accounts.value} />}
            </section>
            <section aria-labelledby="money-month-title" className={money.panel}>
              <div className={money.head}>
                <h2 id="money-month-title" className={money.title}>
                  {m.monthTitle}
                </h2>
              </div>
              {summary.status === 'loading' && <LoadingBlock rows={2} />}
              {summary.status === 'error' && <InlineError message={m.monthFailed} onRetry={summary.reload} />}
              {summary.value && <MoneySummary summary={summary.value} />}
            </section>
          </div>
          <section aria-labelledby="money-transactions-title" className={money.panel}>
            <div className={money.head}>
              <h2 id="money-transactions-title" className={money.title}>
                {m.transactionsTitle}
              </h2>
            </div>
            <MoneyTransactions accounts={accounts.value?.accounts ?? []} enabled={live} />
          </section>
        </div>
      )}
    </>
  );
};

export default DashboardsMoney;
