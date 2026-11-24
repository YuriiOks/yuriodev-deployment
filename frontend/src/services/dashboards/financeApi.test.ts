import { describe, expect, it } from 'vitest';
import { parseAccounts, parseCategories, parseSummary, parseTransaction, parseTransactions, transactionsPath } from './financeApi';

const account = (extra: Record<string, unknown> = {}) => ({
  id: 'a1',
  connection_id: 'c1',
  provider: 'acme-bank',
  type: 'current',
  name: 'Everyday',
  currency: 'GBP',
  balance: 12345,
  credit_limit: 0,
  own_balance_minor: 12345,
  mask_last4: '4242',
  balance_at: '2026-11-23T10:00:00Z',
  history_from: '2026-01-01T00:00:00Z',
  archived: false,
  ...extra,
});

describe('finance parsers', () => {
  it('read an account with its balance in minor units, and drop one with no usable id, name, currency or balance', () => {
    const parsed = parseAccounts({ accounts: [account(), account({ id: '' }), account({ currency: 'pounds' }), account({ balance: 1.5 }), { nope: 1 }], connections: [] });
    expect(parsed?.accounts).toHaveLength(1);
    expect(parsed?.accounts[0]).toMatchObject({ id: 'a1', provider: 'acme-bank', currency: 'GBP', balance: 12345, ownBalance: 12345, maskLast4: '4242', archived: false, type: 'current' });
  });

  it('derives the own balance when the server leaves it out, and keeps a credit limit', () => {
    const parsed = parseAccounts({ accounts: [account({ own_balance_minor: undefined, balance: 50000, credit_limit: 20000 })], connections: [] });
    expect(parsed?.accounts[0]).toMatchObject({ balance: 50000, creditLimit: 20000, ownBalance: 30000 });
  });

  it('read the bank links, keeping only the three known states', () => {
    const parsed = parseAccounts({
      accounts: [],
      connections: [
        { provider: 'acme-bank', status: 'ok', last_ok_at: '2026-11-23T09:00:00Z' },
        { provider: 'globex-bank', status: 'needs_reconsent', last_ok_at: null },
        { provider: 'x', status: 'on fire' },
        { status: 'ok' },
      ],
    });
    expect(parsed?.connections).toEqual([
      { provider: 'acme-bank', status: 'ok', lastOkAt: '2026-11-23T09:00:00Z', logo: null },
      { provider: 'globex-bank', status: 'needs_reconsent', lastOkAt: null, logo: null },
    ]);
    expect(parseAccounts({ nope: [] })).toBeNull();
    expect(parseAccounts(null)).toBeNull();
  });

  it('read a transaction: signed minor units, the marks, the original amount only when it has a currency', () => {
    const tx = {
      id: 't1',
      account_id: 'a1',
      booked_at: '2026-11-22T12:30:00Z',
      amount: -450,
      currency: 'GBP',
      original_amount: -600,
      original_currency: 'USD',
      description: 'Coffee',
      counterparty: 'Corner Cafe',
      pending: true,
      declined: false,
      internal_transfer: true,
    };
    expect(parseTransaction(tx)).toMatchObject({ id: 't1', amount: -450, originalAmount: -600, originalCurrency: 'USD', pending: true, declined: false, internalTransfer: true, counterparty: 'Corner Cafe' });
    expect(parseTransaction({ ...tx, original_currency: null })).toMatchObject({ originalAmount: null, originalCurrency: null });
    for (const bad of [{ ...tx, amount: '5' }, { ...tx, booked_at: 'yesterday' }, { ...tx, currency: 'gbp' }, { ...tx, id: '' }, null, 7]) expect(parseTransaction(bad)).toBeNull();
  });

  it('read the converted figures and the logos when the server sends them, and drop what is not valid', () => {
    const accounts = parseAccounts({
      accounts: [account({ display_balance: 12500, display_currency: 'GBP' }), account({ id: 'b', display_balance: 1.5, display_currency: 'GBP' }), account({ id: 'c', display_balance: 5, display_currency: 'pounds' })],
      connections: [
        { provider: 'a', status: 'ok', logo: { light: 'data:image/png;base64,AAAA', dark: 'https://example.com/x.png' } },
        { provider: 'b', status: 'ok', logo: { light: 'nope', dark: 5 } },
        { provider: 'c', status: 'ok' },
      ],
    });
    expect(accounts?.accounts.map((item) => item.display)).toEqual([{ amount: 12500, currency: 'GBP' }, null, null]);
    expect(accounts?.connections.map((item) => item.logo)).toEqual([{ light: 'data:image/png;base64,AAAA', dark: null }, null, null]);
    expect(parseTransaction({ id: 't', account_id: 'a', booked_at: '2026-11-22T12:00:00Z', amount: -100, currency: 'UAH', display_amount: -2, display_currency: 'GBP' })?.display).toEqual({ amount: -2, currency: 'GBP' });
    expect(parseSummary({ currencies: [], display_total: 74350, display_currency: 'GBP', rate_as_of: '2026-11-24T08:00:00Z' })).toMatchObject({ total: { amount: 74350, currency: 'GBP' }, rateAsOf: '2026-11-24T08:00:00Z' });
    expect(parseSummary({ currencies: [] })).toMatchObject({ total: null, rateAsOf: null });
  });

  it('read the account kind, label, goal, overdraft and available money, with a safe default for an older server', () => {
    const [full, old] = parseAccounts({
      accounts: [account({ kind: 'pot', label: 'Jar', parent_id: 'p1', goal_amount: 100000, overdraft_limit: 50000, available_minor: 7 }), account({ id: 'o', type: 'pot' })],
      connections: [],
    })!.accounts;
    expect(full).toMatchObject({ kind: 'pot', label: 'Jar', parentId: 'p1', goalAmount: 100000, overdraftLimit: 50000, availableMinor: 7 });
    expect(old).toMatchObject({ kind: 'pot', label: null, parentId: null, goalAmount: null, overdraftLimit: null, availableMinor: 12345 });
    expect(parseAccounts({ accounts: [account({ kind: 'sideways' })], connections: [] })!.accounts[0].kind).toBe('current');
  });

  it('read a transaction\'s category (never missing) and the spend by category', () => {
    const tx = { id: 't', account_id: 'a', booked_at: '2026-11-22T12:00:00Z', amount: -1, currency: 'GBP', description: '' };
    expect(parseTransaction({ ...tx, category: 'groceries', category_overridden: true })).toMatchObject({ category: 'groceries', categoryOverridden: true });
    expect(parseTransaction({ ...tx, category: 'nonsense' })).toMatchObject({ category: 'other', categoryOverridden: false });
    expect(parseTransaction(tx)?.category).toBe('other');
    expect(
      parseCategories({
        month: '2026-11',
        previous_month: '2026-10',
        currencies: [{ currency: 'GBP', spent: 100, previous_spent: 80, categories: [{ category: 'groceries', spent: 60, previous: 50 }, { category: 'nonsense', spent: 1 }, { category: 'transport', spent: 'x' }] }, { currency: 'zz', spent: 1, categories: [] }],
      }),
    ).toEqual({ month: '2026-11', previousMonth: '2026-10', currencies: [{ currency: 'GBP', spent: 100, previousSpent: 80, categories: [{ category: 'groceries', spent: 60, previous: 50 }] }] });
    expect(parseCategories({})).toBeNull();
    expect(transactionsPath({ category: 'groceries' })).toBe('/finance/transactions?category=groceries&limit=25');
  });

  it('read a page of transactions with its cursor, and a summary per currency', () => {
    const page = parseTransactions({ transactions: [{ id: 't', account_id: 'a', booked_at: '2026-11-22T12:00:00Z', amount: 1, currency: 'EUR', description: '' }, { junk: 1 }], next_cursor: 'abc' });
    expect(page?.transactions).toHaveLength(1);
    expect(page?.nextCursor).toBe('abc');
    expect(parseTransactions({ transactions: [], next_cursor: null })?.nextCursor).toBeNull();
    expect(parseTransactions({})).toBeNull();
    const summary = parseSummary({ month: '2026-11', as_of: null, currencies: [{ currency: 'GBP', accounts: 2, balance: 100, own_balance: 90, spent: 10, received: 20 }, { currency: 'zz' }] });
    expect(summary?.currencies).toEqual([{ currency: 'GBP', accounts: 2, balance: 100, ownBalance: 90, spent: 10, received: 20 }]);
    expect(summary?.month).toBe('2026-11');
  });
});

describe('transactionsPath', () => {
  it('sends only what is set, trims the search, and keeps the limit between 1 and 100', () => {
    expect(transactionsPath({})).toBe('/finance/transactions?limit=25');
    expect(transactionsPath({ account: 'a b', q: '  cafe  ', cursor: 'c1', limit: 500 })).toBe('/finance/transactions?account=a+b&q=cafe&cursor=c1&limit=100');
    expect(transactionsPath({ q: '   ', limit: 0 })).toBe('/finance/transactions?limit=1');
  });
});
