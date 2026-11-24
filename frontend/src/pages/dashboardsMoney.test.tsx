import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '../context/ThemeContext';
import App from '../App';
import { primeBootstrap, resetBootstrap } from '../services/dashboards/bootstrapStore';
import { LANG_STORAGE_KEY } from '../services/dashboards/strings';
import { resetStorageFallback } from '../utils/safeStorage';
import { installFakeApi, type FakeApi, type FakeApiOptions, type FinanceData } from '../test/dashboardsApiMock';

// All data below is invented: two made-up providers, made-up counterparties and amounts.

function renderAt(path: string) {
  window.history.pushState({}, '', path);
  return render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
}

const main = () => screen.getByRole('main');
const PATH = '/dashboards/personal/money';

const acct = (id: string, name: string, currency: string, balance: number, extra: Record<string, unknown> = {}) => ({
  id,
  connection_id: 'c-1',
  provider: 'acme-bank',
  type: 'current',
  name,
  currency,
  balance,
  credit_limit: 0,
  own_balance_minor: balance,
  mask_last4: null,
  balance_at: '2026-11-23T09:00:00Z',
  history_from: null,
  archived: false,
  ...extra,
});

const tx = (id: string, account: string, minutes: number, amount: number, what: string, extra: Record<string, unknown> = {}) => ({
  id,
  account_id: account,
  booked_at: new Date(Date.UTC(2026, 10, 23, 12, 0) - minutes * 60000).toISOString(),
  amount,
  currency: 'GBP',
  original_amount: null,
  original_currency: null,
  description: what,
  counterparty: null,
  category_code: null,
  balance_after: null,
  pending: false,
  declined: false,
  internal_transfer: false,
  settled_at: null,
  ...extra,
});

function finance(overrides: Partial<FinanceData> = {}): FinanceData {
  return {
    accounts: [
      acct('a-current', 'Everyday', 'GBP', 45050, { mask_last4: '1234' }),
      acct('a-spare', 'Spare', 'GBP', 1000),
      acct('a-pot-1', 'Holiday fund', 'GBP', 20000, { type: 'pot' }),
      acct('a-pot-2', 'Rainy day', 'GBP', 7500, { type: 'pot' }),
      acct('g-card', 'Travel card', 'EUR', 8000, { provider: 'globex-bank', connection_id: 'c-2', credit_limit: 5000, own_balance_minor: 3000 }),
      acct('g-old', 'Old wallet', 'USD', 0, { provider: 'globex-bank', connection_id: 'c-2', archived: true }),
    ],
    connections: [
      { provider: 'acme-bank', status: 'ok', last_ok_at: '2026-11-23T09:00:00Z' },
      { provider: 'globex-bank', status: 'needs_reconsent', last_ok_at: '2026-11-01T09:00:00Z' },
    ],
    transactions: [
      tx('t1', 'a-current', 5, -450, 'Coffee', { counterparty: 'Corner Cafe', pending: true }),
      tx('t2', 'a-current', 60, 150000, 'Salary', { counterparty: 'Example Ltd' }),
      tx('t3', 'a-current', 120, -2000, 'Card payment', { declined: true }),
      tx('t4', 'a-pot-1', 180, 5000, 'Move to pot', { internal_transfer: true }),
      tx('t5', 'g-card', 240, -1200, 'Dinner', { currency: 'EUR', original_amount: -1000, original_currency: 'GBP' }),
    ],
    summary: {
      month: '2026-11',
      as_of: '2026-11-23T09:00:00Z',
      currencies: [
        { currency: 'GBP', accounts: 4, balance: 73550, own_balance: 73550, spent: 3000, received: 150000 },
        { currency: 'EUR', accounts: 1, balance: 8000, own_balance: 3000, spent: 1200, received: 0 },
      ],
    },
    ...overrides,
  };
}

