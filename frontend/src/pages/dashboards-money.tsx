import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useDashboardLang } from '../context/useDashboardLang';
import InlineError from '../components/dashboards/InlineError/InlineError';
import LoadingBlock from '../components/dashboards/LoadingBlock/LoadingBlock';
import { whenLabel } from '../components/dashboards/Money/labels';
import MoneyAttention from '../components/dashboards/Money/MoneyAttention';
import MoneyCategories from '../components/dashboards/Money/MoneyCategories';
import MoneyDebts from '../components/dashboards/Money/MoneyDebts';
import { debtsOf } from '../components/dashboards/Money/recurringLabels';
import MoneyTotals from '../components/dashboards/Money/MoneyTotals';
import MoneyTransactions from '../components/dashboards/Money/MoneyTransactions';
import MoneyUpcoming from '../components/dashboards/Money/MoneyUpcoming';
import MoneyWallet from '../components/dashboards/Money/MoneyWallet';
import RecurringManager from '../components/dashboards/Money/RecurringManager';
import money from '../components/dashboards/Money/Money.module.css';
import type { ProviderLogo } from '../services/dashboards/financeApi';
import { fill } from '../services/dashboards/calendarLabels';
import { hasConversion } from '../services/dashboards/display';
import { readMoneyDisplay, writeMoneyDisplay, type MoneyDisplay } from '../services/dashboards/preferences';
import { groupBanks } from '../services/dashboards/wallet';
import { pagePath } from '../data/site';
import { useDashboardMode } from '../hooks/useDashboardMode';
import { useFinanceAccounts, useFinanceCategories, useFinanceSummary, useProviderLogos } from '../hooks/useFinance';
import { useAttention, useRecurring, useUpcoming } from '../hooks/useRecurring';
import { usePageTitle } from '../hooks/usePageTitle';
import styles from './dashboards-money.module.css';

/** No logos (until the server sends them, or when it cannot): the text names show. */
const NO_LOGOS: Readonly<Record<string, ProviderLogo>> = {};

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
  const providers = useProviderLogos(live);
  const logos = providers.value ?? NO_LOGOS;
  const [selected, setSelected] = useState<string | null>(null);
  // Stage 2: what needs attention (with the snoozed and dismissed ones on request), the next 14 or 30 days, and the recurring payments (the debts, the management view).
  const [params] = useSearchParams();
  const managing = params.get('view') === 'recurring';
  const [showHidden, setShowHidden] = useState(false);
  const [days, setDays] = useState(14);
  const attention = useAttention(showHidden, live);
  const upcoming = useUpcoming(days, live);
  const recurring = useRecurring(live);
  const changed = () => {
    attention.reload();
    upcoming.reload();
    recurring.reload();
  };
  // A bank entered by hand changed (a balance set, a statement imported): the accounts, the totals, what needs attention and the transactions are asked again.
  const [txKey, setTxKey] = useState(0);
  const dataChanged = () => {
    accounts.reload();
    summary.reload();
    providers.reload();
    changed();
    setTxKey((n) => n + 1);
  };
  const debts = recurring.value ? debtsOf(recurring.value.recurring) : [];
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
          {managing ? (
            <section aria-labelledby="money-recurring-title" className={money.panel}>
              <div className={money.head}>
                <h2 id="money-recurring-title" className={money.title}>
                  {m.rec.managerTitle}
                </h2>
              </div>
              {recurring.status === 'loading' && <LoadingBlock rows={4} />}
              {recurring.status === 'error' && <InlineError message={m.rec.managerFailed} onRetry={recurring.reload} />}
              {recurring.value && <RecurringManager key={params.get('edit') ?? ''} rows={recurring.value.recurring} accounts={accounts.value?.accounts ?? []} mode={mode} editId={params.get('edit')} onChanged={changed} />}
            </section>
          ) : (
            <>
          {attention.value && (
            <MoneyAttention data={attention.value} recurring={recurring.value?.recurring ?? []} accounts={accounts.value?.accounts ?? []} logos={logos} mode={mode} showHidden={showHidden} onToggleHidden={() => setShowHidden((on) => !on)} onChanged={changed} onOpenBank={setSelected} />
          )}
          <section aria-labelledby="money-wallet-title" className={money.panel}>
            <div className={money.head}>
              <h2 id="money-wallet-title" className={money.title}>
                {m.walletTitle}
              </h2>
              <span className={styles.hint}>{m.walletHint}</span>
            </div>
            {accounts.status === 'loading' && <LoadingBlock rows={4} />}
            {accounts.status === 'error' && <InlineError message={m.accountsFailed} onRetry={accounts.reload} />}
            {accounts.value && <MoneyWallet data={accounts.value} selected={selected} mode={mode} logos={logos} onSelect={setSelected} onChanged={dataChanged} />}
          </section>
          <section aria-labelledby="money-upcoming-title" className={money.panel}>
            <div className={money.head}>
              <h2 id="money-upcoming-title" className={money.title}>
                {m.rec.upcomingTitle}
              </h2>
            </div>
            {upcoming.status === 'loading' && <LoadingBlock rows={3} />}
            {upcoming.status === 'error' && <InlineError message={m.rec.upcomingFailed} onRetry={upcoming.reload} />}
            {upcoming.value && <MoneyUpcoming data={upcoming.value} days={days} onDays={setDays} accounts={accounts.value?.accounts ?? []} mode={mode} />}
          </section>
          {debts.length > 0 && (
            <section aria-labelledby="money-debts-title" className={money.panel}>
              <div className={money.head}>
                <h2 id="money-debts-title" className={money.title}>
                  {m.rec.debtsTitle}
                </h2>
              </div>
              <MoneyDebts rows={debts} mode={mode} />
            </section>
          )}
          <section aria-labelledby="money-spend-title" className={money.panel}>
            <div className={money.head}>
              <h2 id="money-spend-title" className={money.title}>
                {m.spendTitle}
              </h2>
            </div>
            {spend.status === 'loading' && <LoadingBlock rows={3} />}
            {spend.status === 'error' && <InlineError message={m.spendFailed} onRetry={spend.reload} />}
            {spend.value && <MoneyCategories data={spend.value} mode={mode} />}
          </section>
          <section aria-labelledby="money-transactions-title" className={money.panel}>
            <div className={money.head}>
              <h2 id="money-transactions-title" className={money.title}>
                {m.transactionsTitle}
              </h2>
            </div>
            <MoneyTransactions key={txKey} banks={banks} logos={logos} categories={spend.value?.currencies.flatMap((block) => block.categories.filter((row) => row.spent > 0).map((row) => row.category)) ?? []} mode={mode} enabled={live} />
          </section>
            </>
          )}
        </>
      )}
    </>
  );
};

export default DashboardsMoney;
