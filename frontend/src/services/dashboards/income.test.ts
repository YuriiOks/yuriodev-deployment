import { describe, expect, it } from 'vitest';
import type { FinanceTransaction } from './financeApi';
import { isIncome, monthStart, summarizeIncome } from './income';

const tx = (id: string, day: string, amount: number, extra: Partial<FinanceTransaction> = {}): FinanceTransaction => ({
  id,
  accountId: 'a',
  bookedAt: new Date(`${day}T12:00:00`).toISOString(),
  amount,
  currency: 'GBP',
  originalAmount: null,
  originalCurrency: null,
  description: id,
  counterparty: null,
  pending: false,
  declined: false,
  internalTransfer: false,
  display: null,
  category: 'income',
  categoryOverridden: false,
  ...extra,
});

describe('income', () => {
  it('starts the month on its first day, in local time', () => {
    expect(monthStart(new Date(2026, 10, 24, 9, 0))).toBe('2026-11-01');
    expect(monthStart(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01');
  });

  it('counts money in from outside only: not money out, not declined, not a move between the owner\'s own accounts', () => {
    expect(isIncome(tx('a', '2026-11-20', 100))).toBe(true);
    expect(isIncome(tx('b', '2026-11-20', -100))).toBe(false);
    expect(isIncome(tx('c', '2026-11-20', 100, { declined: true }))).toBe(false);
    expect(isIncome(tx('d', '2026-11-20', 100, { internalTransfer: true }))).toBe(false);
    expect(isIncome(tx('e', '2026-11-20', 0))).toBe(false);
  });

  it('totals this month per currency (largest first) and lists the latest ten whatever the month', () => {
    const list = [
      tx('salary', '2026-11-20', 250000),
      tx('refund', '2026-11-10', 3000),
      tx('usd', '2026-11-05', 40000, { currency: 'USD' }),
      tx('move', '2026-11-04', 90000, { internalTransfer: true }),
      tx('oct', '2026-10-28', 250000),
      ...Array.from({ length: 12 }, (_, i) => tx(`old${i}`, '2026-09-01', 100)),
    ];
    const income = summarizeIncome(list, '2026-11-01');
    expect(income.totals).toEqual([{ currency: 'GBP', amount: 253000 }, { currency: 'USD', amount: 40000 }]);
    expect(income.latest.map((item) => item.id)).toEqual(['salary', 'refund', 'usd', 'oct', 'old0', 'old1', 'old2', 'old3', 'old4', 'old5']);
  });

  it('has no totals and no rows for no income', () => {
    expect(summarizeIncome([], '2026-11-01')).toEqual({ totals: [], latest: [] });
  });
});
