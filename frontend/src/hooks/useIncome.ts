import { useEffect, useState } from 'react';
import { fetchTransactions, type FinanceTransaction } from '../services/dashboards/financeApi';
import { monthStart, summarizeIncome, type Income } from '../services/dashboards/income';

export interface IncomeState {
  readonly status: 'loading' | 'ready' | 'error';
  readonly income: Income | null;
  readonly reload: () => void;
}

/** How many pages of income to read at most (a hundred each): this month's salary and the last ten fit in the first. */
const MAX_PAGES = 3;

/**
 * Income from the server's own sorting (GET /finance/transactions?category=income from the first of the month): this month's total
 * per currency and the last ten incoming transactions. Asks again on `reload`.
 */
export function useIncome(enabled: boolean): IncomeState {
  const [token, setToken] = useState(0);
  const [slot, setSlot] = useState<{ token: number; income: Income | null } | null>(null);
  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    const start = monthStart(new Date());
    (async () => {
      const all: FinanceTransaction[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const result = await fetchTransactions({ category: 'income', from: start, cursor, limit: 100 }, controller.signal);
        all.push(...result.transactions);
        cursor = result.nextCursor;
        if (cursor === null) break;
      }
      return summarizeIncome(all, start);
    })().then(
      (income) => {
        if (!controller.signal.aborted) setSlot({ token, income });
      },
      () => {
        if (!controller.signal.aborted) setSlot({ token, income: null });
      },
    );
    return () => controller.abort();
  }, [token, enabled]);
  const current = slot && slot.token === token ? slot : null;
  return { status: current ? (current.income ? 'ready' : 'error') : 'loading', income: current?.income ?? null, reload: () => setToken((n) => n + 1) };
}
