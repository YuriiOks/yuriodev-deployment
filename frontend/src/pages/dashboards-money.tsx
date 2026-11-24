import { useState } from 'react';
import type { AttentionItem } from '../services/dashboards/recurringApi';
import { Link, useSearchParams } from 'react-router-dom';
import { useDashboardLang } from '../context/useDashboardLang';
import InlineError from '../components/dashboards/InlineError/InlineError';
import LoadingBlock from '../components/dashboards/LoadingBlock/LoadingBlock';
import { whenLabel } from '../components/dashboards/Money/labels';
import AttentionScroller from '../components/dashboards/Money/AttentionScroller';
import AttentionSheet from '../components/dashboards/Money/AttentionSheet';
import MoneyAttentionView from '../components/dashboards/Money/MoneyAttentionView';
import MoneyViewSwitch, { type MoneyView } from '../components/dashboards/Money/MoneyViewSwitch';
import { orderedActive } from '../components/dashboards/Money/attentionModel';
import MoneyCategories from '../components/dashboards/Money/MoneyCategories';
import MoneyDebts from '../components/dashboards/Money/MoneyDebts';
import { debtsOf, endedOf, todayIso } from '../components/dashboards/Money/recurringLabels';
import MoneyTotals from '../components/dashboards/Money/MoneyTotals';
import MoneyTransactions from '../components/dashboards/Money/MoneyTransactions';
import MoneyUpcoming, { UpcomingToolbar } from '../components/dashboards/Money/MoneyUpcoming';
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
import { useOnResume } from '../hooks/useOnResume';
import { useAttention, useRecurring, useUpcoming } from '../hooks/useRecurring';
import { usePageTitle } from '../hooks/usePageTitle';
import styles from './dashboards-money.module.css';

/** No logos (until the server sends them, or when it cannot): the text names show. */
/** An API bank whose balances are older than this is called out (the same two hours the server calls a connection stale after). */
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

