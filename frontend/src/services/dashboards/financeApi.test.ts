import { describe, expect, it } from 'vitest';
import { parseAccounts, parseCategories, parseProviders, parseSummary, parseTransaction, parseTransactions, transactionsPath } from './financeApi';

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
        { provider: 'acme-bank', status: 'ok', last_ok_at: '2026-11-23T09:00:00Z', last_error: 'timeout', stale: true, stale_since: '2026-11-22T09:00:00Z' },
        { provider: 'globex-bank', status: 'needs_reconsent', last_ok_at: null },
        { id: 'c-9', provider: 'hand-bank', status: 'ok', last_ok_at: '2026-11-01T00:00:00Z', manual: true, display_name: 'Hand Bank' },
        { provider: 'x', status: 'on fire' },
        { status: 'ok' },
      ],
    });
    expect(parsed?.connections).toEqual([
      { id: null, provider: 'acme-bank', status: 'ok', lastOkAt: '2026-11-23T09:00:00Z', manual: false, displayName: null, lastError: 'timeout', stale: true, staleSince: '2026-11-22T09:00:00Z' },
      { id: null, provider: 'globex-bank', status: 'needs_reconsent', lastOkAt: null, manual: false, displayName: null, lastError: null, stale: false, staleSince: null },
      { id: 'c-9', provider: 'hand-bank', status: 'ok', lastOkAt: '2026-11-01T00:00:00Z', manual: true, displayName: 'Hand Bank', lastError: null, stale: false, staleSince: null },
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

  it('reads the display block and the converted figures of accounts, rows and the summary under the server\'s names', () => {
    const display = { currency: 'GBP', rates: { UAH: { rate: '0.0165', as_of: '2026-11-24T08:00:00Z', source: 'bank' }, USD: { rate: '0.79', as_of: '2026-11-24T07:00:00Z', source: 'bank' }, BAD: { rate: 'x' }, usd: { rate: '1' } }, missing: ['JPY', 'nope'] };
    const parsed = parseAccounts({
      accounts: [account({ currency: 'UAH', display_balance_minor: 1, display_own_balance_minor: 12500, display_available_minor: 2, converted: true }), account({ id: 'b', display_own_balance_minor: 1.5 })],
      connections: [],
      display,
    });
    expect(parsed?.display).toEqual({
      currency: 'GBP',
      rates: { UAH: { rate: '0.0165', asOf: '2026-11-24T08:00:00Z', source: 'bank' }, USD: { rate: '0.79', asOf: '2026-11-24T07:00:00Z', source: 'bank' } },
      missing: ['JPY'],
    });
    expect(parsed?.accounts.map((item) => [item.display, item.converted])).toEqual([[{ amount: 12500, currency: 'GBP' }, true], [null, false]]);
    // An older server sends no block: nothing is converted.
    expect(parseAccounts({ accounts: [account({ display_own_balance_minor: 5 })], connections: [] })).toMatchObject({ display: null, accounts: [{ display: null }] });
    const page = parseTransactions({ transactions: [{ id: 't', account_id: 'a', booked_at: '2026-11-22T12:00:00Z', amount: -100, currency: 'UAH', display_amount_minor: -2, converted: true }, { id: 'u', account_id: 'a', booked_at: '2026-11-22T12:00:00Z', amount: -100, currency: 'USD', display_amount_minor: null, converted: true }], next_cursor: null, display });
    expect(page?.transactions.map((item) => [item.display, item.converted])).toEqual([[{ amount: -2, currency: 'GBP' }, true], [null, true]]);
    const summary = parseSummary({ currencies: [], display: { ...display, complete: false, balance: 10, own_balance: 74350, spent: 1, received: 2 } });
    expect(summary).toMatchObject({ total: { amount: 74350, currency: 'GBP' }, complete: false, rateAsOf: '2026-11-24T07:00:00Z' });
    expect(parseSummary({ currencies: [] })).toMatchObject({ total: null, complete: false, display: null, rateAsOf: null });
  });

  it('reads the banks\' logos from the providers answer: PNG and SVG data URIs only, one variant is enough, links and junk dropped', () => {
    const svg = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
    const png = 'data:image/png;base64,AAAA';
    expect(
      parseProviders({
        providers: [
          { id: 'one', logo: { on_light: svg, on_dark: png } },
          { id: 'two', logo: { on_light: null, on_dark: svg, mark: png } },
          { id: 'six', logo: { on_light: null, on_dark: null, mark: png } },
          { id: 'seven', logo: { on_light: png, mark: 'https://example.com/m.png' } },
          { id: 'three', logo: { on_light: 'https://example.com/x.png', on_dark: 'data:text/html;base64,AAAA' } },
          { id: 'four', logo: { on_light: null, on_dark: null } },
          { logo: { on_light: png } },
          { id: 'five' },
          { id: 'hand', name: 'Hand Bank', colors: { background: '#AA2244', foreground: '#ffffff' }, logo: { on_light: null, on_dark: null, mark: null }, entry: 'manual' },
          { id: 'badcolors', name: 'Odd', colors: { background: 'red', foreground: '#ffffff' }, entry: 'sideways' },
        ],
      }),
    ).toEqual({
      one: { onLight: svg, onDark: png, mark: null, name: null, colors: null, entry: null, reconnect: null, reconnectPath: null },
      two: { onLight: null, onDark: svg, mark: png, name: null, colors: null, entry: null, reconnect: null, reconnectPath: null },
      six: { onLight: null, onDark: null, mark: png, name: null, colors: null, entry: null, reconnect: null, reconnectPath: null },
      seven: { onLight: png, onDark: null, mark: null, name: null, colors: null, entry: null, reconnect: null, reconnectPath: null },
      // A bank with only a name, colours and an entry kind (no logo files) is kept; a colour that is not #rrggbb is dropped with its pair.
      hand: { onLight: null, onDark: null, mark: null, name: 'Hand Bank', colors: { background: '#aa2244', foreground: '#ffffff' }, entry: 'manual', reconnect: null, reconnectPath: null },
      badcolors: { onLight: null, onDark: null, mark: null, name: 'Odd', colors: null, entry: null, reconnect: null, reconnectPath: null },
    });
    expect(parseProviders({ providers: [] })).toEqual({});
    expect(parseProviders({})).toBeNull();
    expect(parseProviders(null)).toBeNull();
  });

  it('read the account kind, label, goal, overdraft and available money, with a safe default for an older server', () => {
    const [full, old] = parseAccounts({
      accounts: [account({ kind: 'pot', label: 'Jar', parent_id: 'p1', goal_amount: 100000, overdraft_limit: 50000, available_minor: 7 }), account({ id: 'o', type: 'pot' })],
      connections: [],
    })!.accounts;
    expect(full).toMatchObject({ kind: 'pot', label: 'Jar', parentId: 'p1', goalAmount: 100000, overdraftLimit: 50000, availableMinor: 7 });
    expect(full).toMatchObject({ overdraftSource: null, overdraftBank: null });
    const owner = parseAccounts({ accounts: [account({ overdraft_limit: 100000, overdraft_limit_source: 'owner', overdraft_limit_bank: 50000 }), account({ id: 'x', overdraft_limit_source: 'nonsense' })], connections: [] })!.accounts;
    expect(owner[0]).toMatchObject({ overdraftSource: 'owner', overdraftBank: 50000, overdraftLimit: 100000 });
    expect(owner[1].overdraftSource).toBeNull();
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
        previous_to_date_day: '2026-10-24',
        currencies: [{ currency: 'GBP', spent: 100, previous_spent: 80, previous_to_date_spent: 40, categories: [{ category: 'groceries', spent: 60, previous: 50, previous_to_date: 20 }, { category: 'nonsense', spent: 1 }, { category: 'transport', spent: 'x' }] }, { currency: 'zz', spent: 1, categories: [] }],
      }),
    ).toEqual({ month: '2026-11', previousMonth: '2026-10', previousToDateDay: '2026-10-24', currencies: [{ currency: 'GBP', spent: 100, previousSpent: 80, previousToDateSpent: 40, categories: [{ category: 'groceries', spent: 60, previous: 50, previousToDate: 20 }], converted: false }], display: null });
    const merged = parseCategories({
      month: '2026-11',
      previous_month: '2026-10',
      currencies: [{ currency: 'UAH', spent: 100000, previous_spent: 90000, categories: [], display_spent: 1650, converted: true }],
      display: { currency: 'GBP', rates: { UAH: { rate: '0.0165', as_of: '2026-11-24T08:00:00Z', source: 'bank' } }, missing: ['JPY'], complete: false, spent: 1650, previous_spent: 1485, previous_to_date_spent: 700, categories: [{ category: 'groceries', spent: 1000, previous: 900, previous_to_date: 500 }, { category: 'nonsense', spent: 1, previous: 1 }] },
    });
    expect(merged?.currencies[0].converted).toBe(true);
    expect(merged?.display).toEqual({ currency: 'GBP', complete: false, spent: 1650, previousSpent: 1485, previousToDateSpent: 700, categories: [{ category: 'groceries', spent: 1000, previous: 900, previousToDate: 500 }], missing: ['JPY'], rateAsOf: '2026-11-24T08:00:00Z' });
    expect(parseCategories({ month: '2026-11', currencies: [] })?.display).toBeNull();
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
    const read = parseSummary({ currencies: [], as_of: '2026-11-20T09:00:00Z', as_of_newest: '2026-11-24T10:30:00Z', as_of_oldest: '2026-11-20T09:00:00Z' });
    expect(read).toMatchObject({ asOf: '2026-11-20T09:00:00Z', asOfNewest: '2026-11-24T10:30:00Z', asOfOldest: '2026-11-20T09:00:00Z' });
    expect(parseSummary({ currencies: [] })).toMatchObject({ asOfNewest: null, asOfOldest: null });
  });
});

