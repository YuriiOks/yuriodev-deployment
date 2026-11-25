import React, { useEffect, useId, useRef, useState } from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { fill } from '../../../services/dashboards/calendarLabels';
import CategoryMark from './CategoryMark';
import { CATEGORIES, setInternalTransfer, type Category, type FinanceAccount, type FinanceTransaction, type ProviderLogo } from '../../../services/dashboards/financeApi';
import { formatMinor } from '../../../services/dashboards/money';
import type { MoneyDisplay } from '../../../services/dashboards/preferences';
import Amount from './Amount';
import { useTransactions } from '../../../hooks/useFinance';
import type { Bank } from '../../../services/dashboards/wallet';
import { cx } from '../../../utils/cx';
import InlineError from '../InlineError/InlineError';
import LoadingBlock from '../LoadingBlock/LoadingBlock';
import ProjectIcon from '../ProjectIcon/ProjectIcon';
import BankMark from './BankMark';
import BankName from './BankName';
import { dayLabel, whenLabel } from './labels';
import { bankLabel } from './providers';
import styles from './Money.module.css';

const SEARCH_DELAY_MS = 300;
/** A bank chip filters the loaded pages (the API filters by one account); more pages are fetched on its own until this many show or this many pages were read. */
const WANTED_ROWS = 15;
const MAX_AUTO_PAGES = 6;

/** One transaction: an arrow and a sign for money in or out (and a word for a screen reader), what it was, when, which bank and account, and its marks. */
const TransactionRow: React.FC<{ item: FinanceTransaction; account: FinanceAccount | undefined; logo: ProviderLogo | undefined; mode: MoneyDisplay; onChanged: () => void }> = ({ item, account, logo, mode, onChanged }) => {
  const { t, lang } = useDashboardLang();
  const m = t.money;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // A line the owner has not marked can be marked as a move between their own accounts; the owner's own mark can be undone (a mark the server set cannot be undone from here).
  const canMark = !item.declined && (!item.internalTransfer || item.internalTransferByOwner);
  const toggleInternal = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await setInternalTransfer(item.id, !item.internalTransfer);
      onChanged();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const incoming = item.amount > 0;
  const what = item.counterparty ?? (item.description || '—');
  const detail = item.counterparty && item.description && item.description !== item.counterparty ? item.description : '';
  // Spent in the display currency itself on a card of another: that original is the exact figure, so it is the main one (no "≈") and its own tag is not repeated.
  const exactOriginal = mode === 'base' && item.originalAmount !== null && item.originalCurrency !== null && item.display !== null && item.originalCurrency === item.display.currency && item.originalCurrency !== item.currency;
  const exactMinor = item.originalAmount === null ? 0 : item.amount < 0 ? -Math.abs(item.originalAmount) : Math.abs(item.originalAmount);
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
      {account && <BankMark provider={account.provider} logo={logo} />}
      <span className={styles.main}>
        <span className={styles.what} title={detail ? `${what}: ${detail}` : what}>
          {what}
        </span>
        <span className={styles.meta}>
          <span>{item.timeKnown ? whenLabel(item.bookedAt, lang) : dayLabel(item.bookedAt, lang)}</span>
          {account && (
            <span>
              {bankLabel(account.provider, logo)} · {account.name}
            </span>
          )}
          <span className={styles.tag} data-category={item.category}>
            <CategoryMark category={item.category} />
            {m.categories[item.category]}
          </span>
          {item.pending && <span className={styles.tag}>{m.pending}</span>}
          {item.declined && <span className={styles.tag}>{m.declined}</span>}
          {item.internalTransfer && <span className={styles.tag}>{m.internal}</span>}
          {canMark && (
            <button type="button" className={styles.markMove} disabled={busy} onClick={() => void toggleInternal()}>
              {item.internalTransfer ? m.unmarkInternal : m.markInternal}
            </button>
          )}
          {failed && <span role="alert">{m.internalFailed}</span>}
          {!exactOriginal && item.originalAmount !== null && item.originalCurrency && item.originalCurrency !== item.currency && (
            <span>{fill(m.originalAmount, { amount: formatMinor(Math.abs(item.originalAmount), item.originalCurrency, lang) })}</span>
          )}
        </span>
      </span>
      <span className={styles.amount}>
        {item.amount !== 0 && <span className="sr-only">{incoming ? m.moneyIn : m.moneyOut}: </span>}
        {exactOriginal && item.originalCurrency ? (
          <>
            {formatMinor(exactMinor, item.originalCurrency, lang, { signed: true })} <small className={styles.original}>{formatMinor(item.amount, item.currency, lang, { signed: true })}</small>
          </>
        ) : (
          <Amount amount={item.amount} currency={item.currency} display={item.display} mode={mode} signed />
        )}
      </span>
    </li>
  );
};

export interface MoneyTransactionsProps {
  banks: readonly Bank[];
  /** The categories that have spending this month (the server's report), offered as chips beside the ones seen in the rows. */
  categories: readonly Category[];
  mode: MoneyDisplay;
  /** The banks' wordmarks by provider id: the bank chips show them when there is one. */
  logos: Readonly<Record<string, ProviderLogo>>;
  enabled: boolean;
}

