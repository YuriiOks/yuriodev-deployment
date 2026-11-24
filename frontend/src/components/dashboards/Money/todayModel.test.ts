import { describe, expect, it } from 'vitest';
import type { CategorySpend, FinanceCategories } from '../../../services/dashboards/financeApi';
import type { UpcomingItem } from '../../../services/dashboards/recurringApi';
import { biggestRise, nextPayment, partOfDay, spendView, topCategories } from './todayModel';

const line = (category: CategorySpend['category'], spent: number, previous: number, previousToDate: number | null): CategorySpend => ({ category, spent, previous, previousToDate });

const data = (extra: Partial<FinanceCategories> = {}): FinanceCategories => ({
  month: '2026-11',
  previousMonth: '2026-10',
  previousToDateDay: '2026-10-24',
  currencies: [
    { currency: 'GBP', spent: 1000, previousSpent: 900, previousToDateSpent: 700, converted: false, categories: [line('groceries', 600, 500, 400), line('eating_out', 400, 400, 300)] },
    { currency: 'EUR', spent: 50, previousSpent: 0, previousToDateSpent: 0, converted: true, categories: [line('transport', 50, 0, 0)] },
  ],
  display: { currency: 'GBP', complete: true, spent: 1050, previousSpent: 900, previousToDateSpent: 700, categories: [line('groceries', 600, 500, 400), line('transport', 50, 0, 0), line('eating_out', 400, 400, 300)], missing: [], rateAsOf: null },
  ...extra,
});

describe('the Today figures of Money', () => {
  it('takes the merged pounds figure in pounds mode and the biggest currency otherwise, with the same-day comparison only for the current month', () => {
    expect(spendView(data(), 'base')).toMatchObject({ currency: 'GBP', spent: 1050, previousToDate: 700, approx: true });
    expect(spendView(data(), 'native')).toMatchObject({ currency: 'GBP', spent: 1000, previousToDate: 700, approx: false });
    expect(spendView(data({ previousToDateDay: null }), 'native')?.previousToDate).toBeNull();
    expect(spendView(data({ currencies: [], display: null }), 'native')).toBeNull();
  });

  it('lists the largest categories first and finds the one that rose most against the same day last month', () => {
    const lines = [line('eating_out', 400, 400, 300), line('groceries', 600, 500, 400), line('transport', 50, 0, 0), line('shopping', 0, 80, 10)];
    expect(topCategories(lines, 2).map((row) => row.category)).toEqual(['groceries', 'eating_out']);
    expect(biggestRise(lines)?.category.category).toBe('groceries');
    expect(biggestRise([line('groceries', 100, 200, 150)])).toBeNull();
    expect(biggestRise([line('groceries', 100, 200, null)])).toBeNull();
  });

  it('finds the next payment still ahead (never an overdue one), and the part of the day', () => {
    const item = (id: string, daysUntil: number, overdue = false) => ({ recurringId: id, daysUntil, overdue }) as UpcomingItem;
    expect(nextPayment([item('a', -3, true), item('c', 5), item('b', 2)])).toMatchObject({ days: 2 });
    expect(nextPayment([item('a', -3, true)])).toBeNull();
    expect([partOfDay(6), partOfDay(12), partOfDay(18), partOfDay(23)]).toEqual(['morning', 'afternoon', 'evening', 'evening']);
  });
});