describe('transactionsPath', () => {
  it('sends only what is set, trims the search, and keeps the limit between 1 and 100', () => {
    expect(transactionsPath({})).toBe('/finance/transactions?limit=25');
    expect(transactionsPath({ account: 'a b', q: '  cafe  ', cursor: 'c1', limit: 500 })).toBe('/finance/transactions?account=a+b&q=cafe&cursor=c1&limit=100');
    expect(transactionsPath({ q: '   ', limit: 0 })).toBe('/finance/transactions?limit=1');
  });
});

describe('logo addresses', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const logos = (logo: Record<string, unknown>) => parseProviders({ providers: [{ id: 'acme-bank', name: 'Acme', logo }] })?.['acme-bank'];

  it('takes a data URI or a same-origin path under the providers route, and nothing else', () => {
    expect(logos({ on_light: png })?.onLight).toBe(png);
    const path = '/api/dashboards/v1/finance/providers/acme-bank/logo/on_light.svg';
    expect(logos({ on_light: path, mark: path })).toMatchObject({ onLight: path, mark: path });
    // The shape the server really sends: a version query, and the size hints beside the three addresses.
    const versioned = '/api/dashboards/v1/finance/providers/acme-bank/logo/on_dark?v=e6140d0d';
    expect(
      logos({ on_light: null, on_dark: versioned, mark: versioned.replace('on_dark', 'mark'), aspect: { on_dark: 4.5, mark: 1 }, scale: 1, mono: false }),
    ).toMatchObject({ onLight: null, onDark: versioned, mark: '/api/dashboards/v1/finance/providers/acme-bank/logo/mark?v=e6140d0d' });
    for (const bad of [
      '/api/dashboards/v1/finance/providers/acme-bank/logo/on_dark?v=e6140d0d&next=//example.com',
      '/api/dashboards/v1/finance/providers/acme-bank/logo/on_dark?v=',
      '/api/dashboards/v1/finance/providers/acme-bank/logo/on_dark?V=E6140D0D',
      'https://example.com/logo.png',
      '//example.com/logo.png',
      '/api/dashboards/v1/finance/providers/../../tasks',
      '/api/dashboards/v1/finance/providers//evil.example.com/x.png',
      '/api/dashboards/v1/finance/providers/%2e%2e/x',
      '/api/dashboards/v1/finance/providers/acme?x=1',
      '/api/other/logo.png',
      'javascript:alert(1)',
    ]) {
      expect(logos({ on_light: bad, on_dark: png })?.onLight, bad).toBeNull();
    }
  });
});

