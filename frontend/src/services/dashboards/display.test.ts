import { describe, expect, it } from 'vitest';
import { grandTotal, hasConversion, shownTotals, unconvertedCurrencies } from './display';
import type { FinanceAccount, FinanceSummary } from './financeApi';

const acct = (id: string, currency: string, own: number, display: FinanceAccount['display'], extra: Partial<FinanceAccount> = {}): FinanceAccount => ({
  id,
  connectionId: 'c',
  provider: 'p',
  name: id,
  type: 'current',
  currency,
  maskLast4: null,
  balance: own,
  creditLimit: 0,
  ownBalance: own,
  balanceAt: null,
  historyFrom: null,
  archived: false,
  kind: 'current',
  label: null,
  parentId: null,
  goalAmount: null,
  overdraftLimit: null,
  availableMinor: own,
  display,
  ...extra,
});

const gbp = (amount: number) => ({ amount, currency: 'GBP' });
const summary = (total: FinanceSummary['total']): FinanceSummary => ({ month: '2026-11', asOf: null, currencies: [], total, rateAsOf: null });

describe('display', () => {
  const accounts = [
    acct('uk', 'GBP', 10000, gbp(10000)),
    acct('pot', 'GBP', 5000, gbp(5000), { type: 'pot', kind: 'pot' }),
    acct('ua', 'UAH', 650000, gbp(12500)),
    acct('us', 'USD', 21000, gbp(16800)),
    acct('jp', 'JPY', 99900, null),
    acct('old', 'GBP', 99999, gbp(99999), { archived: true }),
  ];

  it('offers the display choice only when the server converted something', () => {
    expect(hasConversion(accounts, null)).toBe(true);
    expect(hasConversion([acct('a', 'GBP', 1, null)], null)).toBe(false);
    expect(hasConversion([acct('a', 'GBP', 1, null)], summary({ amount: 5, currency: 'GBP' }))).toBe(true);
  });

  it('in pounds: sums the converted accounts into one approximate figure with the originals behind it, and leaves a currency with no rate as it is', () => {
    const shown = shownTotals(accounts, 'base');
    expect(shown).toEqual([
      { amount: 44300, currency: 'GBP', approx: true, originals: [{ amount: 650000, currency: 'UAH' }, { amount: 21000, currency: 'USD' }], pots: 5000 },
      { amount: 99900, currency: 'JPY', approx: false, originals: [], pots: 0 },
    ]);
    expect(unconvertedCurrencies(accounts)).toEqual(['JPY']);
  });

  it('in the account currency: one figure per currency, no conversion', () => {
    expect(shownTotals(accounts, 'native').map((shown) => [shown.currency, shown.amount, shown.approx, shown.pots])).toEqual([
      ['GBP', 15000, false, 5000],
      ['UAH', 650000, false, 0],
      ['USD', 21000, false, 0],
      ['JPY', 99900, false, 0],
    ]);
  });

  it('is exact, not approximate, when every converted account is already in the display currency', () => {
    expect(shownTotals([acct('a', 'GBP', 100, gbp(100))], 'base')).toEqual([{ amount: 100, currency: 'GBP', approx: false, originals: [], pots: 0 }]);
  });

  it('gives the grand total from the server when it has one, else from the converted accounts, else none', () => {
    expect(grandTotal(accounts, summary({ amount: 123456, currency: 'GBP' }))).toEqual({ amount: 123456, currency: 'GBP', approx: true });
    expect(grandTotal(accounts, null)).toEqual({ amount: 44300, currency: 'GBP', approx: true });
    expect(grandTotal([acct('a', 'GBP', 1, null)], null)).toBeNull();
  });
});
