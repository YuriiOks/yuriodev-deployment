import { describe, expect, it } from 'vitest';
import { grandTotal, hasConversion, shownTotals, sortBanks, unconvertedCurrencies } from './display';
import type { Bank } from './wallet';
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
  overdraftSource: null,
  overdraftBank: null,
  availableMinor: own,
  display,
  converted: display !== null && display.currency !== currency,
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
    expect(hasConversion(accounts)).toBe(true);
    expect(hasConversion([acct('a', 'GBP', 1, null)])).toBe(false);
    // An all-pounds owner: the server sends a display figure for every account, but nothing was converted, so there is nothing to switch.
    expect(hasConversion([acct('a', 'GBP', 1, gbp(1))])).toBe(false);
    // A converted account that is archived does not count.
    expect(hasConversion([acct('a', 'GBP', 1, gbp(1)), acct('b', 'USD', 5, gbp(4), { archived: true })])).toBe(false);
  });

  it('in pounds: sums the converted accounts into one approximate figure with the originals behind it, and leaves a currency with no rate as it is', () => {
    const shown = shownTotals(accounts, 'base');
    expect(shown).toEqual([
      { amount: 44300, currency: 'GBP', approx: true, originals: [{ amount: 650000, currency: 'UAH' }, { amount: 21000, currency: 'USD' }], pots: 5000, potsApprox: false },
      { amount: 99900, currency: 'JPY', approx: false, originals: [], pots: 0, potsApprox: false },
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
    expect(shownTotals([acct('a', 'GBP', 100, gbp(100))], 'base')).toEqual([{ amount: 100, currency: 'GBP', approx: false, originals: [], pots: 0, potsApprox: false }]);
  });

  it('gives the grand total from the server when it has one, else from the converted accounts, else none', () => {
    expect(grandTotal(accounts, summary({ amount: 123456, currency: 'GBP' }))).toEqual({ amount: 123456, currency: 'GBP', approx: true });
    expect(grandTotal(accounts, null)).toEqual({ amount: 44300, currency: 'GBP', approx: true });
    expect(grandTotal([acct('a', 'GBP', 1, null)], null)).toBeNull();
    // The server's total is marked approximate only when an open account was really converted (none at all: not approximate).
    expect(grandTotal([acct('a', 'GBP', 1, gbp(1))], summary({ amount: 5, currency: 'GBP' }))).toEqual({ amount: 5, currency: 'GBP', approx: false });
    expect(grandTotal([], summary({ amount: 0, currency: 'GBP' }))).toEqual({ amount: 0, currency: 'GBP', approx: false });
  });

  it('tells the pots part as approximate only when a pot itself was converted', () => {
    const mixed = [acct('ua-pot', 'UAH', 650000, gbp(12500), { type: 'pot', kind: 'pot' }), acct('main', 'GBP', 1000, gbp(1000))];
    expect(shownTotals(mixed, 'base')[0]).toMatchObject({ approx: true, pots: 12500, potsApprox: true });
    const plain = [acct('pot', 'GBP', 5000, gbp(5000), { type: 'pot', kind: 'pot' }), acct('ua', 'UAH', 650000, gbp(12500))];
    expect(shownTotals(plain, 'base')[0]).toMatchObject({ approx: true, pots: 5000, potsApprox: false });
  });

  it('puts the banks in a fixed order: a link that needs approving first, then by the size of the money (a debt counts as much as a balance), a bank with nothing last', () => {
    const gbp = (amount: number) => ({ amount, currency: 'GBP' });
    const bank = (provider: string, accounts: FinanceAccount[], status = 'ok'): Bank => ({ provider, accounts, connection: { status } as Bank['connection'] });
    const small = bank('small', [acct('s', 'GBP', 1000, gbp(1000))]);
    const big = bank('big', [acct('b', 'GBP', 90000, gbp(90000))]);
    const debt = bank('debt', [acct('d', 'GBP', -200000, gbp(-200000))]);
    const nothing = bank('nothing', [acct('n', 'GBP', 0, gbp(0))]);
    const broken = bank('broken', [acct('x', 'GBP', 5, gbp(5))], 'needs_reconsent');
    expect(sortBanks([nothing, small, big, debt, broken]).map((entry) => entry.provider)).toEqual(['broken', 'debt', 'big', 'small', 'nothing']);
    // The same input in another order gives the same stack.
    expect(sortBanks([broken, debt, small, nothing, big]).map((entry) => entry.provider)).toEqual(['broken', 'debt', 'big', 'small', 'nothing']);
  });
});
