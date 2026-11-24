import type { Converted } from '../../../services/dashboards/financeApi';
import type { MoneyDisplay } from '../../../services/dashboards/preferences';
import type { Evidence, Recurring, UpcomingItem } from '../../../services/dashboards/recurringApi';

/**
 * How much of a payment the page can stand behind: `confirmed` (the bank's own lines matched at least one of its last due dates),
 * `none_seen` (its paying account is collected and nothing matched) or `unchecked` (no account of ours pays it: it is only the owner's list).
 */
export type Truth = 'confirmed' | 'none_seen' | 'unchecked';

export const TRUTHS: readonly Truth[] = ['confirmed', 'none_seen', 'unchecked'];

export function truthOf(evidence: Evidence | null): Truth {
  if (!evidence) return 'unchecked';
  if (evidence.matchedOfLast > 0) return 'confirmed';
  // Nothing was due yet to look for: nothing is checked either.
  return evidence.checked > 0 ? 'none_seen' : 'unchecked';
}

/** A plan that its own schedule has finished: the page keeps it out of what is due and what is owed, and lists it apart. */
export const endedBySchedule = (row: Pick<Recurring, 'scheduleState'>): boolean => row.scheduleState === 'ended_by_schedule';

export interface Sum {
  readonly currency: string;
  readonly amount: number;
  readonly approx: boolean;
}

/** An amount in the figure the page shows: the converted one (marked approximate) in pounds mode when the server converted it, else the original. */
function shown(amount: number, code: string, display: Converted | null, mode: MoneyDisplay): { amount: number; currency: string; approx: boolean } {
  return mode === 'base' && display && display.currency !== code ? { amount: display.amount, currency: display.currency, approx: true } : { amount, currency: code, approx: false };
}

/** The payments due, added up by how far they are verified (per currency, in pounds where the server converted). */
export function splitDue(items: readonly UpcomingItem[], truthOfPayment: (recurringId: string) => Truth, mode: MoneyDisplay): Record<Truth, Sum[]> {
  const sums: Record<Truth, Map<string, Sum>> = { confirmed: new Map(), none_seen: new Map(), unchecked: new Map() };
  for (const item of items) {
    const figure = shown(item.amount, item.currency, item.display, mode);
    const bucket = sums[truthOfPayment(item.recurringId)];
    const before = bucket.get(figure.currency);
    bucket.set(figure.currency, { currency: figure.currency, amount: (before?.amount ?? 0) + figure.amount, approx: (before?.approx ?? false) || figure.approx });
  }
  return { confirmed: [...sums.confirmed.values()], none_seen: [...sums.none_seen.values()], unchecked: [...sums.unchecked.values()] };
}