function setup(options: FakeApiOptions = {}, lang: 'ru' | 'en' = 'en'): FakeApi {
  sessionStorage.setItem('appLoaded', 'true');
  localStorage.clear();
  localStorage.setItem(LANG_STORAGE_KEY, lang);
  resetStorageFallback();
  resetBootstrap();
  return installFakeApi({ finance: finance(), ...options });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the Money page: accounts', () => {
  it('groups the accounts by provider with each balance in its own currency, pots under their group, archived last', async () => {
    setup();
    renderAt(PATH);
    const acme = await within(main()).findByRole('region', { name: 'Acme bank' });
    const globex = within(main()).getByRole('region', { name: 'Globex bank' });
    const rows = (group: HTMLElement) => within(group).getAllByRole('listitem').map((row) => row.textContent ?? '');
    const acmeRows = rows(acme);
    expect(acmeRows[0]).toMatch(/Everyday.*£450\.50/);
    expect(acmeRows[0]).toContain('•••• 1234');
    expect(acmeRows[1]).toMatch(/Spare.*£10\.00/);
    expect(within(acme).getByRole('heading', { level: 4, name: 'Pots' })).toBeInTheDocument();
    expect(acmeRows[2]).toMatch(/Holiday fund.*£200\.00/);
    expect(acmeRows[3]).toMatch(/Rainy day.*£75\.00/);
    // The card shows the owner's own money (balance minus the limit) with the limit beside it; the archived wallet is last and says so.
    const globexRows = rows(globex);
    expect(globexRows[0]).toMatch(/Travel card.*€30\.00/);
    expect(globexRows[0]).toMatch(/credit limit €50\.00/);
    expect(globexRows[1]).toMatch(/Old wallet.*\$0\.00/);
    expect(globexRows[1]).toMatch(/archived/);
  });

  it('shows no total across currencies, only this month per currency', async () => {
    setup();
    renderAt(PATH);
    const month = await within(main()).findByRole('region', { name: 'This month' });
    const blocks = within(month).getAllByRole('listitem');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toHaveTextContent(/GBP · 4 accounts/);
    expect(blocks[0]).toHaveTextContent(/£735\.50/);
    expect(blocks[0]).toHaveTextContent(/£30\.00/);
    expect(blocks[0]).toHaveTextContent(/£1,500\.00/);
    expect(blocks[1]).toHaveTextContent(/EUR · 1 accounts/);
    expect(blocks[1]).toHaveTextContent(/€30\.00/);
    expect(within(main()).queryByText(/total/i)).toBeNull();
  });

  it('says each bank link\'s state; one that needs reconsent is a clear call to reconnect', async () => {
    setup();
    renderAt(PATH);
    const acme = await within(main()).findByRole('region', { name: 'Acme bank' });
    expect(acme).toHaveTextContent(/connected · updated/);
    const globex = within(main()).getByRole('region', { name: 'Globex bank' });
    expect(globex).toHaveTextContent(/needs reconnecting/);
    expect(within(globex).getByText(/asks you to confirm access again/)).toBeInTheDocument();
    // No reconnect route is known for this provider, so there is the hint and no link.
    expect(within(globex).queryByRole('link', { name: 'Reconnect' })).toBeNull();
  });

  it('links Reconnect to the provider\'s consent route when there is one', async () => {
    const data = finance({
      accounts: [acct('m-1', 'Main', 'GBP', 100, { provider: 'monzo' })],
      connections: [{ provider: 'monzo', status: 'needs_reconsent', last_ok_at: null }],
    });
    setup({ finance: data });
    renderAt(PATH);
    const group = await within(main()).findByRole('region', { name: 'Monzo' });
    expect(within(group).getByRole('link', { name: 'Reconnect' })).toHaveAttribute('href', '/api/dashboards/v1/finance/monzo/connect');
  });

  it('says paused, and a provider with accounts but no link row', async () => {
    const data = finance({
      accounts: [acct('p-1', 'One', 'GBP', 100, { provider: 'paused-bank' }), acct('n-1', 'Two', 'GBP', 100, { provider: 'lonely-bank' })],
      connections: [{ provider: 'paused-bank', status: 'paused', last_ok_at: null }],
    });
    setup({ finance: data });
    renderAt(PATH);
    expect(await within(main()).findByRole('region', { name: 'Paused bank' })).toHaveTextContent(/paused/);
    expect(within(main()).getByRole('region', { name: 'Lonely bank' })).toHaveTextContent(/no connection/);
  });

  it('has its own error state with a retry for the accounts and for the month, and an empty state', async () => {
    const api = setup({ fail: ['financeAccounts', 'financeSummary'] });
    renderAt(PATH);
    const accounts = await within(main()).findByRole('region', { name: 'Accounts' });
    expect(await within(accounts).findByRole('alert')).toHaveTextContent('Could not load the accounts.');
    expect(within(main()).getByRole('region', { name: 'This month' })).toHaveTextContent('Could not load this month');
    // The transactions list is a separate request and still works.
    expect(await within(main()).findByText('Corner Cafe')).toBeInTheDocument();
    api.fail.delete('financeAccounts');
    await userEvent.setup().click(within(accounts).getByRole('button', { name: 'Try again' }));
    expect(await within(main()).findByRole('region', { name: 'Acme bank' })).toBeInTheDocument();
  });

  it('says there are no accounts when the list is empty', async () => {
    setup({ finance: finance({ accounts: [], connections: [], transactions: [], summary: { month: '2026-11', as_of: null, currencies: [] } }) });
    renderAt(PATH);
    const accounts = await within(main()).findByRole('region', { name: 'Accounts' });
    expect(await within(accounts).findByText('No accounts yet.')).toBeInTheDocument();
  });
});

