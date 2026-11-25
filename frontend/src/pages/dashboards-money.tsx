import { useEffect, useState } from 'react';
import type { AttentionItem } from '../services/dashboards/recurringApi';
import { useSearchParams } from 'react-router-dom';
import { useDashboardLang } from '../context/useDashboardLang';
import InlineError from '../components/dashboards/InlineError/InlineError';
import LoadingBlock from '../components/dashboards/LoadingBlock/LoadingBlock';
import { freshLabel } from '../components/dashboards/Money/labels';
import AttentionScroller from '../components/dashboards/Money/AttentionScroller';
import AttentionSheet from '../components/dashboards/Money/AttentionSheet';
import MoneyAttentionView from '../components/dashboards/Money/MoneyAttentionView';
import MoneyToday from '../components/dashboards/Money/MoneyToday';
import { TodayFrame } from '../components/dashboards/Today/TodayLayout';
import MoneyViewSwitch from '../components/dashboards/Money/MoneyViewSwitch';
import { MONEY_VIEWS, type MoneyView } from '../components/dashboards/Money/moneyViews';
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
import { useToday } from '../hooks/useToday';
import { usePageTitle } from '../hooks/usePageTitle';
import { readStorage, writeStorage } from '../utils/safeStorage';
import styles from './dashboards-money.module.css';

