import type { CategorySpend, FinanceCategories } from '../../../services/dashboards/financeApi';
import type { MoneyDisplay } from '../../../services/dashboards/preferences';
import type { UpcomingItem } from '../../../services/dashboards/recurringApi';

/** What the Today view says about this month's spending: one currency (the pounds figure in pounds mode, else the biggest currency), the month so far against the month before up to the same day. */
export interface SpendView {
  readonly currency: string;
  readonly spent: number;
  /** The month before up to the same day (null for an older server, or a month that is over). */
  readonly previousToDate: number | null;
  /** That day, as a date. */
  readonly previousDay: string | null;
  /** True when the figure is a conversion. */
  readonly approx: boolean;
  readonly categories: readonly CategorySpend[];
}

export function spendView(data: FinanceCategories, mode: MoneyDisplay): SpendView | null {
  const merged = mode === 'base' ? data.display : null;
  if (merged && merged.spent > 0) {
    return { currency: merged.currency, spent: merged.spent, previousToDate: data.previousToDateDay ? merged.previousToDateSpent : null, previousDay: data.previousToDateDay, approx: data.currencies.some((block) => block.converted), categories: merged.categories };
  }
  const block = [...data.currencies].filter((candidate) => candidate.spent > 0).sort((a, b) => b.spent - a.spent)[0];
  if (!block) return null;
  return { currency: block.currency, spent: block.spent, previousToDate: data.previousToDateDay ? block.previousToDateSpent : null, previousDay: data.previousToDateDay, approx: false, categories: block.categories };
}

/** The largest categories this month, biggest first (nothing with no spending). */
export function topCategories(categories: readonly CategorySpend[], count = 4): CategorySpend[] {
  return categories.filter((row) => row.spent > 0).sort((a, b) => b.spent - a.spent).slice(0, count);
}

export interface Rise {
  readonly category: CategorySpend;
  /** How much more than by the same day last month, in minor units. */
  readonly rise: number;
}

/** The category that grew most against the same day of the month before (a like-for-like rise); null when none grew or there is nothing to compare with. */
export function biggestRise(categories: readonly CategorySpend[]): Rise | null {
  let best: Rise | null = null;
  for (const row of categories) {
    if (row.previousToDate === null) continue;
    const rise = row.spent - row.previousToDate;
    if (rise > 0 && (best === null || rise > best.rise)) best = { category: row, rise };
  }
  return best;
}

/** The next payment that is still ahead (not an overdue one), and how many days away; null when none. */
export function nextPayment(items: readonly UpcomingItem[]): { item: UpcomingItem; days: number } | null {
  const ahead = items.filter((item) => !item.overdue && item.daysUntil >= 0).sort((a, b) => a.daysUntil - b.daysUntil)[0];
  return ahead ? { item: ahead, days: ahead.daysUntil } : null;
}

/** The part of the day: morning until noon, afternoon until six, then evening. */
export function partOfDay(hour: number): 'morning' | 'afternoon' | 'evening' {
  return hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
}