/**
 * The transactions, newest first: the bank as chips (all banks, or one), then, inside a bank, an account choice; a text search
 * (applied after a short pause in typing) and "Load more" by the server's cursor. Each row names its bank and account.
 */
const MoneyTransactions: React.FC<MoneyTransactionsProps> = ({ banks, categories, mode, logos, enabled }) => {
  const { t } = useDashboardLang();
  const m = t.money;
  const id = useId();
  const [provider, setProvider] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [typed, setTyped] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(typed.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [typed]);

  const allAccounts = banks.flatMap((bank) => bank.accounts);
  const byId = new Map(allAccounts.map((item) => [item.id, item]));
  const bank = banks.find((candidate) => candidate.provider === provider) ?? null;
  const list = useTransactions(account, category, query, enabled);
  // A chip group that scrolls sideways keeps the pressed chip in view when the choice changes.
  const bankChips = useRef<HTMLDivElement>(null);
  const categoryChips = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    for (const group of [bankChips.current, categoryChips.current]) group?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [provider, category]);
  const chipCategories = CATEGORIES.filter((candidate) => candidate === category || categories.includes(candidate) || list.transactions.some((item) => item.category === candidate));
  const inBank = bank ? new Set(bank.accounts.map((item) => item.id)) : null;
  const shown = list.transactions.filter((item) => !inBank || inBank.has(item.accountId));

  // A bank filter is applied to what is loaded, so it reads further pages on its own until enough rows show (a few pages at most).
  const { status, hasMore, loadingMore, moreFailed, loadMore, pages } = list;
  const wantMore = status === 'ready' && inBank !== null && account === null && hasMore && !loadingMore && !moreFailed && shown.length < WANTED_ROWS && pages < MAX_AUTO_PAGES;
  useEffect(() => {
    if (wantMore) loadMore();
  }, [wantMore, loadMore, pages]);

  const chooseBank = (next: string | null) => {
    setProvider(next);
    setAccount(null);
  };

  return (
    <>
      <div className={styles.tools}>
        <div role="group" aria-label={m.bankFilter} className={styles.chips} ref={bankChips}>
          <button type="button" className={cx(styles.chip, provider === null && styles.chipOn)} aria-pressed={provider === null} onClick={() => chooseBank(null)}>
            {m.allBanks}
          </button>
          {banks
            .filter((candidate) => candidate.accounts.length > 0)
            .map((candidate) => (
              <button
                key={candidate.provider}
                type="button"
                className={cx(styles.chip, provider === candidate.provider && styles.chipOn)}
                aria-pressed={provider === candidate.provider}
                onClick={() => chooseBank(candidate.provider)}
              >
                {logos[candidate.provider]?.mark ? (
                  <>
                    <span className="sr-only">{bankLabel(candidate.provider, logos[candidate.provider])}</span>
                    <BankMark provider={candidate.provider} logo={logos[candidate.provider]} />
                  </>
                ) : (
                  <BankName provider={candidate.provider} logo={logos[candidate.provider]} size="chip" />
                )}
              </button>
            ))}
        </div>
        {chipCategories.length > 0 && (
          <div role="group" aria-label={m.categoryFilter} className={styles.chips} ref={categoryChips}>
            <button type="button" className={cx(styles.chip, category === null && styles.chipOn)} aria-pressed={category === null} onClick={() => setCategory(null)}>
              {m.allCategories}
            </button>
            {chipCategories.map((candidate) => (
              <button key={candidate} type="button" className={cx(styles.chip, category === candidate && styles.chipOn)} data-category={candidate} aria-pressed={category === candidate} onClick={() => setCategory(candidate)}>
                <CategoryMark category={candidate} />
                {m.categories[candidate]}
              </button>
            ))}
          </div>
        )}
        <div className={styles.fields}>
          {bank && (
            <div className={styles.field}>
              <label htmlFor={`${id}-account`} className={styles.fieldLabel}>
                {m.accountFilter}
              </label>
              <select id={`${id}-account`} className={styles.select} value={account ?? ''} onChange={(event) => setAccount(event.target.value || null)}>
                <option value="">{m.allAccounts}</option>
                {bank.accounts.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.currency}
                    {item.maskLast4 ? ` ····${item.maskLast4}` : ''})
                  </option>
                ))}
              </select>
            </div>
          )}
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
      </div>
      {list.status === 'loading' && <LoadingBlock rows={4} />}
      {list.status === 'error' && <InlineError message={m.failed} onRetry={list.reload} />}
      {list.status === 'ready' && shown.length === 0 && !loadingMore && !wantMore && <p className={styles.none}>{m.empty}</p>}
      {list.status === 'ready' && shown.length > 0 && (
        <ul className={styles.list}>
          {shown.map((item) => (
            <TransactionRow key={item.id} item={item} account={byId.get(item.accountId)} logo={logos[byId.get(item.accountId)?.provider ?? '']} mode={mode} onChanged={list.reload} />
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