/** A tab that was hidden for this long asks again for the payments and what needs attention when it comes back. */
const RESUME_AFTER_MS = 5 * 60 * 1000;

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
  const viewParam = params.get('view');
  const view: MoneyView = viewParam === 'attention' ? 'attention' : viewParam === 'recurring' ? 'recurring' : 'overview';
  const [showHidden, setShowHidden] = useState(false);
  const [days, setDays] = useState(14);
  const attention = useAttention(showHidden, live);
  const upcoming = useUpcoming(days, live);
  const recurring = useRecurring(live);
  // Resolves when the new answers are in, so a button stays busy until the list it acted on is current.
  const changed = async () => {
    await Promise.all([attention.reload(), upcoming.reload(), recurring.reload()]);
  };
  // A tab left open: when it comes back after a while, or the day has changed, what depends on today is asked again.
  useOnResume(live, (away) => {
    const staleDay = upcoming.value !== null && upcoming.value.from !== '' && upcoming.value.from !== todayIso();
    if (away >= RESUME_AFTER_MS || staleDay) void changed();
  });
  // Something that was read before could not be read again: the last answer stays, and this says it may be out of date.
  const outdated = [accounts, summary, spend, providers, recurring, upcoming, attention].filter((slot) => slot.refreshFailed);
  const retryOutdated = () => {
    for (const slot of outdated) void slot.reload();
  };
  // A bank entered by hand changed (a balance set, a statement imported): the accounts, the totals, what needs attention and the transactions are asked again.
  const [txKey, setTxKey] = useState(0);
  const dataChanged = async () => {
    setTxKey((n) => n + 1);
    await Promise.all([accounts.reload(), summary.reload(), providers.reload(), spend.reload(), changed()]);
  };
  // An account was changed from an attention card (an overdraft limit): the wallet and the totals ask again too.
  const accountChanged = async () => {
    await Promise.all([accounts.reload(), summary.reload(), changed()]);
  };
  // The item whose details are open (a sheet), and the card that opened it.
  const [sheet, setSheet] = useState<{ key: string; opener: HTMLElement | null } | null>(null);
  const ordered = attention.value ? orderedActive(attention.value.items) : [];
  const sheetItem = sheet ? (ordered.find((entry) => entry.key === sheet.key) ?? null) : null;
  /** An item was dealt with: the sheet moves to the next one (or the one before the last) and closes when none is left. */
  const acted = async (done: AttentionItem) => {
    const index = ordered.findIndex((entry) => entry.key === done.key);
    const next = ordered[index + 1] ?? ordered[index - 1];
    setSheet(next && sheet ? { key: next.key, opener: sheet.opener } : null);
    await (done.subjectType === 'account' ? accountChanged() : changed());
  };
  const debts = recurring.value ? debtsOf(recurring.value.recurring) : [];
  const endedDebts = recurring.value ? endedOf(recurring.value.recurring, true) : [];
  // Pounds by default (remembered per viewer); the choice is offered only once the server sends converted figures.
  const [mode, setMode] = useState<MoneyDisplay>(readMoneyDisplay);
  const choose = (next: MoneyDisplay) => {
    setMode(next);
    writeMoneyDisplay(next);
  };
  const converted = accounts.value ? hasConversion(accounts.value.accounts) : false;
  const banks = accounts.value ? groupBanks(accounts.value.accounts, accounts.value.connections) : [];
  // "Updated" says the newest balance read, not the oldest; a bank read by its own API that has gone quiet is warned about apart.
  const newest = summary.value?.asOfNewest ?? summary.value?.asOf ?? null;
  const asOf = newest ? whenLabel(newest, lang) : '';
  const oldest = summary.value?.asOfOldest ?? null;
  const staleSince = (accounts.value?.connections ?? []).flatMap((link) => (link.stale && link.staleSince ? [link.staleSince] : [])).sort()[0] ?? (oldest && Date.now() - Date.parse(oldest) > STALE_AFTER_MS ? oldest : null);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      await dataChanged();
    } finally {
      setRefreshing(false);
    }
  };

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
            {live && (
              <>
                {' · '}
                <button type="button" className={styles.refresh} disabled={refreshing} onClick={() => void refresh()}>
                  {refreshing ? m.refreshing : m.refresh}
                </button>
              </>
            )}
            {staleSince && (
              <>
                {' · '}
                <span className={styles.stale}>{fill(m.staleBanks, { when: whenLabel(staleSince, lang) })}</span>
              </>
            )}
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
      {live && summary.status === 'error' && <InlineError message={m.summaryFailed} onRetry={summary.reload} />}
      {live && outdated.length > 0 && <InlineError message={m.refreshFailed} onRetry={retryOutdated} />}
      {live && <MoneyViewSwitch view={view} attention={ordered.length} hidden={attention.value?.hidden ?? 0} />}
      {live && view === 'overview' && attention.status === 'loading' && (
        <p role="status" className={money.none}>
          {m.checkingAttention}
        </p>
      )}
      {live && view === 'overview' && attention.status === 'error' && <InlineError message={m.rec.attentionFailed} onRetry={attention.reload} />}
      {live && view === 'overview' && ordered.length > 0 && (
        <AttentionScroller items={ordered} allHref="?view=attention" recurring={recurring.value?.recurring ?? []} accounts={accounts.value?.accounts ?? []} logos={logos} mode={mode} onOpen={(entry, trigger) => setSheet({ key: entry.key, opener: trigger })} />
      )}
      {!live ? (
        <p className={money.none}>{m.needsData}</p>
      ) : (
        <>
          {view === 'recurring' ? (
            <section aria-labelledby="money-recurring-title" className={money.panel}>
              <div className={money.head}>
                <h2 id="money-recurring-title" className={money.title}>
                  {m.rec.managerTitle}
                </h2>
              </div>
              {recurring.status === 'loading' && <LoadingBlock rows={4} />}
              {recurring.status === 'error' && <InlineError message={m.rec.managerFailed} onRetry={recurring.reload} />}
              {recurring.value && <RecurringManager key={params.get('edit') ?? ''} rows={recurring.value.recurring} accounts={accounts.value?.accounts ?? []} accountsStatus={accounts.status} onRetryAccounts={accounts.reload} mode={mode} editId={params.get('edit')} onChanged={changed} />}
            </section>
          ) : view === 'attention' ? (
            <>
              {attention.status === 'loading' && <LoadingBlock rows={3} />}
              {attention.status === 'error' && <InlineError message={m.rec.attentionFailed} onRetry={attention.reload} />}
              {attention.value && (
                <MoneyAttentionView data={attention.value} recurring={recurring.value?.recurring ?? []} accounts={accounts.value?.accounts ?? []} logos={logos} mode={mode} showHidden={showHidden} onToggleHidden={() => setShowHidden((on) => !on)} onChanged={changed} onAccountChanged={accountChanged} onOpenBank={setSelected} />
              )}
            </>
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
            {accounts.value && <MoneyWallet data={accounts.value} selected={selected} mode={mode} logos={logos} onSelect={setSelected} onChanged={dataChanged} />}
          </section>
          <section aria-labelledby="money-upcoming-title" className={money.panel}>
            <div className={money.head}>
              <h2 id="money-upcoming-title" className={money.title}>
                {m.rec.upcomingTitle}
              </h2>
            </div>
            <UpcomingToolbar days={days} onDays={setDays} />
            {upcoming.status === 'loading' && <LoadingBlock rows={3} />}
            {upcoming.status === 'error' && <InlineError message={m.rec.upcomingFailed} onRetry={upcoming.reload} />}
            {upcoming.value && <MoneyUpcoming data={upcoming.value} days={days} accounts={accounts.value?.accounts ?? []} recurring={recurring.value?.recurring ?? []} mode={mode} />}
          </section>
          {/* Shown while the payments load and when they cannot be read (a failure must not look like having no debts); hidden only when they were read and there are none. */}
          {(recurring.status !== 'ready' || debts.length > 0 || endedDebts.length > 0) && (
            <section aria-labelledby="money-debts-title" className={money.panel}>
              <div className={money.head}>
                <h2 id="money-debts-title" className={money.title}>
                  {m.rec.debtsTitle}
                </h2>
              </div>
              {recurring.status === 'loading' && <LoadingBlock rows={2} />}
              {recurring.status === 'error' && <InlineError message={m.rec.debtsFailed} onRetry={recurring.reload} />}
              {recurring.value && <MoneyDebts rows={debts} ended={endedDebts} mode={mode} />}
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
      {live && sheet && sheetItem && (
        <AttentionSheet item={sheetItem} recurring={recurring.value?.recurring ?? []} accounts={accounts.value?.accounts ?? []} logos={logos} mode={mode} opener={sheet.opener} onClose={() => setSheet(null)} onActed={acted} onRefresh={changed} onOpenBank={setSelected} />
      )}
    </>
  );
};

export default DashboardsMoney;
