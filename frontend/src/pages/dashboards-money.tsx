import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useDashboardLang } from '../context/useDashboardLang';
import InlineError from '../components/dashboards/InlineError/InlineError';
import LoadingBlock from '../components/dashboards/LoadingBlock/LoadingBlock';
import { whenLabel } from '../components/dashboards/Money/labels';
import MoneyTotals from '../components/dashboards/Money/MoneyTotals';
import MoneyTransactions from '../components/dashboards/Money/MoneyTransactions';
import MoneyWallet from '../components/dashboards/Money/MoneyWallet';
import money from '../components/dashboards/Money/Money.module.css';
import { fill } from '../services/dashboards/calendarLabels';
import { groupBanks } from '../services/dashboards/wallet';
import { pagePath } from '../data/site';
import { useDashboardMode } from '../hooks/useDashboardMode';
import { useFinanceAccounts, useFinanceSummary } from '../hooks/useFinance';
import { usePageTitle } from '../hooks/usePageTitle';
import styles from './dashboards-money.module.css';

/**
 * /dashboards/personal/money: the personal space's money, read-only, from the finance API. A strip of totals per currency, the
 * wallet (every bank as a coloured card in a stack, the chosen bank opened beside it with its accounts, its pots and what is
 * empty folded away) and the transactions with bank chips, a search and "Load more". Real data only: on the sample data there is
 * no finance, and the page says so.
 */
const DashboardsMoney = () => {
  const { t, lang } = useDashboardLang();
  const m = t.money;
  usePageTitle(t.titles.money);
  const { mode } = useDashboardMode();
  const live = mode === 'live';
  const accounts = useFinanceAccounts(live);
  const summary = useFinanceSummary(live);
  const [selected, setSelected] = useState<string | null>(null);
  const banks = accounts.value ? groupBanks(accounts.value.accounts, accounts.value.connections) : [];
  const asOf = summary.value?.asOf ? whenLabel(summary.value.asOf, lang) : '';

  return (
    <>
      <header className={styles.header}>
        <div className={styles.titles}>
          <h1 className={styles.title}>{m.title}</h1>
          <p className={styles.sub}>
            <Link to={pagePath('dashboards-personal')} className={styles.back}>
              {m.back}
            </Link>
            {asOf && <> · {fill(m.updated, { when: asOf })}</>}
          </p>
        </div>
        {live && accounts.value && <MoneyTotals accounts={accounts.value.accounts} summary={summary.value} />}
      </header>
      {!live ? (
        <p className={money.none}>{m.needsData}</p>
      ) : (
        <>
          <section aria-labelledby="money-wallet-title" className={money.panel}>
            <div className={money.head}>
              <h2 id="money-wallet-title" className={money.title}>
                {m.walletTitle}
              </h2>
              <span className={styles.hint}>{m.walletHint}</span>
            </div>
            {accounts.status === 'loading' && <LoadingBlock rows={4} />}
            {accounts.status === 'error' && <InlineError message={m.accountsFailed} onRetry={accounts.reload} />}
            {accounts.value && <MoneyWallet data={accounts.value} selected={selected} onSelect={setSelected} />}
          </section>
          <section aria-labelledby="money-transactions-title" className={money.panel}>
            <div className={money.head}>
              <h2 id="money-transactions-title" className={money.title}>
                {m.transactionsTitle}
              </h2>
            </div>
            <MoneyTransactions banks={banks} enabled={live} />
          </section>
        </>
      )}
    </>
  );
};

export default DashboardsMoney;