describe('the Money page: transactions', () => {
  const list = () => within(within(main()).getByRole('region', { name: 'Transactions' }));
  /** The region exists once the bootstrap has answered. */
  const ready = () => within(main()).findByRole('region', { name: 'Transactions' });

  it('lists them newest first with a sign, an arrow and a word for money in and out, and marks pending, declined and internal ones', async () => {
    setup();
    renderAt(PATH);
    await ready();
    await list().findByText('Corner Cafe');
    await waitFor(() => expect(list().getAllByRole('listitem')[0]).toHaveTextContent('Everyday'));
    const rows = list().getAllByRole('listitem');
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent(/Corner Cafe/);
    expect(rows[0]).toHaveTextContent(/Money out: -£4\.50/);
    expect(rows[0]).toHaveTextContent('pending');
    expect(rows[0].getAttribute('data-direction')).toBe('out');
    expect(rows[0].querySelector('svg[data-icon="arrow-up-right"]')).not.toBeNull();
    expect(rows[1]).toHaveTextContent(/Example Ltd/);
    expect(rows[1]).toHaveTextContent(/Money in: \+£1,500\.00/);
    expect(rows[1].querySelector('svg[data-icon="arrow-down-left"]')).not.toBeNull();
    expect(rows[2]).toHaveTextContent('declined');
    expect(rows[2].getAttribute('data-declined')).toBe('true');
    expect(rows[3]).toHaveTextContent('between your accounts');
    expect(rows[4]).toHaveTextContent(/originally £10\.00/);
    // The account's name is on the row.
    expect(rows[0]).toHaveTextContent('Everyday');
    expect(rows[3]).toHaveTextContent('Holiday fund');
  });

  it('filters by account (sending the id) and starts again from the newest', async () => {
    const api = setup();
    const user = userEvent.setup();
    renderAt(PATH);
    await ready();
    await list().findByText('Corner Cafe');
    await user.selectOptions(list().getByRole('combobox', { name: 'Account' }), 'a-pot-1');
    await waitFor(() => expect(api.callsTo('GET', '/finance/transactions').some((call) => call.url.includes('account=a-pot-1'))).toBe(true));
    await waitFor(() => expect(list().getAllByRole('listitem')).toHaveLength(1));
    expect(list().getByText('Move to pot')).toBeInTheDocument();
    await user.selectOptions(list().getByRole('combobox', { name: 'Account' }), '');
    await waitFor(() => expect(list().getAllByRole('listitem')).toHaveLength(5));
  });

  it('searches by text after a short pause, and says when nothing matches', async () => {
    const api = setup();
    const user = userEvent.setup();
    renderAt(PATH);
    await ready();
    await list().findByText('Corner Cafe');
    await user.type(list().getByRole('searchbox', { name: 'Search transactions' }), 'salary');
    await waitFor(() => expect(api.callsTo('GET', '/finance/transactions').some((call) => call.url.includes('q=salary'))).toBe(true));
    await waitFor(() => expect(list().getAllByRole('listitem')).toHaveLength(1));
    expect(list().getByText('Example Ltd')).toBeInTheDocument();
    // Typing is not a request per letter.
    expect(api.callsTo('GET', '/finance/transactions').filter((call) => /q=s(a(l(a(r)?)?)?)?(&|$)/.test(call.url) && !call.url.includes('q=salary'))).toHaveLength(0);
    await user.clear(list().getByRole('searchbox', { name: 'Search transactions' }));
    await user.type(list().getByRole('searchbox', { name: 'Search transactions' }), 'nothing like this');
    expect(await list().findByText('No transactions found.')).toBeInTheDocument();
  });

  it('loads more by the server\'s cursor, appends them, and drops the button at the end', async () => {
    const many = Array.from({ length: 7 }, (_, index) => tx(`m${index}`, 'a-current', index * 10, -(index + 1) * 100, `Item ${index}`));
    const api = setup({ finance: finance({ transactions: many }) });
    // The fake serves 50 a page by default; a smaller limit is not sent by the page, so serve the page size through the fake's limit.
    const original = globalThis.fetch;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => original(String(input).replace('limit=25', 'limit=3'), init));
    const user = userEvent.setup();
    renderAt(PATH);
    await ready();
    await list().findByText('Item 0');
    expect(list().getAllByRole('listitem')).toHaveLength(3);
    await user.click(list().getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(list().getAllByRole('listitem')).toHaveLength(6));
    expect(api.callsTo('GET', '/finance/transactions').some((call) => call.url.includes('cursor=3'))).toBe(true);
    await user.click(list().getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(list().getAllByRole('listitem')).toHaveLength(7));
    expect(list().queryByRole('button', { name: 'Load more' })).toBeNull();
    expect(list().getByText('Item 6')).toBeInTheDocument();
  });

  it('keeps the list and says so when loading more fails, and has an error with a retry for the first page', async () => {
    const many = Array.from({ length: 4 }, (_, index) => tx(`m${index}`, 'a-current', index * 10, -100, `Item ${index}`));
    const api = setup({ finance: finance({ transactions: many }), fail: ['financeMore'] });
    const original = globalThis.fetch;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => original(String(input).replace('limit=25', 'limit=2'), init));
    const user = userEvent.setup();
    renderAt(PATH);
    await ready();
    await list().findByText('Item 0');
    await user.click(list().getByRole('button', { name: 'Load more' }));
    expect(await list().findByText('Could not load more.')).toBeInTheDocument();
    expect(list().getAllByRole('listitem')).toHaveLength(2);
    api.fail.delete('financeMore');
    await user.click(list().getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(list().getAllByRole('listitem')).toHaveLength(4));
  });

  it('shows an error with a retry when the first page fails', async () => {
    const api = setup({ fail: ['financeTransactions'] });
    renderAt(PATH);
    await ready();
    const failed = await list().findByRole('alert');
    expect(failed).toHaveTextContent('Could not load the transactions.');
    api.fail.delete('financeTransactions');
    await userEvent.setup().click(within(failed).getByRole('button', { name: 'Try again' }));
    expect(await list().findByText('Corner Cafe')).toBeInTheDocument();
  });
});

