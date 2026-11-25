import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
/** Every section on one page (the Today view is the default). */
const ALL = `${PATH}?view=all`;

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
    providers: [{ id: 'monzo', name: 'Monzo', reconnect: 'oauth', reconnect_path: '/api/dashboards/v1/finance/monzo/connect' }],
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const wallet = () => within(within(main()).getByRole('region', { name: 'Wallet' }));
const bankButton = (name: string) => wallet().getByRole('button', { name: new RegExp(`^${name}`) });
/** The whole card of a bank (its button, and the facts and pills of the open one). */
const bankCard = (name: string) => bankButton(name).parentElement as HTMLElement;
const opened = () => within(wallet().getByRole('article'));
/** The wallet's region exists once the bootstrap has answered; the banks once the accounts have. */
const banksReady = async () => {
  await within(main()).findByRole('region', { name: 'Wallet' });
  return wallet().findByRole('group', { name: 'Banks' });
};

describe('the Money page: totals and the wallet', () => {
  it('shows the totals per currency with their symbol and the part in pots, and never a sum across currencies', async () => {
    setup();
    renderAt(ALL);
    await banksReady();
    // The totals strip is at the top of the Wallet view's body.
    const strip = (await screen.findByText(/GBP · accounts: 9/)).closest('ul')?.parentElement as HTMLElement;
    const blocks = within(strip).getAllByRole('listitem');
    // GBP: the open accounts of two banks (an overdraft counts as negative); archived accounts are left out.
    expect(blocks.map((block) => block.textContent)).toEqual([
      expect.stringContaining('GBP · accounts: 9'),
      expect.stringContaining('UAH · accounts: 1'),
      expect.stringContaining('EUR · accounts: 1'),
    ]);
    expect(blocks[0]).toHaveTextContent('−£1.32');
    expect(blocks[0]).toHaveTextContent('of which in pots £275.00');
    expect(blocks[0]).toHaveTextContent('this month: spent £30.00 · received £1,500.00');
    expect(blocks[1]).toHaveTextContent('−₴67,826.00');
    expect(blocks[2]).toHaveTextContent('€0.21');
    expect(strip).not.toHaveTextContent(/UAH [\d.,]+|EUR [\d.,]+/);
  });

  it('stacks every bank as a card with its money, opens the first, and opens another on a click', async () => {
    setup();
    const user = userEvent.setup();
    renderAt(ALL);
    await banksReady();
    // The open bank sits at the bottom of the stack; the others keep their order above it.
    const names = within(wallet().getByRole('group', { name: 'Banks' })).getAllByRole('button').map((button) => /^(Acme bank|Monzo|Monobank)/.exec(button.textContent ?? '')?.[1]);
    expect(names).toEqual(['Monzo', 'Monobank', 'Acme bank']);
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

  it('shows the hero balance with the symbol and pence smaller, the open card\'s facts and its pill actions, and nothing of the kind on the others', async () => {
    setup();
    const user = userEvent.setup();
    renderAt(ALL);
    await banksReady();
    const acme = bankCard('Acme bank');
    // Pounds big, symbol and pence small: three kinds of part, one text.
    const hero = bankButton('Acme bank').querySelector('[data-hero]') as HTMLElement;
    expect(hero.textContent).toBe('£746.50');
    expect(Array.from(hero.querySelectorAll('[data-part]')).map((part) => part.getAttribute('data-part'))).toEqual(['symbol', 'int', 'frac', 'frac']);
    expect(hero.querySelector('[data-part="int"]')?.textContent).toBe('746');
    expect(within(acme).getByRole('link', { name: 'Accounts' })).toHaveAttribute('href', '#money-bank-acme-bank-name');
    expect(within(acme).getByRole('link', { name: 'Transactions' })).toHaveAttribute('href', '#money-transactions-title');
    expect(within(bankCard('Monobank')).queryByRole('link')).toBeNull();
    await user.click(bankButton('Monobank'));
    expect(within(bankCard('Monobank')).getByRole('link', { name: 'Accounts' })).toBeInTheDocument();
    expect(within(bankCard('Acme bank')).queryByRole('link')).toBeNull();
  });

  it('colours a bank we know in its brand pair, and any other in the neutral card', async () => {
    setup();
    renderAt(ALL);
    await banksReady();
    expect(bankCard('Monzo').getAttribute('style')).toContain('--bank-bg: #c9364a');
    expect(bankCard('Monobank').getAttribute('style')).toContain('--bank-bg: #000000');
    expect(bankCard('Monobank').getAttribute('style')).toContain('--bank-fg: #ffffff');
    expect(bankCard('Acme bank').getAttribute('style')).toBeNull();
  });

  it('opens a bank: main accounts as cards, pots as tiles with their emoji as the picture, the empty ones folded', async () => {
    setup();
    const user = userEvent.setup();
    renderAt(ALL);
    await banksReady();
    const accounts = opened().getByRole('region', { name: 'Accounts' });
    const rows = within(accounts).getAllByRole('listitem').map((row) => row.textContent ?? '');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatch(/Everyday.*•••• 1234.*£450\.50/);
    expect(rows[1]).toMatch(/Spare.*£10\.00/);
    // Two accounts with one name: the start of their history tells them apart.
    expect(rows[2]).toMatch(/Savings.*history from 1 Mar 2022.*£5\.00/);
    expect(rows[3]).toMatch(/Savings.*history from 15 Jun 2024.*£6\.00/);
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
    renderAt(ALL);
    await banksReady();
    await user.click(bankButton('Monobank'));
    const card = opened().getByText('Platinum credit').closest('li') as HTMLElement;
    expect(card.getAttribute('data-kind')).toBe('debt');
    expect(card).toHaveTextContent('•••• 0000');
    expect(card).toHaveTextContent('debt ₴67,826.00');
    expect(card).toHaveTextContent('96% of the ₴70,000.00 limit used · ₴2,174.00 free');
    expect(card.querySelector('[aria-hidden="true"] > div')).toHaveStyle({ width: '96%' });
    expect(opened().getByText('Euro card').closest('li')?.getAttribute('data-kind')).toBe('none');
    const archived = opened().getByRole('region', { name: 'Archived' });
    expect(archived).toHaveTextContent('Old wallet');
    expect(archived).toHaveTextContent('archived');
  });

  it('reads an overdrawn current account with a word and a minus sign, not colour alone', async () => {
    setup();
    const user = userEvent.setup();
    renderAt(ALL);
    await banksReady();
    await user.click(bankButton('Monzo'));
    const main_ = opened().getByText('Main').closest('li') as HTMLElement;
    expect(main_.getAttribute('data-kind')).toBe('overdrawn');
    expect(main_).toHaveTextContent('overdrawn −£747.82');
  });

  it('says what the bank link is doing; one that needs reconsent is a clear call to reconnect, with a link where the provider has a route', async () => {
    setup();
    const user = userEvent.setup();
    renderAt(ALL);
    await banksReady();
    // Connection status is told on the open card only; a card that needs attention elsewhere carries a warning mark.
    expect(bankCard('Acme bank')).toHaveTextContent(/connected · updated/);
    expect(bankCard('Monzo')).not.toHaveTextContent(/updated/);
    expect(within(bankCard('Monzo')).getByTitle('needs reconnecting')).toBeInTheDocument();
    expect(within(bankCard('Acme bank')).queryByRole('link', { name: 'Reconnect' })).toBeNull();
    await user.click(bankButton('Monzo'));
    expect(bankCard('Monzo')).toHaveTextContent('needs reconnecting');
    expect(within(bankCard('Monzo')).getByRole('link', { name: 'Reconnect' })).toHaveAttribute('href', '/api/dashboards/v1/finance/monzo/connect');
    const alert = opened().getByRole('alert');
    expect(alert).toHaveTextContent('asks you to confirm access again');
    expect(within(alert).getByRole('link', { name: 'Reconnect' })).toHaveAttribute('href', '/api/dashboards/v1/finance/monzo/connect');
  });

  it('has its own error state with a retry for the accounts, and an empty state', async () => {
    const api = setup({ fail: ['financeAccounts'] });
    renderAt(ALL);
    const panel = await within(main()).findByRole('region', { name: 'Wallet' });
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Could not load the accounts.');
    api.fail.delete('financeAccounts');
    await userEvent.setup().click(within(panel).getByRole('button', { name: 'Try again' }));
    expect(await within(panel).findByRole('group', { name: 'Banks' })).toBeInTheDocument();
  });

  it('says there are no accounts when the list is empty', async () => {
    setup({ finance: finance({ accounts: [], connections: [], transactions: [], summary: { month: '2026-11', as_of: null, currencies: [] } }) });
    renderAt(ALL);
    expect(await within(await within(main()).findByRole('region', { name: 'Wallet' })).findByText('No accounts yet.')).toBeInTheDocument();
  });
});

describe('the Money page: transactions', () => {
  const list = () => within(within(main()).getByRole('region', { name: 'Transactions' }));
  /** The region exists once the bootstrap has answered. */
  const ready = () => within(main()).findByRole('region', { name: 'Transactions' });

  it('lists them newest first with a bank mark, the bank and account, a sign and a word for money in and out (no arrow: the sign and the colour say it), and the marks', async () => {
    setup();
    renderAt(ALL);
    await ready();
    await list().findByText('Corner Cafe');
    await waitFor(() => expect(list().getAllByRole('listitem')[0]).toHaveTextContent('Acme bank · Everyday'));
    const rows = list().getAllByRole('listitem');
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent(/Money out: −£4\.50/);
    expect(rows[0]).toHaveTextContent('pending');
    expect(rows[0].getAttribute('data-direction')).toBe('out');
    expect(rows[0].querySelector('svg[data-icon^="arrow-"]')).toBeNull();
    expect(rows[0].querySelector('[aria-hidden="true"]:not(svg)')).toBeTruthy();
    expect(rows[1]).toHaveTextContent(/Money in: \+£1,500\.00/);
    expect(rows[1].getAttribute('data-direction')).toBe('in');
    // A picture is never rendered without its address (an <img> with no src is a request for the page itself).
    expect(main().querySelectorAll('img:not([src]), img[src=""]')).toHaveLength(0);
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
    renderAt(ALL);
    await ready();
    await list().findByText('Corner Cafe');
    const chips = list().getByRole('group', { name: 'Bank' });
    // Each bank chip is its mark and its name, and the name is its tooltip too.
    expect(within(chips).getAllByRole('button').map((chip) => chip.title || chip.textContent)).toEqual(['All banks', 'Acme bank', 'Monzo', 'Monobank']);
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
    renderAt(ALL);
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
    renderAt(ALL);
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
    renderAt(ALL);
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
    renderAt(ALL);
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
    renderAt(ALL);
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
        acct('over', 'Main', 'GBP', -74782, { provider: 'monzo', kind: 'current', overdraft_limit: 100000, overdraft_limit_source: 'owner', overdraft_limit_bank: 50000 }),
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
    renderAt(ALL);
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
    renderAt(ALL);
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
    renderAt(ALL);
    await banksReady();
    await user.click(bankButton('Monzo'));
    const over = opened().getByText('Main').closest('li') as HTMLElement;
    expect(over).toHaveTextContent('overdrawn −£747.82');
    expect(over).toHaveTextContent('your limit · 74% of the £1,000.00 overdraft used · £252.18 free');
    const trip = opened().getByText('Trip').closest('li') as HTMLElement;
    expect(trip).toHaveTextContent('25% of £1,000.00');
    expect(trip.querySelector('[aria-hidden="true"] > div')).toHaveStyle({ width: '25%' });
    // A pot with no goal has no bar.
    expect((opened().getByText('Rainy day').closest('li') as HTMLElement).textContent).not.toMatch(/goal/);
  });

  it('shows spend by category: the month, the total and its change, a bar per category with its share and the change from last month in words and a sign', async () => {
    setup({ finance: kinds() });
    renderAt(ALL);
    const panel = within(await within(main()).findByRole('region', { name: 'Spend by category' }));
    await panel.findByText(/November · £100\.00 · 6% less than October/);
    const rows = panel.getAllByRole('listitem');
    // Largest first; a category with nothing spent is not listed.
    expect(rows.map((row) => row.getAttribute('data-category'))).toEqual(['groceries', 'eating_out']);
    expect(rows[0]).toHaveTextContent('Groceries');
    expect(rows[0]).toHaveTextContent('£60.00 · 60% · +£10.00 (was £50.00)');
    expect(rows[1]).toHaveTextContent('£40.00 · 40% · −£16.38 (was £56.38)');
    expect(rows[0].querySelector('[aria-hidden="true"] > div')).toHaveStyle({ width: '100%' });
    // A bar is scaled to the largest category (40 of 60), not to the total.
    expect(rows[1].querySelector('[aria-hidden="true"] > div')).toHaveStyle({ width: '67%' });
    expect(panel.getByText(/Transfers between your own accounts and pots are not counted/)).toBeInTheDocument();
  });

  it('in pounds shows the server\'s merged lines (each converted once, adding up), marked approximate, with the unconverted currencies named; in the account currency, one block per currency', async () => {
    const categories = {
      month: '2026-11',
      previous_month: '2026-10',
      currencies: [
        { currency: 'GBP', spent: 10000, previous_spent: 8000, converted: false, display_spent: 10000, display_previous_spent: 8000, categories: [{ category: 'groceries', spent: 10000, previous: 8000, display_spent: 10000, display_previous: 8000 }] },
        { currency: 'UAH', spent: 200000, previous_spent: 100000, converted: true, display_spent: 3800, display_previous_spent: 1900, categories: [{ category: 'groceries', spent: 200000, previous: 100000, display_spent: 3800, display_previous: 1900 }] },
      ],
      display: {
        currency: 'GBP',
        rates: { UAH: { rate: '0.019', as_of: '2026-11-24T08:00:00Z', source: 'bank' } },
        missing: ['JPY'],
        complete: false,
        spent: 13800,
        previous_spent: 9900,
        categories: [{ category: 'groceries', spent: 13800, previous: 9900 }],
      },
    };
    setup({ finance: finance({ categories, display: { currency: 'GBP', rates: {}, missing: [] }, accounts: [acct('a', 'Everyday', 'GBP', 1, { display_own_balance_minor: 1, converted: false }), acct('u', 'Hryvnia', 'UAH', 1000, { display_own_balance_minor: 19, converted: true })] }) });
    const user = userEvent.setup();
    renderAt(ALL);
    const panel = within(await within(main()).findByRole('region', { name: 'Spend by category' }));
    await panel.findByText(/November · ≈ £138\.00 · 39% more than October/);
    expect(panel.getAllByRole('listitem')).toHaveLength(1);
    expect(panel.getByRole('listitem')).toHaveTextContent('≈ £138.00 · 100% · +£39.00 (was £99.00)');
    expect(panel.getByText('not converted: JPY')).toBeInTheDocument();
    await user.click(within(main()).getByRole('button', { name: 'in account currency' }));
    await panel.findByText(/November · GBP £100\.00 · 25% more than October/);
    expect(panel.getByText(/November · UAH ₴2,000\.00 · 100% more than October/)).toBeInTheDocument();
  });

  it('says nothing was spent when the month has no spending, and has an error with a retry for the block', async () => {
    const api = setup({ fail: ['financeCategories'] });
    renderAt(ALL);
    const panel = within(await within(main()).findByRole('region', { name: 'Spend by category' }));
    expect(await panel.findByRole('alert')).toHaveTextContent('Could not load spending by category.');
    api.fail.delete('financeCategories');
    await userEvent.setup().click(panel.getByRole('button', { name: 'Try again' }));
    expect(await panel.findByText('No spending this month yet.')).toBeInTheDocument();
  });

  it('offers category chips for the categories with spending, filters the rows through the API, and labels each row with its category', async () => {
    const api = setup({ finance: kinds() });
    const user = userEvent.setup();
    renderAt(ALL);
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
  const same = (amount: number) => ({ display_own_balance_minor: amount, converted: false });
  const other = (amount: number) => ({ display_own_balance_minor: amount, converted: true });
  const rates = { UAH: { rate: '0.019', as_of: '2026-11-24T08:00:00Z', source: 'bank' }, USD: { rate: '0.79', as_of: '2026-11-24T09:30:00Z', source: 'bank' } };
  const converted = () =>
    finance({
      accounts: [
        acct('a-current', 'Everyday', 'GBP', 45050, same(45050)),
        acct('m-ua', 'Hryvnia card', 'UAH', 650000, { provider: 'monobank', connection_id: 'c-2', ...other(12500) }),
        acct('m-us', 'Dollar card', 'USD', 21000, { provider: 'monobank', connection_id: 'c-2', ...other(16800) }),
        acct('m-jp', 'Yen card', 'JPY', 99900, { provider: 'monobank', connection_id: 'c-2', display_own_balance_minor: null, converted: true }),
      ],
      connections: [
        { provider: 'acme-bank', status: 'ok', last_ok_at: '2026-11-23T09:00:00Z' },
        { provider: 'monobank', status: 'ok', last_ok_at: '2026-11-23T09:30:00Z' },
      ],
      display: { currency: 'GBP', rates, missing: ['JPY'] },
      transactions: [
        tx('c1', 'm-ua', 5, -65000, 'Taxi', { currency: 'UAH', display_amount_minor: -1250, converted: true }),
        tx('c2', 'm-jp', 10, -500, 'Snack', { currency: 'JPY', display_amount_minor: null, converted: true }),
        tx('c3', 'a-current', 20, -300, 'Bus', { display_amount_minor: -300, converted: false }),
      ],
      summary: {
        month: '2026-11',
        as_of: '2026-11-23T09:00:00Z',
        currencies: [],
        display: { currency: 'GBP', rates, missing: ['JPY'], complete: false, balance: 74350, own_balance: 74350, spent: 0, received: 0 },
      },
    });

  it('offers no display choice, and shows the originals, while the server sends no converted figures', async () => {
    setup();
    renderAt(ALL);
    await banksReady();
    expect(within(main()).queryByRole('group', { name: 'Amounts' })).toBeNull();
    expect(main()).not.toHaveTextContent('≈');
  });

  it('shows pounds by default with one grand total, the rate once, the currency with no rate named, and the per-currency parts under it', async () => {
    // The rate note tells "today" and "yesterday" against now: the clock is fixed well after the date the test uses.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-20T12:00:00Z'));
    setup({ finance: converted() });
    renderAt(ALL);
    await banksReady();
    const choice = within(main()).getByRole('group', { name: 'Amounts' });
    expect(within(choice).getByRole('button', { name: 'in pounds' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(choice).getByRole('button', { name: 'in account currency' })).toHaveAttribute('aria-pressed', 'false');
    const header = (await within(main()).findByText('in all')).closest('div')?.parentElement as HTMLElement;
    expect(header).toHaveTextContent('in all');
    // The hero writes the mark tight against the figure (a margin, not a space).
    expect(header).toHaveTextContent('≈£743.50');
    // The rate's time is the oldest of the rates used (08:00, not 09:30).
    expect(header).toHaveTextContent(/rate as of 24 Nov.*08:00/);
    expect(header).toHaveTextContent('not converted: JPY');
    // The parts under it, each in its own currency.
    const parts = within(header).getAllByRole('listitem').map((part) => part.textContent ?? '');
    expect(parts.some((text) => text.includes('UAH') && text.includes('₴6,500.00'))).toBe(true);
    expect(parts.some((text) => text.includes('JPY') && text.includes('¥99,900'))).toBe(true);
  });

  it('marks a converted figure with ≈ and puts the original small beside it, on the bank card, the account and the row; a currency with no rate is plain', async () => {
    setup({ finance: converted() });
    const user = userEvent.setup();
    renderAt(ALL);
    await banksReady();
    // Monobank: UAH and USD converted into one figure; JPY has no rate and stays.
    expect(bankButton('Monobank')).toHaveTextContent('≈£293.00');
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
    expect(taxi).toHaveTextContent(/Money out: approximately ≈ −£12\.50/);
    expect(taxi.querySelector('small')).toHaveTextContent('−₴650.00');
    expect((await list.findByText('Snack')).closest('li')).not.toHaveTextContent('≈');
    expect((await list.findByText('Bus')).closest('li')).not.toHaveTextContent('≈');
  });

  it('switches to the account currency, shows only originals, and remembers the choice for the next visit', async () => {
    setup({ finance: converted() });
    const user = userEvent.setup();
    const first = renderAt(ALL);
    await banksReady();
    await user.click(within(main()).getByRole('button', { name: 'in account currency' }));
    expect(within(main()).getByRole('button', { name: 'in account currency' })).toHaveAttribute('aria-pressed', 'true');
    expect(main()).not.toHaveTextContent('≈');
    expect(bankButton('Monobank')).toHaveTextContent('₴6,500.00');
    expect(localStorage.getItem('dashboards-money-display')).toBe('native');
    first.unmount();
    resetBootstrap();
    installFakeApi({ finance: converted() });
    renderAt(ALL);
    await banksReady();
    expect(within(main()).getByRole('button', { name: 'in account currency' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('the Money page: bank logos', () => {
  // Distinct, valid data URIs: the page must pick the right variant of each (invented, not any bank's).
  const DARK_INK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const WHITE_INK = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';
  const withLogos = () =>
    finance({
      providers: [
        { id: 'acme-bank', logo: { on_light: DARK_INK, on_dark: WHITE_INK } },
        { id: 'monzo', logo: { on_light: DARK_INK, on_dark: WHITE_INK } },
        { id: 'monobank', logo: { on_light: 'https://example.com/logo.png', on_dark: null } },
      ],
    });
  const images = (button: HTMLElement) => Array.from(button.querySelectorAll('img'));

  it('shows a wordmark in place of the text name, keeps the name as the accessible name, and picks the variant by the card\'s background', async () => {
    setup({ finance: withLogos() });
    renderAt(ALL);
    await banksReady();
    const acme = bankButton('Acme bank');
    // A neutral card shows both variants (the stylesheet shows the theme\'s); the images are decorative, the name is there for a screen reader.
    await waitFor(() => expect(images(acme)).toHaveLength(2));
    for (const image of images(acme)) expect(image).toHaveAttribute('alt', '');
    expect(images(acme).map((image) => image.getAttribute('src'))).toEqual([WHITE_INK, DARK_INK]);
    expect(acme.querySelector('.sr-only')).toHaveTextContent('Acme bank');
    // A dark brand card gets white ink only, chosen by its luminance, not by the theme.
    await waitFor(() => expect(images(bankButton('Monzo'))).toHaveLength(1));
    expect(images(bankButton('Monzo'))[0].getAttribute('src')).toBe(WHITE_INK);
    // A logo that is a link (not a data URI) is refused, and the text name stays.
    expect(images(bankButton('Monobank'))).toHaveLength(0);
    expect(bankButton('Monobank')).toHaveTextContent('Monobank');
  });

  it('picks the wordmark by the card\'s own ink: a light-ish brand colour with white ink gets the white wordmark, a dark ink the dark one', async () => {
    setup({
      finance: finance({
        providers: [
          { id: 'acme-bank', logo: { on_light: DARK_INK, on_dark: WHITE_INK }, colors: { background: '#ff4f40', foreground: '#ffffff' } },
          { id: 'monobank', logo: { on_light: DARK_INK, on_dark: WHITE_INK }, colors: { background: '#f5d90a', foreground: '#111111' } },
        ],
      }),
    });
    const user = userEvent.setup();
    renderAt(ALL);
    await banksReady();
    await waitFor(() => expect(images(bankButton('Acme bank'))).toHaveLength(1));
    expect(images(bankButton('Acme bank'))[0].getAttribute('src')).toBe(WHITE_INK);
    expect(images(bankButton('Monobank'))[0].getAttribute('src')).toBe(DARK_INK);
    // The same in the opened bank's header.
    await user.click(bankButton('Acme bank'));
    const header = opened().getByRole('heading', { level: 3, name: 'Acme bank' });
    await waitFor(() => expect(header.querySelector('img')?.getAttribute('src')).toBe(WHITE_INK));
  });

  it('shows the logo in the opened bank\'s header and in the bank filter chips, with the name as each one\'s accessible name', async () => {
    setup({ finance: withLogos() });
    const user = userEvent.setup();
    renderAt(ALL);
    await banksReady();
    await user.click(bankButton('Monzo'));
    const header = opened().getByRole('heading', { level: 3, name: 'Monzo' });
    await waitFor(() => expect(header.querySelector('img')).not.toBeNull());
    const chips = within(within(main()).getByRole('region', { name: 'Transactions' })).getByRole('group', { name: 'Bank' });
    // A chip is one anatomy for every bank: its mark and its name (also its tooltip), never a wordmark.
    const chip = within(chips).getByRole('button', { name: 'Acme bank' });
    expect(chip).toHaveAttribute('title', 'Acme bank');
    expect(chip.querySelector('[data-size="chip"]')).toBeNull();
    expect(within(chips).getByRole('button', { name: 'Monobank' }).querySelector('img')).toBeNull();
  });

  it('never draws a wordmark in a chip, whatever variants the bank has: the chip is the mark and the name', async () => {
    setup({
      finance: finance({
        providers: [
          { id: 'acme-bank', logo: { on_light: null, on_dark: WHITE_INK } },
          { id: 'monzo', logo: { on_light: DARK_INK, on_dark: WHITE_INK } },
        ],
      }),
    });
    renderAt(ALL);
    await banksReady();
    const chips = within(within(main()).getByRole('region', { name: 'Transactions' })).getByRole('group', { name: 'Bank' });
    for (const name of ['Acme bank', 'Monzo']) {
      const chip = within(chips).getByRole('button', { name });
      expect(chip.querySelector('[data-size="chip"]')).toBeNull();
      expect(chip.querySelector('img')).toBeNull();
      expect(chip).toHaveTextContent(name);
    }
  });

  it('uses the bank\'s square icon for the small tiles in the transaction rows and the filter chips when the server sends one, the letter tile otherwise', async () => {
    setup({
      finance: finance({
        providers: [
          { id: 'acme-bank', logo: { on_light: DARK_INK, on_dark: WHITE_INK, mark: WHITE_INK } },
          { id: 'monzo', logo: { on_light: DARK_INK, on_dark: WHITE_INK } },
        ],
      }),
    });
    renderAt(ALL);
    await banksReady();
    const transactions = within(main()).getByRole('region', { name: 'Transactions' });
    const chips = within(transactions).getByRole('group', { name: 'Bank' });
    const chip = within(chips).getByRole('button', { name: 'Acme bank' });
    await waitFor(() => expect(chip.querySelector('img')?.getAttribute('src')).toBe(WHITE_INK));
    expect(chip.querySelector('[data-size="chip"]')).toBeNull();
    // A bank without an icon has the letter tile in its chip, with its name.
    expect(within(chips).getByRole('button', { name: 'Monzo' }).querySelector('img')).toBeNull();
    const rows = await within(transactions).findAllByRole('listitem');
    expect(rows.some((row) => row.querySelector('img')?.getAttribute('src') === WHITE_INK)).toBe(true);
  });

  it('shows a square mark taller than a wide one, once the image has loaded', async () => {
    setup({ finance: withLogos() });
    renderAt(ALL);
    await banksReady();
    const monzo = bankButton('Monzo');
    await waitFor(() => expect(images(monzo)).toHaveLength(1));
    const image = images(monzo)[0];
    const holder = image.parentElement as HTMLElement;
    expect(holder).toHaveAttribute('data-shape', 'wide');
    Object.defineProperty(image, 'naturalWidth', { value: 40, configurable: true });
    Object.defineProperty(image, 'naturalHeight', { value: 40, configurable: true });
    fireEvent.load(image);
    await waitFor(() => expect(holder).toHaveAttribute('data-shape', 'square'));
    Object.defineProperty(image, 'naturalWidth', { value: 120, configurable: true });
    Object.defineProperty(image, 'naturalHeight', { value: 24, configurable: true });
    fireEvent.load(image);
    await waitFor(() => expect(holder).toHaveAttribute('data-shape', 'wide'));
  });

  it('shows the bank\'s square mark on its card in place of a near-square wordmark, when the server has one', async () => {
    setup({ finance: finance({ providers: [{ id: 'acme-bank', logo: { on_light: DARK_INK, on_dark: WHITE_INK, mark: DARK_INK } }, { id: 'monzo', logo: { on_light: DARK_INK, on_dark: WHITE_INK } }] }) });
    renderAt(ALL);
    await banksReady();
    const acme = bankButton('Acme bank');
    await waitFor(() => expect(images(acme).length).toBeGreaterThan(0));
    const image = images(acme)[0];
    Object.defineProperty(image, 'naturalWidth', { value: 40, configurable: true });
    Object.defineProperty(image, 'naturalHeight', { value: 40, configurable: true });
    fireEvent.load(image);
    // The wordmark gives way to the mark (one image), and a wide wordmark is not replaced.
    await waitFor(() => expect(images(acme)).toHaveLength(1));
    expect(images(acme)[0].getAttribute('src')).toBe(DARK_INK);
    expect(images(acme)[0].parentElement).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows the text names when the server has no logos or the providers answer fails', async () => {
    setup();
    renderAt(ALL);
    await banksReady();
    expect(images(bankButton('Acme bank'))).toHaveLength(0);
    expect(bankButton('Acme bank').querySelector('.sr-only')).toBeNull();
  });

  it('keeps the text names when the providers request fails, and asks for the logos once', async () => {
    const api = setup({ finance: withLogos(), fail: ['financeProviders'] });
    renderAt(ALL);
    await banksReady();
    expect(images(bankButton('Acme bank'))).toHaveLength(0);
    expect(bankButton('Acme bank')).toHaveTextContent('Acme bank');
    expect(api.callsTo('GET', '/finance/providers')).toHaveLength(1);
    expect(api.callsTo('GET', '/finance/accounts').every((call) => !call.url.includes('logo'))).toBe(true);
  });
});

describe('the Money page: where it lives', () => {
  it('is Russian by default, with the personal skin and the Personal pill current', async () => {
    setup({}, 'ru');
    renderAt(ALL);
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
    renderAt(ALL);
    expect(within(main()).getByText('Деньги доступны только на реальных данных.')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('has a way back to the personal space', async () => {
    setup();
    renderAt(ALL);
    expect(await within(main()).findByRole('link', { name: 'Back to Personal' })).toHaveAttribute('href', '/dashboards/personal');
  });
});

describe('the personal Work and income tab', () => {
  const now = () => new Date();
  const thisMonth = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60000).toISOString();
  const lastMonth = () => {
    const first = new Date(now().getFullYear(), now().getMonth(), 1, 12, 0, 0);
    return new Date(first.getTime() - 24 * 3600000).toISOString();
  };
  const income = (id: string, bookedAt: string, amount: number, extra: Record<string, unknown> = {}) => tx(id, 'a-current', 0, amount, id, { booked_at: bookedAt, category: 'income', ...extra });
  const data = () =>
    finance({
      transactions: [
        income('Salary', thisMonth(10), 250000, { counterparty: 'Example Ltd' }),
        income('Refund', thisMonth(60), 3000),
        income('Dollars', thisMonth(120), 40000, { currency: 'USD' }),
        income('Own move', thisMonth(130), 90000, { internal_transfer: true }),
        income('Bounced', thisMonth(140), 70000, { declined: true }),
        income('Last month pay', lastMonth(), 250000),
        tx('Spend', 'a-current', 5, -500, 'Spend', { category: 'groceries' }),
      ],
    });

  async function openTab(options: FakeApiOptions = {}) {
    const api = setup({ finance: data(), ...options });
    const user = userEvent.setup();
    renderAt('/dashboards/personal');
    await user.click(await within(main()).findByRole('tab', { name: /^Work and income/ }));
    return { api, user };
  }

  it('shows this month\'s income per currency and the latest incoming, leaving out spending, own transfers and declined payments', async () => {
    const { api } = await openTab();
    const month = within(await within(main()).findByRole('region', { name: 'Income this month' }));
    await month.findByText('£2,530.00');
    expect(month.getByText('$400.00')).toBeInTheDocument();
    expect(month.queryByText(/£7/)).toBeNull();
    const latest = within(main().querySelector('[aria-labelledby="income-latest-title"]') as HTMLElement);
    const rows = latest.getAllByRole('listitem').map((row) => row.textContent ?? '');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatch(/Example Ltd.*Money in: \+£2,500\.00/);
    expect(rows[1]).toContain('Refund');
    expect(rows[2]).toContain('Dollars');
    expect(rows[3]).toContain('Last month pay');
    expect(latest.queryByText('Own move')).toBeNull();
    expect(latest.queryByText('Bounced')).toBeNull();
    expect(latest.queryByText('Spend')).toBeNull();
    // Each row names its bank and account.
    await waitFor(() => expect(latest.getAllByRole('listitem')[0]).toHaveTextContent('Acme bank · Everyday'));
    // It asked the server for income from the first of this month.
    const call = api.callsTo('GET', '/finance/transactions').find((entry) => entry.url.includes('category=income'));
    expect(call?.url).toMatch(/from=\d{4}-\d{2}-01/);
    expect(latest.getByRole('link', { name: 'All transactions in Money' })).toHaveAttribute('href', PATH);
  });

  it('says there is no income when there is none, and has an error with a retry', async () => {
    const { api, user } = await openTab({ finance: finance({ transactions: [tx('Spend', 'a-current', 5, -500, 'Spend', { category: 'groceries' })] }) });
    expect(await within(main()).findAllByText('No income yet.')).toHaveLength(2);
    expect(api.callsTo('GET', '/finance/transactions').length).toBeGreaterThan(0);
    void user;
  });

  it('shows an error with a retry when the transactions cannot be read', async () => {
    const { api, user } = await openTab({ fail: ['financeTransactions'] });
    const month = within(await within(main()).findByRole('region', { name: 'Income this month' }));
    expect(await month.findByRole('alert')).toHaveTextContent('Could not load the income.');
    api.fail.delete('financeTransactions');
    await user.click(month.getByRole('button', { name: 'Try again' }));
    expect(await month.findByText('£2,530.00')).toBeInTheDocument();
  });
});

describe('the Money page: pictures that cannot be loaded', () => {
  const DARK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const WHITE = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';

  it('falls back to the bank\'s name at once when its wordmark fails to load, not a broken-image box', async () => {
    setup({ finance: finance({ providers: [{ id: 'acme-bank', logo: { on_light: DARK, on_dark: WHITE } }] }) });
    renderAt(ALL);
    await banksReady();
    const card = bankButton('Acme bank');
    await waitFor(() => expect(card.querySelectorAll('img').length).toBeGreaterThan(0));
    fireEvent.error(card.querySelector('img') as HTMLImageElement);
    await waitFor(() => expect(card.querySelectorAll('img')).toHaveLength(0));
    expect(card).toHaveTextContent('Acme bank');
  });
});
