import type { Converted, FinanceAccount, FinanceSummary } from './financeApi';
import type { MoneyDisplay } from './preferences';
import { isPot } from './wallet';

/** One figure on screen: an amount in a currency; `approx` when it was converted (shown with "≈"), with the originals it stands for. */
export interface Shown {
  readonly amount: number;
  readonly currency: string;
  readonly approx: boolean;
  /** The original amounts behind a converted figure (the currencies that were converted), for the small text beside it. */
  readonly originals: ReadonlyArray<{ readonly amount: number; readonly currency: string }>;
  /** The part of it that sits in pots, in the same currency. */
  readonly pots: number;
}

/** True when the server sent any converted figure at all (the display toggle is only offered then). */
export function hasConversion(accounts: readonly FinanceAccount[], summary: FinanceSummary | null): boolean {
  return accounts.some((account) => account.display !== null) || summary?.total != null;
}

/**
 * The owner's own money as the page shows it. In `native` mode, one figure per currency. In `base` mode, every account the server
 * converted is summed in the display currency (one figure, marked approximate when any of them was in another currency), and the
 * accounts it has no rate for stay in their own currency, one figure each: a currency with no rate is never guessed.
 */
export function shownTotals(accounts: readonly FinanceAccount[], mode: MoneyDisplay): Shown[] {
  const open = accounts.filter((account) => !account.archived);
  const natives = new Map<string, { amount: number; pots: number }>();
  const converted = new Map<string, { amount: number; pots: number; approx: boolean; originals: Map<string, number> }>();
  for (const account of open) {
    const useDisplay = mode === 'base' && account.display !== null;
    const target = useDisplay ? (account.display as Converted) : { amount: account.ownBalance, currency: account.currency };
    const pots = isPot(account) ? target.amount : 0;
    if (useDisplay) {
      const entry = converted.get(target.currency) ?? { amount: 0, pots: 0, approx: false, originals: new Map<string, number>() };
      entry.amount += target.amount;
      entry.pots += pots;
      if (account.currency !== target.currency) {
        entry.approx = true;
        entry.originals.set(account.currency, (entry.originals.get(account.currency) ?? 0) + account.ownBalance);
      }
      converted.set(target.currency, entry);
    } else {
      const entry = natives.get(target.currency) ?? { amount: 0, pots: 0 };
      entry.amount += target.amount;
      entry.pots += pots;
      natives.set(target.currency, entry);
    }
  }
  const fromConverted: Shown[] = [...converted.entries()].map(([currency, entry]) => ({
    amount: entry.amount,
    currency,
    approx: entry.approx,
    originals: [...entry.originals.entries()].map(([code, amount]) => ({ amount, currency: code })),
    pots: entry.pots,
  }));
  // A currency the server did convert into is one figure with its converted parts; an unconverted account of that same currency joins it.
  const rest: Shown[] = [];
  for (const [currency, entry] of natives) {
    const into = fromConverted.find((shown) => shown.currency === currency);
    if (into) {
      const index = fromConverted.indexOf(into);
      fromConverted[index] = { ...into, amount: into.amount + entry.amount, pots: into.pots + entry.pots };
    } else {
      rest.push({ amount: entry.amount, currency, approx: false, originals: [], pots: entry.pots });
    }
  }
  return [...fromConverted, ...rest];
}

/** The grand total in the display currency: the server's when it sends one, else the converted accounts' sum; null when nothing was converted. */
export function grandTotal(accounts: readonly FinanceAccount[], summary: FinanceSummary | null): { amount: number; currency: string; approx: boolean } | null {
  if (summary?.total) return { ...summary.total, approx: accounts.some((account) => account.converted) || accounts.length === 0 };
  const converted = shownTotals(accounts, 'base').filter((shown) => shown.approx || accounts.some((account) => account.display?.currency === shown.currency));
  const first = converted[0];
  return first ? { amount: first.amount, currency: first.currency, approx: first.approx } : null;
}

/** The currencies that have no converted figure and so stay as they are in `base` mode (named in a small note under the total). */
export function unconvertedCurrencies(accounts: readonly FinanceAccount[]): string[] {
  const codes = new Set<string>();
  const display = accounts.find((account) => account.display !== null)?.display?.currency;
  for (const account of accounts) if (!account.archived && account.display === null && account.currency !== display) codes.add(account.currency);
  return [...codes];
}
