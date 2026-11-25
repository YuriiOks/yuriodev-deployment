import React, { useEffect, useId, useRef, useState } from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { useLimit } from '../../../hooks/useLimit';
import { fill } from '../../../services/dashboards/calendarLabels';
import CategoryMark from './CategoryMark';
import { CATEGORIES, setInternalTransfer, setTransactionCategory, type Category, type FinanceAccount, type FinanceTransaction, type ProviderLogo } from '../../../services/dashboards/financeApi';
import { formatMinor } from '../../../services/dashboards/money';
import type { MoneyDisplay } from '../../../services/dashboards/preferences';
import Amount from './Amount';
import { useTransactions } from '../../../hooks/useFinance';
import type { Bank } from '../../../services/dashboards/wallet';
import { cx } from '../../../utils/cx';
import InlineError from '../InlineError/InlineError';
import LoadingBlock from '../LoadingBlock/LoadingBlock';
import BankMark from './BankMark';
import { dayTitle, localDay, timeLabel } from './labels';
import { bankLabel } from './providers';
import styles from './Money.module.css';

const SEARCH_DELAY_MS = 300;
/** A bank chip filters the loaded pages (the API filters by one account); more pages are fetched on its own until this many show or this many pages were read. */
const WANTED_ROWS = 15;
const MAX_AUTO_PAGES = 6;

/** The text with the part the search matched marked (case does not matter). */
const Highlight: React.FC<{ text: string; query: string }> = ({ text, query }) => {
  const at = query === '' ? -1 : text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className={styles.hit}>{text.slice(at, at + query.length)}</mark>
      {text.slice(at + query.length)}
    </>
  );
};

/**
 * The row's "⋯" menu: the owner's category for the line (a choice, and the way back to the automatic one) and, for a line that can be marked,
 * the move between their own accounts. Closed by Escape, by a click outside or by choosing; focus goes back to its button.
 */
const RowMenu: React.FC<{ item: FinanceTransaction; name: string; canMark: boolean; busy: boolean; failed: string | null; onToggleInternal: () => void; onCategory: (category: Category | null) => void }> = ({ item, name, canMark, busy, failed, onToggleInternal, onCategory }) => {
  const { t } = useDashboardLang();
  const m = t.money;
  const id = useId();
  const [open, setOpen] = useState(false);
  const holder = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event: PointerEvent) => {
      if (holder.current && !holder.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  return (
    <span className={styles.rowMenu} ref={holder} onKeyDown={(event) => event.key === 'Escape' && open && close()}>
      <button ref={button} type="button" className={styles.rowMenuButton} aria-expanded={open} aria-controls={open ? id : undefined} aria-label={fill(m.rowActions, { name })} title={fill(m.rowActions, { name })} onClick={() => setOpen((on) => !on)}>
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <div id={id} role="group" aria-label={fill(m.rowActions, { name })} className={styles.rowMenuPanel}>
          <label className={styles.rowMenuField}>
            <span className={styles.fieldLabel}>{m.categoryChange}</span>
            <select
              className={styles.select}
              value={item.categoryOverridden ? item.category : ''}
              onChange={(event) => {
                onCategory(event.target.value === '' ? null : (event.target.value as Category));
                setOpen(false);
              }}
            >
              <option value="">{item.categoryOverridden ? m.categoryAuto : `${m.categoryAuto}: ${m.categories[item.category]}`}</option>
              {CATEGORIES.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {m.categories[candidate]}
                </option>
              ))}
            </select>
          </label>
          {canMark && (
            <button
              type="button"
              className={styles.markMove}
              disabled={busy}
              onClick={() => {
                onToggleInternal();
                setOpen(false);
              }}
            >
              {item.internalTransfer ? m.unmarkInternal : m.markInternal}
            </button>
          )}
          {failed && <span role="alert">{failed}</span>}
        </div>
      )}
    </span>
  );
};

/**
 * One transaction. Phone: two lines (the payee and the amount, then one line of when, which bank and account, and its marks). From 64rem it is a
 * table row: mark, payee (with the line's own text under it), time, bank and account, category and marks, amount, menu. The day is the group's
 * heading, so a row tells only the time (and none when the bank gave only a day). Money in is in the "ok" colour and a move between the owner's
 * own accounts is muted; a declined line stays in the list, muted, with its word.
 */
