import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useDashboardLang } from '../context/useDashboardLang';
import InlineError from '../components/dashboards/InlineError/InlineError';
import LoadingBlock from '../components/dashboards/LoadingBlock/LoadingBlock';
import { whenLabel } from '../components/dashboards/Money/labels';
import MoneyCategories from '../components/dashboards/Money/MoneyCategories';
import MoneyTotals from '../components/dashboards/Money/MoneyTotals';
import MoneyTransactions from '../components/dashboards/Money/MoneyTransactions';
import MoneyWallet from '../components/dashboards/Money/MoneyWallet';
import money from '../components/dashboards/Money/Money.module.css';
import { fill } from '../services/dashboards/calendarLabels';
import { hasConversion } from '../services/dashboards/display';
import { readMoneyDisplay, writeMoneyDisplay, type MoneyDisplay } from '../services/dashboards/preferences';
import { groupBanks } from '../services/dashboards/wallet';
import { pagePath } from '../data/site';
import { useDashboardMode } from '../hooks/useDashboardMode';
import { useFinanceAccounts, useFinanceCategories, useFinanceSummary } from '../hooks/useFinance';
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
  const { mode: dataMode } = useDashboardMode();
  const live = dataMode === 'live';
  const accounts = useFinanceAccounts(live);
  const summary = useFinanceSummary(live);
  const spend = useFinanceCategories(live);
  const [selected, setSelected] = useState<string | null>(null);
  // Pounds by default (remembered per viewer); the choice is offered only once the server sends converted figures.
  const [mode, setMode] = useState<MoneyDisplay>(readMoneyDisplay);
  const choose = (next: MoneyDisplay) => {
    setMode(next);
    writeMoneyDisplay(next);
  };
  const converted = accounts.value ? hasConversion(accounts.value.accounts, summary.value) : false;
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
          {live && converted && (
            <div role="group" aria-label={m.displayLabel} className={money.display}>
              {(['base', 'native'] as const).map((choice) => (
                <button key={choice} type="button" className={money.displayChoice} aria-pressed={mode === choice} onClick={() => choose(choice)}>
                  {choice === 'base' ? m.displayBase : m.displayNative}
                </button>
              ))}
            </div>
          )}
        </div>
        {live && accounts.value && <MoneyTotals accounts={accounts.value.accounts} summary={summary.value} mode={mode} />}
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
            {accounts.value && <MoneyWallet data={accounts.value} selected={selected} mode={mode} onSelect={setSelected} />}
          </section>
          <section aria-labelledby="money-spend-title" className={money.panel}>
            <div className={money.head}>
              <h2 id="money-spend-title" className={money.title}>
                {m.spendTitle}
              </h2>
            </div>
            {spend.status === 'loading' && <LoadingBlock rows={3} />}
            {spend.status === 'error' && <InlineError message={m.spendFailed} onRetry={spend.reload} />}
            {spend.value && <MoneyCategories data={spend.value} />}
          </section>
          <section aria-labelledby="money-transactions-title" className={money.panel}>
            <div className={money.head}>
              <h2 id="money-transactions-title" className={money.title}>
                {m.transactionsTitle}
              </h2>
            </div>
            <MoneyTransactions banks={banks} categories={spend.value?.currencies.flatMap((block) => block.categories.filter((row) => row.spent > 0).map((row) => row.category)) ?? []} mode={mode} enabled={live} />
          </section>
        </>
      )}
    </>
  );
};

export default DashboardsMoney;
