import { describe, expect, it } from 'vitest';
import { parseAccounts, parseSummary, parseTransaction, parseTransactions, transactionsPath } from './financeApi';

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
      { provider: 'acme-bank', status: 'ok', lastOkAt: '2026-11-23T09:00:00Z' },
      { provider: 'globex-bank', status: 'needs_reconsent', lastOkAt: null },
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
