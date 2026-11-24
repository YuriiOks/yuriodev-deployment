import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '../context/ThemeContext';
import App from '../App';
import { parseBootstrap } from '../services/dashboards/liveApi';
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
  category: 'other',
  category_overridden: false,
  ...extra,
});

function finance(overrides: Partial<FinanceData> = {}): FinanceData {
  return {
    accounts: [
      acct('a-current', 'Everyday', 'GBP', 45050, { mask_last4: '1234' }),
      acct('a-spare', 'Spare', 'GBP', 1000),
      acct('a-twin-1', 'Savings', 'GBP', 500, { history_from: '2022-03-01T00:00:00Z' }),
      acct('a-twin-2', 'Savings', 'GBP', 600, { history_from: '2024-06-15T00:00:00Z' }),
      acct('a-pot-1', '🏖️ Holiday fund', 'GBP', 20000, { type: 'pot' }),
      acct('a-pot-2', 'Rainy day', 'GBP', 7500, { type: 'pot' }),
      acct('a-pot-0', '🎁 Gifts', 'GBP', 0, { type: 'pot' }),
      acct('a-biz', 'Old business', 'GBP', 0),
      acct('m-main', 'Main', 'GBP', -74782, { provider: 'monzo', connection_id: 'c-3' }),
      acct('g-card', 'Platinum credit', 'UAH', 217400, { provider: 'monobank', connection_id: 'c-2', type: 'credit', credit_limit: 7000000, own_balance_minor: -6782600, mask_last4: '0000' }),
      acct('g-eur', 'Euro card', 'EUR', 21, { provider: 'monobank', connection_id: 'c-2' }),
      acct('g-old', 'Old wallet', 'USD', 0, { provider: 'monobank', connection_id: 'c-2', archived: true }),
    ],
    connections: [
      { provider: 'acme-bank', status: 'ok', last_ok_at: '2026-11-23T09:00:00Z' },
      { provider: 'monobank', status: 'ok', last_ok_at: '2026-11-23T09:30:00Z' },
      { provider: 'monzo', status: 'needs_reconsent', last_ok_at: '2026-11-01T09:00:00Z' },
    ],
    transactions: [
      tx('t1', 'a-current', 5, -450, 'Coffee', { counterparty: 'Corner Cafe', pending: true }),
      tx('t2', 'a-current', 60, 150000, 'Salary', { counterparty: 'Example Ltd' }),
      tx('t3', 'm-main', 120, -2000, 'Card payment', { declined: true }),
      tx('t4', 'a-pot-1', 180, 5000, 'Move to pot', { internal_transfer: true }),
      tx('t5', 'g-eur', 240, -1200, 'Dinner', { currency: 'EUR', original_amount: -1000, original_currency: 'GBP' }),
    ],
    summary: {
      month: '2026-11',
      as_of: '2026-11-23T09:00:00Z',
      currencies: [{ currency: 'GBP', accounts: 8, balance: 73550, own_balance: 73550, spent: 3000, received: 150000 }],
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

const wallet = () => within(within(main()).getByRole('region', { name: 'Wallet' }));
const bankButton = (name: string) => wallet().getByRole('button', { name: new RegExp(`^${name}`) });
const opened = () => within(wallet().getByRole('article'));
/** The wallet's region exists once the bootstrap has answered; the banks once the accounts have. */
const banksReady = async () => {
  await within(main()).findByRole('region', { name: 'Wallet' });
  return wallet().findByRole('group', { name: 'Banks' });
};

describe('the Money page: totals and the wallet', () => {
  it('shows the totals per currency with their symbol and the part in pots, and never a sum across currencies', async () => {
    setup();
    renderAt(PATH);
    await banksReady();
    const blocks = within(main().querySelector('header') as HTMLElement).getAllByRole('listitem');
    // GBP: the open accounts of two banks (an overdraft counts as negative); archived accounts are left out.
    expect(blocks.map((block) => block.textContent)).toEqual([
      expect.stringContaining('GBP · accounts: 9'),
      expect.stringContaining('UAH · accounts: 1'),
      expect.stringContaining('EUR · accounts: 1'),
    ]);
    expect(blocks[0]).toHaveTextContent('-£1.32');
    expect(blocks[0]).toHaveTextContent('of which in pots £275.00');
    expect(blocks[0]).toHaveTextContent('this month: spent £30.00 · received £1,500.00');
    expect(blocks[1]).toHaveTextContent('-₴67,826.00');
    expect(blocks[2]).toHaveTextContent('€0.21');
    expect(main().querySelector('header')).not.toHaveTextContent(/UAH [\d.,]+|EUR [\d.,]+/);
  });

  it('stacks every bank as a card with its money, opens the first, and opens another on a click', async () => {
    setup();
    const user = userEvent.setup();
    renderAt(PATH);
    await banksReady();
    const names = within(wallet().getByRole('group', { name: 'Banks' })).getAllByRole('button').map((button) => button.querySelector('strong')?.textContent);
    expect(names).toEqual(['Acme bank', 'Monzo', 'Monobank']);
    expect(bankButton('Acme bank')).toHaveAttribute('aria-pressed', 'true');
    expect(bankButton('Monzo')).toHaveAttribute('aria-pressed', 'false');
    expect(bankButton('Acme bank')).toHaveTextContent('£746.50');
    expect(wallet().getByRole('article', { name: 'Acme bank' })).toBeInTheDocument();
    await user.click(bankButton('Monobank'));
    expect(bankButton('Monobank')).toHaveAttribute('aria-pressed', 'true');
    expect(bankButton('Acme bank')).toHaveAttribute('aria-pressed', 'false');
    expect(wallet().getByRole('article', { name: 'Monobank' })).toBeInTheDocument();
    expect(wallet().queryByRole('article', { name: 'Acme bank' })).toBeNull();
  });

  it('colours a bank we know in its brand pair, and any other in the neutral card', async () => {
    setup();
    renderAt(PATH);
    await banksReady();
    expect(bankButton('Monzo').getAttribute('style')).toContain('--bank-bg: #b3261e');
    expect(bankButton('Monobank').getAttribute('style')).toContain('--bank-fg: #ffffff');
    expect(bankButton('Acme bank').getAttribute('style')).toBeNull();
  });

  it('opens a bank: main accounts as cards, pots as tiles with their emoji as the picture, the empty ones folded', async () => {
    setup();
    const user = userEvent.setup();
    renderAt(PATH);
    await banksReady();
    const accounts = opened().getByRole('region', { name: 'Accounts' });
    const rows = within(accounts).getAllByRole('listitem').map((row) => row.textContent ?? '');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatch(/Everyday.*•••• 1234.*£450\.50/);
    expect(rows[1]).toMatch(/Spare.*£10\.00/);
    // Two accounts with one name: the start of their history tells them apart.
    expect(rows[2]).toMatch(/Savings.*history from Mar 1, 2022.*£5\.00/);
    expect(rows[3]).toMatch(/Savings.*history from Jun 15, 2024.*£6\.00/);
    const pots = opened().getByRole('region', { name: 'Pots' });
    const tiles = within(pots).getAllByRole('listitem');
    expect(tiles).toHaveLength(2);
    // The emoji is the picture (decorative) and is stripped from the label.
    expect(tiles[0].querySelector('[aria-hidden="true"]')?.textContent).toBe('🏖️');
    expect(within(tiles[0]).getByText('Holiday fund')).toBeInTheDocument();
    expect(tiles[0].textContent).toBe('🏖️Holiday fund£200.00');
    expect(tiles[1].querySelector('[aria-hidden="true"]')?.textContent).toBe('R');
    expect(pots).toHaveTextContent('2 · £275.00 in all');
    // The empty pot and the empty business account are folded away.
    expect(opened().queryByText('Gifts')).toBeNull();
    expect(opened().queryByText('Old business')).toBeNull();
    const fold = opened().getByRole('button', { name: '2 more empty' });
    expect(fold).toHaveAttribute('aria-expanded', 'false');
    await user.click(fold);
    expect(opened().getByText('Gifts')).toBeInTheDocument();
    expect(opened().getByText('Old business')).toBeInTheDocument();
    expect(opened().getByRole('button', { name: 'Hide the empty ones' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('reads a credit account as a debt with how much of its limit is used, in words and a bar, and an archived account apart', async () => {
    setup();
    const user = userEvent.setup();
    renderAt(PATH);
    await banksReady();
    await user.click(bankButton('Monobank'));
    const card = opened().getByText('Platinum credit').closest('li') as HTMLElement;
    expect(card.getAttribute('data-kind')).toBe('debt');
    expect(card).toHaveTextContent('•••• 0000');
    expect(card).toHaveTextContent('debt ₴67,826.00');
    expect(card).toHaveTextContent('97% of the ₴70,000.00 limit used · ₴2,174.00 free');
    expect(card.querySelector('[aria-hidden="true"] > div')).toHaveStyle({ width: '97%' });
    expect(opened().getByText('Euro card').closest('li')?.getAttribute('data-kind')).toBe('none');
    const archived = opened().getByRole('region', { name: 'Archived' });
    expect(archived).toHaveTextContent('Old wallet');
    expect(archived).toHaveTextContent('archived');
  });

  it('reads an overdrawn current account with a word and a minus sign, not colour alone', async () => {
    setup();
    const user = userEvent.setup();
    renderAt(PATH);
    await banksReady();
    await user.click(bankButton('Monzo'));
    const main_ = opened().getByText('Main').closest('li') as HTMLElement;
    expect(main_.getAttribute('data-kind')).toBe('overdrawn');
    expect(main_).toHaveTextContent('overdrawn -£747.82');
  });

  it('says what the bank link is doing; one that needs reconsent is a clear call to reconnect, with a link where the provider has a route', async () => {
    setup();
    const user = userEvent.setup();
    renderAt(PATH);
    await banksReady();
    expect(bankButton('Acme bank')).toHaveTextContent(/connected · updated/);
    expect(bankButton('Monzo')).toHaveTextContent('needs reconnecting');
    await user.click(bankButton('Monzo'));
    const alert = opened().getByRole('alert');
    expect(alert).toHaveTextContent('asks you to confirm access again');
    expect(within(alert).getByRole('link', { name: 'Reconnect' })).toHaveAttribute('href', '/api/dashboards/v1/finance/monzo/connect');
  });

  it('has its own error state with a retry for the accounts, and an empty state', async () => {
    const api = setup({ fail: ['financeAccounts'] });
    renderAt(PATH);
    const panel = await within(main()).findByRole('region', { name: 'Wallet' });
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Could not load the accounts.');
    api.fail.delete('financeAccounts');
    await userEvent.setup().click(within(panel).getByRole('button', { name: 'Try again' }));
    expect(await within(panel).findByRole('group', { name: 'Banks' })).toBeInTheDocument();
  });

  it('says there are no accounts when the list is empty', async () => {
    setup({ finance: finance({ accounts: [], connections: [], transactions: [], summary: { month: '2026-11', as_of: null, currencies: [] } }) });
    renderAt(PATH);
    expect(await within(await within(main()).findByRole('region', { name: 'Wallet' })).findByText('No accounts yet.')).toBeInTheDocument();
  });
});

describe('the Money page: transactions', () => {
  const list = () => within(within(main()).getByRole('region', { name: 'Transactions' }));
  /** The region exists once the bootstrap has answered. */
  const ready = () => within(main()).findByRole('region', { name: 'Transactions' });

  it('lists them newest first with a bank mark, the bank and account, a sign, an arrow and a word for money in and out, and the marks', async () => {
    setup();
    renderAt(PATH);
    await ready();
    await list().findByText('Corner Cafe');
    await waitFor(() => expect(list().getAllByRole('listitem')[0]).toHaveTextContent('Acme bank · Everyday'));
    const rows = list().getAllByRole('listitem');
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent(/Money out: -£4\.50/);
    expect(rows[0]).toHaveTextContent('pending');
    expect(rows[0].getAttribute('data-direction')).toBe('out');
    expect(rows[0].querySelector('svg[data-icon="arrow-up-right"]')).not.toBeNull();
    expect(rows[0].querySelector('[aria-hidden="true"]:not(svg)')).toBeTruthy();
    expect(rows[1]).toHaveTextContent(/Money in: \+£1,500\.00/);
    expect(rows[1].querySelector('svg[data-icon="arrow-down-left"]')).not.toBeNull();
    expect(rows[2]).toHaveTextContent('Monzo · Main');
    expect(rows[2]).toHaveTextContent('declined');
    expect(rows[2].getAttribute('data-declined')).toBe('true');
    expect(rows[3]).toHaveTextContent('between your accounts');
    expect(rows[3]).toHaveTextContent('Acme bank · 🏖️ Holiday fund');
    expect(rows[4]).toHaveTextContent('Monobank · Euro card');
    expect(rows[4]).toHaveTextContent(/originally £10\.00/);
  });

  it('filters by bank with chips (all banks first), applying the choice to the rows, and by account inside a bank', async () => {
    const api = setup();
    const user = userEvent.setup();
    renderAt(PATH);
    await ready();
    await list().findByText('Corner Cafe');
    const chips = list().getByRole('group', { name: 'Bank' });
    expect(within(chips).getAllByRole('button').map((chip) => chip.textContent)).toEqual(['All banks', 'Acme bank', 'Monzo', 'Monobank']);
    expect(within(chips).getByRole('button', { name: 'All banks' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(chips).getByRole('button', { name: 'Monzo' }));
    expect(within(chips).getByRole('button', { name: 'Monzo' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(list().getAllByRole('listitem')).toHaveLength(1));
    expect(list().getByText('Card payment')).toBeInTheDocument();
    // Inside a bank, one account can be chosen: the API is asked for that account.
    await user.click(within(chips).getByRole('button', { name: 'Acme bank' }));
    await user.selectOptions(await list().findByRole('combobox', { name: 'Account' }), 'a-pot-1');
    await waitFor(() => expect(api.callsTo('GET', '/finance/transactions').some((call) => call.url.includes('account=a-pot-1'))).toBe(true));
    await waitFor(() => expect(list().getAllByRole('listitem')).toHaveLength(1));
    expect(list().getByText('Move to pot')).toBeInTheDocument();
    await user.click(within(chips).getByRole('button', { name: 'All banks' }));
    await waitFor(() => expect(list().getAllByRole('listitem')).toHaveLength(5));
  });

  it('reads further pages on its own while a bank filter shows too few rows, and stops at the end', async () => {
    const many = [
      ...Array.from({ length: 6 }, (_, index) => tx(`a${index}`, 'a-current', index, -100, `Acme ${index}`)),
      ...Array.from({ length: 3 }, (_, index) => tx(`m${index}`, 'm-main', 100 + index, -100, `Monzo ${index}`)),
    ];
    const api = setup({ finance: finance({ transactions: many }) });
    const original = globalThis.fetch;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => original(String(input).replace('limit=25', 'limit=4'), init));
    const user = userEvent.setup();
    renderAt(PATH);
    await ready();
    await list().findByText('Acme 0');
    await user.click(within(list().getByRole('group', { name: 'Bank' })).getByRole('button', { name: 'Monzo' }));
    await waitFor(() => expect(list().getAllByRole('listitem')).toHaveLength(3));
    expect(api.callsTo('GET', '/finance/transactions').some((call) => call.url.includes('cursor=8'))).toBe(true);
    expect(list().queryByRole('button', { name: 'Load more' })).toBeNull();
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
    await user.clear(list().getByRole('searchbox', { name: 'Search transactions' }));
    await user.type(list().getByRole('searchbox', { name: 'Search transactions' }), 'nothing like this');
    expect(await list().findByText('No transactions found.')).toBeInTheDocument();
  });

  it('loads more by the server\'s cursor, appends them, and drops the button at the end', async () => {
    const many = Array.from({ length: 7 }, (_, index) => tx(`m${index}`, 'a-current', index * 10, -(index + 1) * 100, `Item ${index}`));
    const api = setup({ finance: finance({ transactions: many }) });
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

describe('the Money page: account kinds, goals and categories', () => {
  const kinds = () =>
    finance({
      accounts: [
        acct('main', 'Everyday', 'GBP', 45050, { kind: 'current', mask_last4: '1234' }),
        acct('card-1', 'Card', 'UAH', 5000, { provider: 'monobank', kind: 'current', label: 'Black', mask_last4: '1111' }),
        acct('card-2', 'Card', 'UAH', 7000, { provider: 'monobank', kind: 'current', label: 'Platinum', mask_last4: '2222' }),
        acct('biz-1', 'Studio', 'UAH', 0, { provider: 'monobank', kind: 'business', label: 'Business' }),
        acct('biz-2', 'Shop', 'UAH', 9000, { provider: 'monobank', kind: 'business', label: 'Business' }),
        acct('over', 'Main', 'GBP', -74782, { provider: 'monzo', kind: 'current', overdraft_limit: 100000 }),
        acct('trip', '✈️ Trip', 'GBP', 25000, { provider: 'monzo', kind: 'pot', goal_amount: 100000 }),
        acct('plain', 'Rainy day', 'GBP', 7500, { provider: 'monzo', kind: 'pot' }),
      ],
      connections: [
        { provider: 'acme-bank', status: 'ok', last_ok_at: null },
        { provider: 'monobank', status: 'ok', last_ok_at: null },
        { provider: 'monzo', status: 'ok', last_ok_at: null },
      ],
      transactions: [
        tx('g1', 'main', 5, -6000, 'Weekly shop', { category: 'groceries' }),
        tx('g2', 'main', 10, -4000, 'Pizza', { category: 'eating_out' }),
        tx('g3', 'main', 15, 150000, 'Salary', { category: 'income' }),
      ],
      categories: {
        month: '2026-11',
        previous_month: '2026-10',
        currencies: [
          {
            currency: 'GBP',
            spent: 10000,
            previous_spent: 10638,
            categories: [
              { category: 'eating_out', spent: 4000, previous: 5638 },
              { category: 'groceries', spent: 6000, previous: 5000 },
              { category: 'transport', spent: 0, previous: 0 },
            ],
          },
        ],
      },
    });

  it('folds the business accounts, whatever is in them, behind their own button', async () => {
    setup({ finance: kinds() });
    const user = userEvent.setup();
    renderAt(PATH);
    await banksReady();
    await user.click(bankButton('Monobank'));
    expect(opened().queryByText('Studio')).toBeNull();
    expect(opened().queryByText('Shop')).toBeNull();
    const fold = opened().getByRole('button', { name: 'Business accounts: 2' });
    expect(fold).toHaveAttribute('aria-expanded', 'false');
    await user.click(fold);
    expect(opened().getByText('Studio')).toBeInTheDocument();
    expect(opened().getByText('Shop').closest('li')).toHaveTextContent('Business');
    expect(opened().getByRole('button', { name: 'Hide business accounts' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('tells two accounts with one name apart by their label and last four', async () => {
    setup({ finance: kinds() });
    const user = userEvent.setup();
    renderAt(PATH);
    await banksReady();
    await user.click(bankButton('Monobank'));
    const cards = opened().getAllByText('Card').map((name) => name.closest('li') as HTMLElement);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent('Black · •••• 1111');
    expect(cards[1]).toHaveTextContent('Platinum · •••• 2222');
  });

  it('reads an agreed overdraft as how much of it is used, and shows a pot\'s goal as a bar with its percentage', async () => {
    setup({ finance: kinds() });
    const user = userEvent.setup();
    renderAt(PATH);
    await banksReady();
    await user.click(bankButton('Monzo'));
    const over = opened().getByText('Main').closest('li') as HTMLElement;
    expect(over).toHaveTextContent('overdrawn -£747.82');
    expect(over).toHaveTextContent('75% of the £1,000.00 overdraft used · £252.18 free');
    const trip = opened().getByText('Trip').closest('li') as HTMLElement;
    expect(trip).toHaveTextContent('25% of the £1,000.00 goal');
    expect(trip.querySelector('[aria-hidden="true"] > div')).toHaveStyle({ width: '25%' });
    // A pot with no goal has no bar.
    expect((opened().getByText('Rainy day').closest('li') as HTMLElement).textContent).not.toMatch(/goal/);
  });

  it('shows spend by category: the month, the total and its change, a bar per category with its share and the change from last month in words and a sign', async () => {
    setup({ finance: kinds() });
    renderAt(PATH);
    const panel = within(await within(main()).findByRole('region', { name: 'Spend by category' }));
    await panel.findByText(/November · GBP £100\.00 · 6% less than October/);
    const rows = panel.getAllByRole('listitem');
    // Largest first; a category with nothing spent is not listed.
    expect(rows.map((row) => row.getAttribute('data-category'))).toEqual(['groceries', 'eating_out']);
    expect(rows[0]).toHaveTextContent('Groceries');
    expect(rows[0]).toHaveTextContent('£60.00 · 60% · +£10.00 (was £50.00)');
    expect(rows[1]).toHaveTextContent('£40.00 · 40% · -£16.38 (was £56.38)');
    expect(rows[0].querySelector('[aria-hidden="true"] > div')).toHaveStyle({ width: '60%' });
    expect(panel.getByText(/Transfers between your own accounts and pots are not counted/)).toBeInTheDocument();
  });

  it('says nothing was spent when the month has no spending, and has an error with a retry for the block', async () => {
    const api = setup({ fail: ['financeCategories'] });
    renderAt(PATH);
    const panel = within(await within(main()).findByRole('region', { name: 'Spend by category' }));
    expect(await panel.findByRole('alert')).toHaveTextContent('Could not load spending by category.');
    api.fail.delete('financeCategories');
    await userEvent.setup().click(panel.getByRole('button', { name: 'Try again' }));
    expect(await panel.findByText('No spending this month yet.')).toBeInTheDocument();
  });

  it('offers category chips for the categories with spending, filters the rows through the API, and labels each row with its category', async () => {
    const api = setup({ finance: kinds() });
    const user = userEvent.setup();
    renderAt(PATH);
    const list = within(await within(main()).findByRole('region', { name: 'Transactions' }));
    await list.findByText('Weekly shop');
    const chips = await list.findByRole('group', { name: 'Category' });
    const names = within(chips).getAllByRole('button').map((chip) => chip.textContent);
    expect(names).toEqual(['All categories', 'Groceries', 'Eating out', 'Income']);
    expect(within(list.getAllByRole('listitem')[0]).getByText('Groceries')).toBeInTheDocument();
    await user.click(within(chips).getByRole('button', { name: 'Groceries' }));
    await waitFor(() => expect(api.callsTo('GET', '/finance/transactions').some((call) => call.url.includes('category=groceries'))).toBe(true));
    await waitFor(() => expect(list.getAllByRole('listitem')).toHaveLength(1));
    expect(within(chips).getByRole('button', { name: 'Groceries' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(chips).getByRole('button', { name: 'All categories' }));
    await waitFor(() => expect(list.getAllByRole('listitem')).toHaveLength(3));
  });
});

describe('the Money page: pounds by default, originals beside', () => {
  const gbp = (amount: number) => ({ display_balance: amount, display_currency: 'GBP' });
  const converted = () =>
    finance({
      accounts: [
        acct('a-current', 'Everyday', 'GBP', 45050, { ...gbp(45050) }),
        acct('m-ua', 'Hryvnia card', 'UAH', 650000, { provider: 'monobank', connection_id: 'c-2', ...gbp(12500) }),
        acct('m-us', 'Dollar card', 'USD', 21000, { provider: 'monobank', connection_id: 'c-2', ...gbp(16800) }),
        acct('m-jp', 'Yen card', 'JPY', 99900, { provider: 'monobank', connection_id: 'c-2' }),
      ],
      connections: [
        { provider: 'acme-bank', status: 'ok', last_ok_at: '2026-11-23T09:00:00Z' },
        { provider: 'monobank', status: 'ok', last_ok_at: '2026-11-23T09:30:00Z' },
      ],
      transactions: [
        tx('c1', 'm-ua', 5, -65000, 'Taxi', { currency: 'UAH', display_amount: -1250, display_currency: 'GBP' }),
        tx('c2', 'm-jp', 10, -500, 'Snack', { currency: 'JPY' }),
        tx('c3', 'a-current', 20, -300, 'Bus', { display_amount: -300, display_currency: 'GBP' }),
      ],
      summary: {
        month: '2026-11',
        as_of: '2026-11-23T09:00:00Z',
        display_total: 74350,
        display_currency: 'GBP',
        rate_as_of: '2026-11-24T08:00:00Z',
        currencies: [],
      } as unknown as FinanceData['summary'],
    });

  it('offers no display choice, and shows the originals, while the server sends no converted figures', async () => {
    setup();
    renderAt(PATH);
    await banksReady();
    expect(within(main()).queryByRole('group', { name: 'Amounts' })).toBeNull();
    expect(main()).not.toHaveTextContent('≈');
  });

  it('shows pounds by default with one grand total, the rate once, the currency with no rate named, and the per-currency parts under it', async () => {
    setup({ finance: converted() });
    renderAt(PATH);
    await banksReady();
    const choice = within(main()).getByRole('group', { name: 'Amounts' });
    expect(within(choice).getByRole('button', { name: 'in pounds' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(choice).getByRole('button', { name: 'in account currency' })).toHaveAttribute('aria-pressed', 'false');
    const header = main().querySelector('header') as HTMLElement;
    expect(header).toHaveTextContent('in all');
    expect(header).toHaveTextContent('≈ £743.50');
    expect(header).toHaveTextContent(/rate as of Nov 24/);
    expect(header).toHaveTextContent('not converted: JPY');
    // The parts under it, each in its own currency.
    const parts = within(header).getAllByRole('listitem').map((part) => part.textContent ?? '');
    expect(parts.some((text) => text.includes('UAH') && text.includes('₴6,500.00'))).toBe(true);
    expect(parts.some((text) => text.includes('JPY') && text.includes('¥99,900'))).toBe(true);
  });

  it('marks a converted figure with ≈ and puts the original small beside it, on the bank card, the account and the row; a currency with no rate is plain', async () => {
    setup({ finance: converted() });
    const user = userEvent.setup();
    renderAt(PATH);
    await banksReady();
    // Monobank: UAH and USD converted into one figure; JPY has no rate and stays.
    expect(bankButton('Monobank')).toHaveTextContent('≈ £293.00');
    expect(bankButton('Monobank')).toHaveTextContent('¥99,900');
    await user.click(bankButton('Monobank'));
    const row = opened().getByText('Hryvnia card').closest('li') as HTMLElement;
    expect(row).toHaveTextContent('≈ £125.00');
    expect(row.querySelector('small')).toHaveTextContent('₴6,500.00');
    const yen = opened().getByText('Yen card').closest('li') as HTMLElement;
    expect(yen).not.toHaveTextContent('≈');
    expect(yen).toHaveTextContent('¥99,900');
    const list = within(within(main()).getByRole('region', { name: 'Transactions' }));
    const taxi = (await list.findByText('Taxi')).closest('li') as HTMLElement;
    expect(taxi).toHaveTextContent(/Money out: approximately ≈ -£12\.50/);
    expect(taxi.querySelector('small')).toHaveTextContent('-₴650.00');
    expect((await list.findByText('Snack')).closest('li')).not.toHaveTextContent('≈');
    expect((await list.findByText('Bus')).closest('li')).not.toHaveTextContent('≈');
  });

  it('switches to the account currency, shows only originals, and remembers the choice for the next visit', async () => {
    setup({ finance: converted() });
    const user = userEvent.setup();
    const first = renderAt(PATH);
    await banksReady();
    await user.click(within(main()).getByRole('button', { name: 'in account currency' }));
    expect(within(main()).getByRole('button', { name: 'in account currency' })).toHaveAttribute('aria-pressed', 'true');
    expect(main()).not.toHaveTextContent('≈');
    expect(bankButton('Monobank')).toHaveTextContent('₴6,500.00');
    expect(localStorage.getItem('dashboards-money-display')).toBe('native');
    first.unmount();
    resetBootstrap();
    installFakeApi({ finance: converted() });
    renderAt(PATH);
    await banksReady();
    expect(within(main()).getByRole('button', { name: 'in account currency' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('the Money page: bank logos', () => {
  const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const withLogos = () =>
    finance({
      connections: [
        { provider: 'acme-bank', status: 'ok', last_ok_at: '2026-11-23T09:00:00Z', logo: { light: PIXEL, dark: PIXEL } },
        { provider: 'monzo', status: 'ok', last_ok_at: null, logo: { light: PIXEL, dark: PIXEL } },
        { provider: 'monobank', status: 'ok', last_ok_at: null, logo: { light: 'https://example.com/logo.png', dark: null } },
      ] as unknown as FinanceData['connections'],
    });

  it('shows a wordmark in place of the text name, keeps the name as the accessible name, and picks the variant by the card', async () => {
    setup({ finance: withLogos() });
    renderAt(PATH);
    await banksReady();
    const acme = bankButton('Acme bank');
    // The decorative image carries no text of its own; the name is there for a screen reader.
    expect(acme.querySelectorAll('img')).toHaveLength(2);
    for (const image of Array.from(acme.querySelectorAll('img'))) expect(image).toHaveAttribute('alt', '');
    expect(acme.querySelector('.sr-only')).toHaveTextContent('Acme bank');
    // A known brand card is dark: only the dark variant.
    expect(bankButton('Monzo').querySelectorAll('img')).toHaveLength(1);
    // A logo that is a link (not a data URI) is refused, and the text name stays.
    expect(bankButton('Monobank').querySelector('img')).toBeNull();
    expect(bankButton('Monobank')).toHaveTextContent('Monobank');
  });

  it('shows the text name when the server has no logo', async () => {
    setup();
    renderAt(PATH);
    await banksReady();
    expect(bankButton('Acme bank').querySelector('img')).toBeNull();
    expect(bankButton('Acme bank').querySelector('.sr-only')).toBeNull();
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
    // It takes the Payments tab's place: right after Life areas, and there is no Payments tab on real data.
    expect(link.previousElementSibling).toBe(within(main()).getByRole('tab', { name: 'Life areas' }));
    expect(within(main()).queryByRole('tab', { name: /Payments/ })).toBeNull();
    await user.click(link);
    expect(await within(main()).findByRole('heading', { level: 1, name: 'Money' })).toBeInTheDocument();
    first.unmount();

    sessionStorage.setItem('appLoaded', 'true');
    localStorage.clear();
    resetStorageFallback();
    primeBootstrap(parseBootstrap({ enabled: false }));
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
