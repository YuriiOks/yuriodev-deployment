import { useCallback, useEffect, useRef, useState } from 'react';
import { useLogoBundle } from './useImageBundles';
import { fetchCategories, fetchFinanceAccounts, fetchFinanceSummary, fetchProvidersAnswer, fetchTransactions, type Category, type FinanceAccounts, type FinanceCategories, type FinanceSummary, type FinanceTransaction, type ProviderLogo, type ProvidersAnswer } from '../services/dashboards/financeApi';

export type LoadStatus = 'loading' | 'ready' | 'error';

interface Slot<T> {
  readonly token: number;
  readonly value: T | null;
}

/** One GET kept in state: asked on mount and on `reload`; `value` is null while loading and on an error. `reload` resolves when the new answer (or its failure) has come back. */
export function useOnce<T>(load: (signal: AbortSignal) => Promise<T>, enabled: boolean): { status: LoadStatus; value: T | null; reload: () => Promise<void> } {
  const [token, setToken] = useState(0);
  const [slot, setSlot] = useState<Slot<T> | null>(null);
  // Whoever asked for a reload waits here until an answer that was not replaced meanwhile arrives.
  const waiters = useRef<(() => void)[]>([]);
  const settle = useCallback(() => {
    const pending = waiters.current;
    waiters.current = [];
    for (const resolve of pending) resolve();
  }, []);
  // The question and the address it was last answered for: an answer held is not asked for again when the panel is shown again (a tab switch).
  const answered = useRef<{ token: number; load: typeof load } | null>(null);
  useEffect(() => {
    if (!enabled) {
      // Nothing is asked while it is not shown; a reload asked for now is answered when it is next shown, and nobody waits for it.
      settle();
      return undefined;
    }
    if (answered.current?.token === token && answered.current.load === load) {
      settle();
      return undefined;
    }
    const controller = new AbortController();
    load(controller.signal).then(
      (value) => {
        if (controller.signal.aborted) return;
        answered.current = { token, load };
        setSlot({ token, value });
        settle();
      },
      () => {
        if (controller.signal.aborted) return;
        setSlot({ token, value: null });
        settle();
      },
    );
    return () => controller.abort();
  }, [token, enabled, load, settle]);
  const current = slot && slot.token === token ? slot : null;
  return { status: current ? (current.value ? 'ready' : 'error') : 'loading', value: current?.value ?? null, reload: () => new Promise<void>((resolve) => { waiters.current.push(resolve); setToken((n) => n + 1); }) };
}

export interface Kept<T> {
  readonly status: LoadStatus;
  readonly value: T | null;
  readonly reload: () => Promise<void>;
  /** The last good answer is on screen while a new one is being asked for. */
  readonly refreshing: boolean;
  /** The last good answer is still on screen, but asking again failed: it may be out of date. */
  readonly refreshFailed: boolean;
}

/**
 * While an answer is being asked again (after a change, or for another window) the last good one stays on screen, so the cards do not
 * vanish and come back; when asking again fails it stays too, flagged `refreshFailed` so the page can say it may be out of date. Only a
 * failure with nothing to show yet is an error.
 */
export function useKeepLast<T>(slot: { readonly status: LoadStatus; readonly value: T | null; readonly reload: () => Promise<void> }): Kept<T> {
  const [kept, setKept] = useState<T | null>(null);
  if (slot.value && slot.value !== kept) setKept(slot.value);
  const value = slot.value ?? kept;
  return { status: value ? 'ready' : slot.status, value, reload: slot.reload, refreshing: value !== null && slot.status === 'loading', refreshFailed: value !== null && slot.status === 'error' };
}

const loadAccounts = (signal: AbortSignal) => fetchFinanceAccounts(signal);
const loadSummary = (signal: AbortSignal) => fetchFinanceSummary(signal);
const loadProviders = (signal: AbortSignal) => fetchProvidersAnswer(signal);
const loadCategories = (signal: AbortSignal) => fetchCategories(undefined, signal);

