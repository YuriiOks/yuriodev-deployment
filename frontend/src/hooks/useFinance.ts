import { useCallback, useEffect, useState } from 'react';
import { fetchCategories, fetchFinanceAccounts, fetchFinanceSummary, fetchProviders, fetchTransactions, type Category, type FinanceAccounts, type FinanceCategories, type FinanceSummary, type FinanceTransaction, type ProviderLogo } from '../services/dashboards/financeApi';

export type LoadStatus = 'loading' | 'ready' | 'error';

interface Slot<T> {
  readonly token: number;
  readonly value: T | null;
}

/** One GET kept in state: asked on mount and on `reload`; `value` is null while loading and on an error. */
function useOnce<T>(load: (signal: AbortSignal) => Promise<T>, enabled: boolean): { status: LoadStatus; value: T | null; reload: () => void } {
  const [token, setToken] = useState(0);
  const [slot, setSlot] = useState<Slot<T> | null>(null);
  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    load(controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setSlot({ token, value });
      },
      () => {
        if (!controller.signal.aborted) setSlot({ token, value: null });
      },
    );
    return () => controller.abort();
  }, [token, enabled, load]);
  const current = slot && slot.token === token ? slot : null;
  return { status: current ? (current.value ? 'ready' : 'error') : 'loading', value: current?.value ?? null, reload: () => setToken((n) => n + 1) };
}

const loadAccounts = (signal: AbortSignal) => fetchFinanceAccounts(signal);
const loadSummary = (signal: AbortSignal) => fetchFinanceSummary(signal);
const loadProviders = (signal: AbortSignal) => fetchProviders(signal);
const loadCategories = (signal: AbortSignal) => fetchCategories(undefined, signal);

/** The banks' logos by provider id (GET /finance/providers), fetched once: they are big and the accounts answer does not repeat them. A failure only means the text names stay. */
export const useProviderLogos = (enabled: boolean) => useOnce<Record<string, ProviderLogo>>(loadProviders, enabled);

/** This month's spend per currency and category, with the month before beside it (GET /finance/categories). */
export const useFinanceCategories = (enabled: boolean) => useOnce<FinanceCategories>(loadCategories, enabled);

/** The accounts with the state of each bank link (GET /finance/accounts). Each request has its own loading and error state. */
export const useFinanceAccounts = (enabled: boolean) => useOnce<FinanceAccounts>(loadAccounts, enabled);

/** This month per currency (GET /finance/summary). */
export const useFinanceSummary = (enabled: boolean) => useOnce<FinanceSummary>(loadSummary, enabled);

export interface TransactionsState {
  readonly status: LoadStatus;
  readonly transactions: readonly FinanceTransaction[];
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  /** The last "load more" failed (the list stays as it was). */
  readonly moreFailed: boolean;
  /** How many pages have been read (the first is 1). */
  readonly pages: number;
  readonly reload: () => void;
  readonly loadMore: () => void;
}

interface Pages {
  readonly key: string;
  readonly ok: boolean;
  readonly items: readonly FinanceTransaction[];
  readonly cursor: string | null;
  readonly pages: number;
}

/**
 * The transactions of one account or all, filtered by a text, newest first: the first page when the filter changes (the list
 * of the previous filter is not shown for the new one), the next page appended by `loadMore` with the server's cursor.
 */
export function useTransactions(account: string | null, category: Category | null, q: string, enabled: boolean): TransactionsState {
  const [token, setToken] = useState(0);
  const key = `${account ?? ''}|${category ?? ''}|${q}|${token}`;
  const [pages, setPages] = useState<Pages | null>(null);
  const [more, setMore] = useState<{ key: string; busy: boolean; failed: boolean }>({ key: '', busy: false, failed: false });

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    fetchTransactions({ account, category, q }, controller.signal).then(
      (page) => {
        if (!controller.signal.aborted) setPages({ key, ok: true, items: page.transactions, cursor: page.nextCursor, pages: 1 });
      },
      () => {
        if (!controller.signal.aborted) setPages({ key, ok: false, items: [], cursor: null, pages: 0 });
      },
    );
    return () => controller.abort();
  }, [account, category, q, key, enabled]);

  const current = pages && pages.key === key ? pages : null;
  const loadMore = useCallback(() => {
    if (!current || !current.cursor || more.busy) return;
    const cursor = current.cursor;
    setMore({ key, busy: true, failed: false });
    fetchTransactions({ account, category, q, cursor }).then(
      (page) => {
        setPages((previous) => (previous && previous.key === key ? { key, ok: true, items: [...previous.items, ...page.transactions], cursor: page.nextCursor, pages: previous.pages + 1 } : previous));
        setMore({ key, busy: false, failed: false });
      },
      () => setMore({ key, busy: false, failed: true }),
    );
  }, [account, category, q, key, current, more.busy]);

  const mine = more.key === key;
  return {
    status: current ? (current.ok ? 'ready' : 'error') : 'loading',
    transactions: current?.items ?? [],
    hasMore: current?.cursor != null,
    loadingMore: mine && more.busy,
    moreFailed: mine && more.failed,
    pages: current?.pages ?? 0,
    reload: () => setToken((n) => n + 1),
    loadMore,
  };
}