const TransactionRow: React.FC<{ item: FinanceTransaction; account: FinanceAccount | undefined; logo: ProviderLogo | undefined; mode: MoneyDisplay; query: string; onChanged: () => void; onCategoryChanged?: () => void }> = ({ item, account, logo, mode, query, onChanged, onCategoryChanged }) => {
  const { t, lang } = useDashboardLang();
  const m = t.money;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  // A line the owner has not marked can be marked as a move between their own accounts; the owner's own mark can be undone (a mark the server set cannot be undone from here).
  const canMark = !item.declined && (!item.internalTransfer || item.internalTransferByOwner);
  const change = async (action: () => Promise<void>, why: string, category = false) => {
    setBusy(true);
    setFailed(null);
    try {
      await action();
      onChanged();
      if (category) onCategoryChanged?.();
    } catch {
      setFailed(why);
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
      <span className={styles.txMark}>{account && <BankMark provider={account.provider} logo={logo} />}</span>
      <span className={styles.main}>
        <span className={styles.what} title={detail ? `${what}: ${detail}` : what}>
          <Highlight text={what} query={query} />
        </span>
        {detail && (
          <span className={styles.txDetail}>
            <Highlight text={detail} query={query} />
          </span>
        )}
      </span>
      <span className={styles.meta}>
        <span className={styles.txTime}>{item.timeKnown ? timeLabel(item.bookedAt, lang) : ''}</span>
        {account && (
          <span className={styles.txBank}>
            {bankLabel(account.provider, logo)} · {account.name}
          </span>
        )}
        <span className={styles.txTags}>
          <span className={styles.tag} data-category={item.category} data-overridden={item.categoryOverridden ? 'true' : undefined} title={item.categoryOverridden ? m.categoryByYou : undefined}>
            <CategoryMark category={item.category} />
            {m.categories[item.category]}
            {item.categoryOverridden && <span className="sr-only">, {m.categoryByYou}</span>}
          </span>
          {item.pending && <span className={styles.tag}>{m.pending}</span>}
          {item.declined && <span className={styles.tag}>{m.declined}</span>}
          {/* The category of a move between the owner's own accounts already says so: its word is not repeated in a second chip. */}
          {item.internalTransfer && item.category !== 'transfers' && <span className={styles.tag}>{m.internal}</span>}
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
      <RowMenu
        item={item}
        name={what}
        canMark={canMark}
        busy={busy}
        failed={failed}
        onToggleInternal={() => void change(() => setInternalTransfer(item.id, !item.internalTransfer), m.internalFailed)}
        onCategory={(category) => void change(() => setTransactionCategory(item.id, category), m.categoryFailed, true)}
      />
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
  /** A counter the page raises to ask for the lines again (a bank's data changed): the rows stay, dimmed, until the new ones are here. */
  refresh?: number;
  /** The owner's category of a line changed: the spending report is asked again. */
  onCategoriesChanged?: () => void;
}

/**
 * The transactions, newest first: the bank as chips (all banks, or one), then, inside a bank, an account choice; a text search
 * (applied after a short pause in typing) and "Load more" by the server's cursor. Each row names its bank and account.
 */
const MoneyTransactions: React.FC<MoneyTransactionsProps> = ({ banks, categories, mode, logos, enabled, refresh = 0, onCategoriesChanged }) => {
  const { t, lang } = useDashboardLang();
  const m = t.money;
  const searchMax = useLimit('transactions', 'search', 200);
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
  const list = useTransactions(account, category, query, enabled, refresh);
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
  // The category chips are the ones the spending report names and the ones seen in any rows so far: the set only grows, so a filter never makes a chip vanish.
  const seen = useRef(new Set<Category>());
  for (const item of list.transactions) seen.current.add(item.category);
  for (const candidate of categories) seen.current.add(candidate);
  if (category) seen.current.add(category);
  const chipCategories = CATEGORIES.filter((candidate) => seen.current.has(candidate));
  const inBank = bank ? new Set(bank.accounts.map((item) => item.id)) : null;
  const shown = list.transactions.filter((item) => !inBank || inBank.has(item.accountId));

  // A bank filter is applied to what is loaded, so it reads further pages on its own until enough rows show (a few pages at most).
  const { status, hasMore, loadingMore, moreFailed, loadMore, pages } = list;
  const wantMore = status === 'ready' && inBank !== null && account === null && hasMore && !loadingMore && !moreFailed && shown.length < WANTED_ROWS && pages < MAX_AUTO_PAGES;
  useEffect(() => {
    if (wantMore) loadMore();
  }, [wantMore, loadMore, pages]);

  // The filters that are on, in words (for the empty state), and the way to clear them all.
  const filtersText = [bank ? bankLabel(bank.provider, logos[bank.provider]) : '', account ? (byId.get(account)?.name ?? '') : '', category ? m.categories[category] : '', query ? `“${query}”` : ''].filter(Boolean).join(', ');
  const clearFilters = () => {
    setProvider(null);
    setAccount(null);
    setCategory(null);
    setTyped('');
    setQuery('');
  };
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
                title={bankLabel(candidate.provider, logos[candidate.provider])}
                onClick={() => chooseBank(candidate.provider)}
              >
                <BankMark provider={candidate.provider} logo={logos[candidate.provider]} />
                {bankLabel(candidate.provider, logos[candidate.provider])}
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
                    {item.maskLast4 ? `, ${t.money.endingIn} ${item.maskLast4}` : ''})
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
              maxLength={searchMax}
              placeholder={m.searchPlaceholder}
              onChange={(event) => setTyped(event.target.value)}
            />
          </div>
        </div>
      </div>
      {list.status === 'loading' && <LoadingBlock rows={4} />}
      {list.status === 'error' && <InlineError message={m.failed} onRetry={list.reload} />}
      {list.status === 'ready' && shown.length === 0 && !loadingMore && !wantMore && !list.refreshing && (
        <div className={styles.none}>
          <p role="status">{filtersText ? (list.hasMore ? fill(m.emptySoFar, { n: list.transactions.length }) : fill(m.emptyFiltered, { filters: filtersText })) : list.hasMore ? fill(m.emptySoFar, { n: list.transactions.length }) : m.empty}</p>
          {filtersText && (
            <button type="button" className={styles.markMove} onClick={clearFilters}>
              {m.clearFilters}
            </button>
          )}
        </div>
      )}
      {list.status === 'ready' && shown.length > 0 && (
        <ul className={styles.list} aria-busy={list.refreshing} data-refreshing={list.refreshing ? 'true' : undefined}>
          {shown.map((item, index) => {
            const day = localDay(item.bookedAt);
            const head = index === 0 || localDay(shown[index - 1].bookedAt) !== day;
            return (
              <React.Fragment key={item.id}>
                {head && (
                  <li role="presentation" className={styles.dayHead}>
                    <h3 className={styles.dayTitle}>{dayTitle(item.bookedAt, lang)}</h3>
                  </li>
                )}
                <TransactionRow item={item} account={byId.get(item.accountId)} logo={logos[byId.get(item.accountId)?.provider ?? '']} mode={mode} query={query} onChanged={list.reload} onCategoryChanged={onCategoriesChanged} />
              </React.Fragment>
            );
          })}
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