/** The banks' logos by provider id (GET /finance/providers), fetched once: they are big and the accounts answer does not repeat them. A failure only means the text names stay. */
export function useProviderLogos(enabled: boolean): Kept<Record<string, ProviderLogo>> {
  const slot = useKeepLast(useOnce<ProvidersAnswer>(loadProviders, enabled));
  // Every variant is drawn from the logo bundle (one request, kept by its version) when the answer names one.
  const logos = useLogoBundle(slot.value?.logos ?? null, slot.value?.logosVersion ?? null);
  return { ...slot, value: logos };
}

/** This month's spend per currency and category, with the month before beside it (GET /finance/categories). */
export const useFinanceCategories = (enabled: boolean) => useKeepLast(useOnce<FinanceCategories>(loadCategories, enabled));

/** The accounts with the state of each bank link (GET /finance/accounts). Each request has its own loading and error state. */
export const useFinanceAccounts = (enabled: boolean) => useKeepLast(useOnce<FinanceAccounts>(loadAccounts, enabled));

/** This month per currency (GET /finance/summary). */
export const useFinanceSummary = (enabled: boolean) => useKeepLast(useOnce<FinanceSummary>(loadSummary, enabled));

export interface TransactionsState {
  readonly status: LoadStatus;
  readonly transactions: readonly FinanceTransaction[];
  readonly hasMore: boolean;
  /** A new filter or a refresh is being asked for while the rows of the last answer are still shown. */
  readonly refreshing: boolean;
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
 * The transactions of one account or all, filtered by a text, newest first: the first page when the filter changes, the next page appended by
 * `loadMore` with the server's cursor. While a new filter (or a refresh) is on its way the last rows stay (`refreshing`: the page dims them);
 * the loading state is only for the very first load. `refresh` is a counter the page raises to ask again (after a bank's data changed).
 */
export function useTransactions(account: string | null, category: Category | null, q: string, enabled: boolean, refresh = 0): TransactionsState {
  const [token, setToken] = useState(0);
  const key = `${account ?? ''}|${category ?? ''}|${q}|${token}|${refresh}`;
  const [pages, setPages] = useState<Pages | null>(null);
  const [more, setMore] = useState<{ key: string; busy: boolean; failed: boolean }>({ key: '', busy: false, failed: false });
  // The request for the next page: dropped when the filter changes, so a late answer never lands on another filter's list.
  const moreRequest = useRef<AbortController | null>(null);

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
    return () => {
      controller.abort();
      moreRequest.current?.abort();
      moreRequest.current = null;
    };
  }, [account, category, q, key, enabled]);

  // The rows of the last answer stay on screen while the next is asked for (a failed answer has none to keep).
  const current = pages;
  const fresh = pages !== null && pages.key === key;
  const loadMore = useCallback(() => {
    if (!current || !fresh || !current.cursor || more.busy) return;
    const cursor = current.cursor;
    const controller = new AbortController();
    moreRequest.current = controller;
    setMore({ key, busy: true, failed: false });
    fetchTransactions({ account, category, q, cursor }, controller.signal).then(
      (page) => {
        if (controller.signal.aborted) return;
        setPages((previous) => (previous && previous.key === key ? { key, ok: true, items: [...previous.items, ...page.transactions], cursor: page.nextCursor, pages: previous.pages + 1 } : previous));
        setMore({ key, busy: false, failed: false });
      },
      () => {
        if (!controller.signal.aborted) setMore({ key, busy: false, failed: true });
      },
    );
  }, [account, category, q, key, current, fresh, more.busy]);

  const mine = more.key === key;
  return {
    status: current ? (current.ok ? 'ready' : 'error') : 'loading',
    transactions: current?.items ?? [],
    hasMore: fresh && current?.cursor != null,
    refreshing: !fresh && enabled && current !== null,
    loadingMore: mine && more.busy,
    moreFailed: mine && more.failed,
    pages: fresh ? (current?.pages ?? 0) : 0,
    reload: () => setToken((n) => n + 1),
    loadMore,
  };
}