describe('the Money page: where it lives', () => {
  it('is Russian by default, with the personal skin and the Personal pill current', async () => {
    setup({}, 'ru');
    renderAt(PATH);
    expect(await within(main()).findByRole('heading', { level: 1, name: 'Деньги' })).toBeInTheDocument();
    expect(document.querySelector('[data-space]')).toHaveAttribute('data-space', 'personal');
    const nav = within(main()).getByRole('navigation', { name: 'Дашборды' });
    expect(within(nav).getByRole('link', { name: /Личное/ })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: /Все/ })).not.toHaveAttribute('aria-current');
    expect(main().querySelector('[class*="terminalPrompt"]')).toHaveTextContent('./dashboards/personal/money');
    await waitFor(() => expect(document.title).toBe('Деньги | Yurii Oksamytnyi'));
  });

  it('is reachable from the personal space on real data, and from nowhere on the sample data', async () => {
    setup();
    const user = userEvent.setup();
    const first = renderAt('/dashboards/personal');
    const link = await within(main()).findByRole('link', { name: /Money/ });
    expect(link).toHaveAttribute('href', PATH);
    await user.click(link);
    expect(await within(main()).findByRole('heading', { level: 1, name: 'Money' })).toBeInTheDocument();
    first.unmount();

    sessionStorage.setItem('appLoaded', 'true');
    localStorage.clear();
    resetStorageFallback();
    primeBootstrap(null);
    renderAt('/dashboards/personal');
    expect(within(main()).queryByRole('link', { name: /Деньги/ })).toBeNull();
  });

  it('says finance needs the live data on the sample data, and asks nothing', () => {
    sessionStorage.setItem('appLoaded', 'true');
    localStorage.clear();
    resetStorageFallback();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    renderAt(PATH);
    expect(within(main()).getByText('Деньги доступны только на реальных данных.')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('has a way back to the personal space', async () => {
    setup();
    renderAt(PATH);
    expect(await within(main()).findByRole('link', { name: 'Back to Personal' })).toHaveAttribute('href', '/dashboards/personal');
  });
});
