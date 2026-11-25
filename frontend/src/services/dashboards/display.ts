import type { Converted, FinanceAccount, FinanceSummary } from './financeApi';
import type { MoneyDisplay } from './preferences';
import { isPot, type Bank } from './wallet';

/** One figure on screen: an amount in a currency; `approx` when it was converted (shown with "≈"), with the originals it stands for. */
export interface Shown {
  readonly amount: number;
  readonly currency: string;
  readonly approx: boolean;
  /** The original amounts behind a converted figure (the currencies that were converted), for the small text beside it. */
  readonly originals: ReadonlyArray<{ readonly amount: number; readonly currency: string }>;
  /** The part of it that sits in pots, in the same currency. */
  readonly pots: number;
  /** The pots part is itself approximate: a pot in another currency was converted into it (the rest may be plain). */
  readonly potsApprox: boolean;
}

/** An open account the server really converted (it is in another currency than the display one) and has a display figure for. */
const isConverted = (account: FinanceAccount): boolean => !account.archived && account.converted && account.display !== null;

/** True when something on the page was really converted (the display toggle is only offered then: an all-pounds owner has nothing to switch). */
export function hasConversion(accounts: readonly FinanceAccount[]): boolean {
  return accounts.some(isConverted);
}

/**
 * The owner's own money as the page shows it. In `native` mode, one figure per currency. In `base` mode, every account the server
 * converted is summed in the display currency (one figure, marked approximate when any of them was in another currency), and the
 * accounts it has no rate for stay in their own currency, one figure each: a currency with no rate is never guessed.
 */
export function shownTotals(accounts: readonly FinanceAccount[], mode: MoneyDisplay): Shown[] {
  const open = accounts.filter((account) => !account.archived);
  const natives = new Map<string, { amount: number; pots: number }>();
  const converted = new Map<string, { amount: number; pots: number; approx: boolean; potsApprox: boolean; originals: Map<string, number> }>();
  for (const account of open) {
    const useDisplay = mode === 'base' && account.display !== null;
    const target = useDisplay ? (account.display as Converted) : { amount: account.ownBalance, currency: account.currency };
    const pots = isPot(account) ? target.amount : 0;
    if (useDisplay) {
      const entry = converted.get(target.currency) ?? { amount: 0, pots: 0, approx: false, potsApprox: false, originals: new Map<string, number>() };
      entry.amount += target.amount;
      entry.pots += pots;
      if (account.currency !== target.currency) {
        entry.approx = true;
        if (pots !== 0) entry.potsApprox = true;
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
    potsApprox: entry.potsApprox,
  }));
  // A currency the server did convert into is one figure with its converted parts; an unconverted account of that same currency joins it.
  const rest: Shown[] = [];
  for (const [currency, entry] of natives) {
    const into = fromConverted.find((shown) => shown.currency === currency);
    if (into) {
      const index = fromConverted.indexOf(into);
      fromConverted[index] = { ...into, amount: into.amount + entry.amount, pots: into.pots + entry.pots };
    } else {
      rest.push({ amount: entry.amount, currency, approx: false, originals: [], pots: entry.pots, potsApprox: false });
    }
  }
  // The display currency first (the converted accounts are one figure in it), then the currencies that could not be converted, in the order they came.
  return [...fromConverted, ...rest];
}

/**
 * The banks in the order the stack shows them: a link that needs approving again first, then by the size of the bank's money (the absolute
 * converted figure, so a debt counts as much as a balance), and a bank with nothing in it last. The order is the same on every render, so
 * choosing a bank never moves the cards.
 */
export function sortBanks(banks: readonly Bank[]): Bank[] {
  const rank = (bank: Bank) => {
    const open = bank.accounts.filter((account) => !account.archived);
    const empty = open.every((account) => account.balance === 0 && account.ownBalance === 0);
    // The size is told in the display currency (what the server converted); an account it could not convert has no size to compare.
    const size = open.reduce((sum, account) => sum + (account.display?.amount ?? 0), 0);
    return [bank.connection?.status === 'needs_reconsent' ? 0 : 1, empty ? 1 : 0, -Math.abs(size)] as const;
  };
  return banks
    .map((bank, index) => ({ bank, index, key: rank(bank) }))
    .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2] || a.index - b.index)
    .map(({ bank }) => bank);
}

/** The grand total in the display currency: the server's when it sends one, else the converted accounts' sum; null when nothing was converted. */
export function grandTotal(accounts: readonly FinanceAccount[], summary: FinanceSummary | null): { amount: number; currency: string; approx: boolean } | null {
  if (summary?.total) return { ...summary.total, approx: accounts.some(isConverted) };
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
