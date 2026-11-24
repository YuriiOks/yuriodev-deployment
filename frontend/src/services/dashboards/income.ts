import type { FinanceTransaction } from './financeApi';
import { localDate } from './liveTime';

/** The first day of `now`'s month, "YYYY-MM-DD" (local). */
export function monthStart(now: Date): string {
  return `${localDate(now).slice(0, 7)}-01`;
}

/** What counts as income: money in that moved from outside (not declined, not a transfer between the owner's own accounts). */
export const isIncome = (item: FinanceTransaction): boolean => item.amount > 0 && !item.declined && !item.internalTransfer;

export interface Income {
  /** This month's income per currency (minor units), largest first. */
  readonly totals: ReadonlyArray<{ readonly currency: string; readonly amount: number }>;
  /** The latest incoming transactions, newest first. */
  readonly latest: readonly FinanceTransaction[];
}

/**
 * Income from the transactions the server called income (newest first): the totals of this month per currency, and the last `count`
 * incoming ones whatever the month. A pending payment counts when it shows (it is on its way in).
 */
export function summarizeIncome(transactions: readonly FinanceTransaction[], start: string, count = 10): Income {
  const incoming = transactions.filter(isIncome);
  const sums = new Map<string, number>();
  for (const item of incoming) {
    if (localDate(new Date(item.bookedAt)) < start) continue;
    sums.set(item.currency, (sums.get(item.currency) ?? 0) + item.amount);
  }
  return { totals: [...sums.entries()].map(([currency, amount]) => ({ currency, amount })).sort((a, b) => b.amount - a.amount), latest: incoming.slice(0, count) };
}