/** No logos (until the server sends them, or when it cannot): the text names show. */
/** An API bank whose balances are older than this is called out (the same two hours the server calls a connection stale after). */
/** Where the last opened bank is remembered (the wallet opens it again next time). */
const BANK_KEY = 'dashboards-money-bank';

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
  const [params, setParams] = useSearchParams();
  const viewParam = params.get('view');
  const view: MoneyView = (MONEY_VIEWS as readonly string[]).includes(viewParam ?? '') ? (viewParam as MoneyView) : 'today';
  // Each list is asked for only when a view that shows it is open, and an answer held is kept across tab switches (the Today view needs none of them: it is one answer).
  const shows = (views: readonly MoneyView[]) => live && views.includes(view);
  const notToday = live && view !== 'today';
  const accounts = useFinanceAccounts(notToday);
  const summary = useFinanceSummary(notToday);
  const spend = useFinanceCategories(shows(['spending', 'transactions', 'all']));
  const providers = useProviderLogos(shows(['wallet', 'payments', 'transactions', 'attention', 'all']));
  const logos = providers.value ?? NO_LOGOS;
  // The opened bank is kept in the address (?bank=), and the last one opened is remembered for the next visit; with neither, the wallet opens its first bank (the one that needs attention, else the biggest).
  const selected = params.get('bank') ?? readStorage('local', BANK_KEY);
  const setSelected = (provider: string) => {
    const next = new URLSearchParams(params);
    next.set('bank', provider);
    setParams(next, { replace: true });
    writeStorage('local', BANK_KEY, provider);
  };
  // The transactions' bank filter lives in the address too (?txbank=): the opened bank's "Transactions" pill sets it.
  const txBank = params.get('txbank');
  const setTxBank = (provider: string | null) => {
    const next = new URLSearchParams(params);
    if (provider) next.set('txbank', provider);
    else next.delete('txbank');
    setParams(next, { replace: true });
  };
  // Stage 2: what needs attention (with the snoozed and dismissed ones on request), the next 14 or 30 days, and the recurring payments (the debts, the management view).
  const [showHidden, setShowHidden] = useState(false);
  const [days, setDays] = useState(14);
  const attention = useAttention(showHidden, shows(['attention', 'all']));
  const upcoming = useUpcoming(days, shows(['payments', 'all']));
  const recurring = useRecurring(shows(['payments', 'attention', 'recurring', 'all']));
  // The Today view: the server's one answer for the page.
  const todayData = useToday('money', shows(['today']));
  // Resolves when the new answers are in, so a button stays busy until the list it acted on is current.
  const changed = async () => {
    await Promise.all([todayData.reload(), attention.reload(), upcoming.reload(), recurring.reload()]);
  };
  // The bank's consent page sends the owner back with ?monzo=<status>: the result is shown once and the address is cleaned.
  const consentParam = params.get('monzo');
  const [consent, setConsent] = useState<'connected' | 'denied' | 'invalid_state' | 'failed' | null>(null);
  useEffect(() => {
    if (consentParam === null) return;
    setConsent(consentParam === 'connected' || consentParam === 'denied' || consentParam === 'invalid_state' ? consentParam : 'failed');
    const next = new URLSearchParams(params);
    next.delete('monzo');
    setParams(next, { replace: true });
    if (consentParam === 'connected') void dataChanged();
    // Once per arrival: the parameter is gone after this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consentParam]);
  // A tab left open: when it comes back after a while, or the day has changed, what depends on today is asked again.
  useOnResume(live, (away) => {
    const staleDay = upcoming.value !== null && upcoming.value.from !== '' && upcoming.value.from !== todayIso();
    if (away >= RESUME_AFTER_MS || staleDay) void changed();
  });
  // Something that was read before could not be read again: the last answer stays, and this says it may be out of date.
  const outdated = [accounts, summary, spend, providers, recurring, upcoming, attention, todayData].filter((slot) => slot.refreshFailed);
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
  // "One at a time" from Today leads here with ?walk=1: the details sheet opens on the first item, and the address is cleaned.
  const walk = params.get('walk');
  useEffect(() => {
    if (view !== 'attention' || !walk || ordered.length === 0) return;
    setSheet({ key: ordered[0].key, opener: null });
    const next = new URLSearchParams(params);
    next.delete('walk');
    setParams(next, { replace: true });
    // Once per arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, walk, ordered.length]);
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
  // Today holds no accounts: the switch is offered when a row of its one answer was converted.
  const todayConverted = [...(todayData.value?.soon ?? []), ...(todayData.value?.queue ?? [])].some((entry) => entry.facts.converted === true);
  const hiddenFact = todayData.value?.summary.facts.hidden_attention;
  const hiddenAttention = typeof hiddenFact === 'number' && hiddenFact > 0 ? hiddenFact : 0;
  const banks = accounts.value ? groupBanks(accounts.value.accounts, accounts.value.connections) : [];
  // "Updated" says the newest balance read, not the oldest; a bank read by its own API that has gone quiet is warned about apart.
  const newest = view === 'today' ? (todayData.value?.generatedAt ?? null) : (summary.value?.asOfNewest ?? summary.value?.asOf ?? null);
  const asOf = newest ? freshLabel(newest, lang) : '';
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

  // The sections of the page: each is a view of its own (Wallet, Payments, Spending, Transactions); `all` shows them together.
  const walletSection = (
    <section aria-labelledby="money-wallet-title" className={money.panel}>
            {live && accounts.value && <MoneyTotals accounts={accounts.value.accounts} summary={summary.value} mode={mode} />}
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
  );
  const upcomingSection = (
    <section aria-labelledby="money-upcoming-title" className={money.panel}>
            <div className={money.head}>
              <h2 id="money-upcoming-title" className={money.title}>
                {m.rec.upcomingTitle}
              </h2>
            </div>
            <UpcomingToolbar days={days} onDays={setDays} />
            {upcoming.status === 'loading' && <LoadingBlock rows={3} />}
            {upcoming.status === 'error' && <InlineError message={m.rec.upcomingFailed} onRetry={upcoming.reload} />}
            {upcoming.value && <MoneyUpcoming key={days} data={upcoming.value} days={days} accounts={accounts.value?.accounts ?? []} recurring={recurring.value?.recurring ?? []} logos={logos} mode={mode} />}
          </section>
  );
  const debtsSection = (
    <>
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
    </>
  );
  const spendSection = (
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
  );
  const transactionsSection = (
    <section aria-labelledby="money-transactions-title" className={money.panel}>
            <div className={money.head}>
              <h2 id="money-transactions-title" className={money.title}>
                {m.transactionsTitle}
              </h2>
            </div>
            <MoneyTransactions bank={txBank} onBank={setTxBank} refresh={txKey} onCategoriesChanged={() => void spend.reload()} banks={banks} logos={logos} categories={spend.value?.currencies.flatMap((block) => block.categories.filter((row) => row.spent > 0).map((row) => row.category)) ?? []} mode={mode} enabled={live} />
          </section>
  );
  // How fresh the data is, Refresh, and the pounds / account currency switch: quiet controls (Today's header row, and the other views' header).
  const freshness = (
    <>
      {asOf && <span>{fill(m.updated, { when: asOf })}</span>}
      {live && (
        <button type="button" className={styles.refresh} disabled={refreshing} onClick={() => void refresh()}>
          {refreshing ? m.refreshing : m.refresh}
        </button>
      )}
      {staleSince && <span className={styles.stale}>{fill(m.staleBanks, { when: freshLabel(staleSince, lang) })}</span>}
    </>
  );

  // The label of the converted figures is built from the display currency the server converts into (pounds today).
  const factCurrency = todayData.value?.summary.facts.currency;
  const baseCode = summary.value?.display?.currency ?? (typeof factCurrency === 'string' ? factCurrency : 'GBP');
  const showSwitch = live && (view === 'today' ? todayConverted : converted);
  const modeSwitch = showSwitch ? (
    <div role="group" aria-label={m.displayLabel} className={money.display}>
      {(['base', 'native'] as const).map((choice) => (
        <button key={choice} type="button" className={money.displayChoice} aria-pressed={mode === choice} onClick={() => choose(choice)}>
          {choice === 'base' ? (baseCode === 'GBP' ? m.displayBase : fill(m.displayBaseIn, { currency: baseCode })) : m.displayNative}
        </button>
      ))}
    </div>
  ) : null;
  const controls = (
    <>
      <span className={styles.todayFresh}>{freshness}</span>
      {modeSwitch}
    </>
  );

  const body = (
    <>
      {consent && (
        <div role={consent === 'connected' ? 'status' : 'alert'} className={styles.consent} data-result={consent}>
          <span>{m.consent[consent]}</span>
          <button type="button" className={styles.refresh} onClick={() => setConsent(null)}>
            {m.dismiss}
          </button>
        </div>
      )}
      {live && summary.status === 'error' && <InlineError message={m.summaryFailed} onRetry={summary.reload} />}
      {live && outdated.length > 0 && <InlineError message={m.refreshFailed} onRetry={retryOutdated} />}
      {live && view === 'all' && attention.status === 'loading' && (
        <p role="status" className={money.none}>
          {m.checkingAttention}
        </p>
      )}
      {live && view === 'all' && attention.status === 'error' && <InlineError message={m.rec.attentionFailed} onRetry={attention.reload} />}
      {live && view === 'all' && ordered.length > 0 && (
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
          ) : view === 'today' ? (
            <MoneyToday
              nav={<MoneyViewSwitch view={view} attention={todayData.value?.queueTotal ?? 0} hidden={hiddenAttention} />}
              data={todayData.value}
              failed={todayData.status === 'error' || todayData.refreshFailed}
              onChanged={changed}
              controls={controls}
              mode={mode}
            />
          ) : view === 'wallet' ? (
            walletSection
          ) : view === 'payments' ? (
            <>
              {upcomingSection}
              {debtsSection}
            </>
          ) : view === 'spending' ? (
            spendSection
          ) : view === 'transactions' ? (
            transactionsSection
          ) : (
            <>
              {walletSection}
              {upcomingSection}
              {debtsSection}
              {spendSection}
              {transactionsSection}
            </>
          )}
        </>
      )}
      {live && sheet && sheetItem && (
        <AttentionSheet item={sheetItem} recurring={recurring.value?.recurring ?? []} accounts={accounts.value?.accounts ?? []} logos={logos} mode={mode} opener={sheet.opener} onClose={() => setSheet(null)} onActed={acted} onRefresh={changed} onOpenBank={setSelected} />
      )}
    </>
  );
  // Every view wears the same header row (the mark, the name and the tabs at the left; when it was read, Refresh and the display switch at the right):
  // Today draws it itself, the others sit under it, so switching tabs never moves them.
  return view === 'today' ? (
    body
  ) : (
    <TodayFrame mark="£" place={m.title} placeIsHeading markTo={{ to: pagePath('dashboards-personal'), label: m.back }} controls={controls} nav={<MoneyViewSwitch view={view} attention={ordered.length} hidden={attention.value?.hidden ?? 0} />}>
      {body}
    </TodayFrame>
  );
};

export default DashboardsMoney;
