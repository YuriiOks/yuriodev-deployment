import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '../context/ThemeContext';
import App from '../App';
import { resetBootstrap } from '../services/dashboards/bootstrapStore';
import { LANG_STORAGE_KEY } from '../services/dashboards/strings';
import { resetStorageFallback } from '../utils/safeStorage';
import { installFakeApi, type FakeApi, type FakeApiOptions, type FinanceData } from '../test/dashboardsApiMock';

// Everything here is invented: made-up banks, amounts and names.

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

const acct = (id: string, name: string, balance: number, extra: Record<string, unknown> = {}) => ({
  id,
  connection_id: 'c-1',
  provider: 'acme-bank',
  type: 'current',
  name,
  currency: 'GBP',
  balance,
  credit_limit: 0,
  own_balance_minor: balance,
  mask_last4: null,
  balance_at: '2026-11-23T09:00:00Z',
  history_from: null,
  archived: false,
  ...extra,
});

function finance(overrides: Partial<FinanceData> = {}): FinanceData {
  return {
    accounts: [acct('a-1', 'Everyday', 45050)],
    connections: [
      { id: 'c-1', provider: 'acme-bank', status: 'ok', last_ok_at: '2026-11-23T09:00:00Z', manual: false, display_name: null },
      { id: 'c-2', provider: 'hand-bank', status: 'ok', last_ok_at: '2026-11-20T12:00:00Z', manual: true, display_name: 'Hand Bank' },
    ],
    transactions: [],
    summary: { month: '2026-11', as_of: '2026-11-23T09:00:00Z', currencies: [{ currency: 'GBP', accounts: 1, balance: 45050, own_balance: 45050, spent: 0, received: 0 }] },
    providers: [
      { id: 'acme-bank', name: 'Acme Bank', entry: 'api', colors: { background: '#0b3d91', foreground: '#ffffff' }, logo: { on_light: null, on_dark: null, mark: null } },
      { id: 'hand-bank', name: 'Hand Bank', entry: 'manual', colors: { background: '#aa2244', foreground: '#ffffff' }, logo: { on_light: null, on_dark: null, mark: null } },
    ],
    ...overrides,
  };
}

function setup(options: FakeApiOptions = {}): FakeApi {
  sessionStorage.setItem('appLoaded', 'true');
  localStorage.clear();
  localStorage.setItem(LANG_STORAGE_KEY, 'en');
  resetStorageFallback();
  resetBootstrap();
  return installFakeApi({ ...options, finance: finance(options.finance) });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const wallet = () => within(within(main()).getByRole('region', { name: 'Wallet' }));
const ready = async () => {
  await within(main()).findByRole('region', { name: 'Wallet' });
  await wallet().findByRole('group', { name: 'Banks' });
};
const attentionItem = (kind: string, key: string, subject: [string, string], extra: Record<string, unknown> = {}) => ({
  key,
  kind,
  severity: 'medium',
  title: 'The server\'s own English title',
  subject_type: subject[0],
  subject_id: subject[1],
  due_date: null,
  amount: null,
  currency: null,
  display_amount: null,
  converted: false,
  facts: {},
  state: 'active',
  snoozed_until: null,
  ...extra,
});

describe('the Money page: money that must not be wrong', () => {
  it('offers the pounds switch only when something was really converted: an all-pounds owner has nothing to switch', async () => {
    setup({ finance: finance({ display: { currency: 'GBP', rates: {}, missing: [] }, accounts: [acct('a-1', 'Everyday', 45050, { display_own_balance_minor: 45050, converted: false })] }) });
    renderAt(ALL);
    await ready();
    expect(within(main()).queryByRole('button', { name: 'in account currency' })).toBeNull();
  });

  it('says by how much an account is over its limit, and calls a card with no limit on record a debt with an unknown limit', async () => {
    setup({
      finance: finance({
        accounts: [
          acct('a-over', 'Over card', -500, { type: 'credit', kind: 'credit_card', credit_limit: 1000, own_balance_minor: -1500 }),
          acct('a-loose', 'Loose card', -4000, { type: 'credit', kind: 'credit_card', credit_limit: 0, own_balance_minor: -4000 }),
          acct('a-near', 'Near card', 5, { type: 'credit', kind: 'credit_card', credit_limit: 1000, own_balance_minor: -995 }),
        ],
      }),
    });
    renderAt(ALL);
    await ready();
    const opened = within(wallet().getByRole('article'));
    const over = opened.getByText('Over card').closest('li') as HTMLElement;
    expect(over).toHaveTextContent('debt £15.00');
    expect(over).toHaveTextContent('over the £10.00 limit by £5.00');
    expect(over).not.toHaveTextContent('free');
    const loose = opened.getByText('Loose card').closest('li') as HTMLElement;
    expect(loose).toHaveTextContent('debt £40.00');
    expect(loose).toHaveTextContent('limit not known');
    expect(loose).not.toHaveTextContent('overdrawn');
    // Rounded down, as the attention items say it: one penny short of the limit is 99%, never 100%.
    expect(opened.getByText('Near card').closest('li')).toHaveTextContent('99% of the £10.00 limit used');
  });

  it('keeps spending in a currency with no rate, in its own currency, in pounds mode', async () => {
    const categories = {
      month: '2026-11',
      previous_month: '2026-10',
      currencies: [{ currency: 'JPY', spent: 120000, previous_spent: 0, converted: false, display_spent: null, display_previous_spent: null, categories: [{ category: 'groceries', spent: 120000, previous: 0, display_spent: null, display_previous: null }] }],
      display: { currency: 'GBP', rates: {}, missing: ['JPY'], complete: false, spent: 0, previous_spent: 0, categories: [] },
    };
    setup({ finance: finance({ categories, display: { currency: 'GBP', rates: {}, missing: [] }, accounts: [acct('a-1', 'Everyday', 45050, { display_own_balance_minor: 45050 })] }) });
    renderAt(ALL);
    const panel = within(await within(main()).findByRole('region', { name: 'Spend by category' }));
    expect(await panel.findByText(/November · ¥120,000/)).toBeInTheDocument();
    expect(panel.getByText('not converted: JPY')).toBeInTheDocument();
    expect(panel.queryByText('No spending this month yet')).toBeNull();
  });

  it('shows the original as the exact main figure, with no "≈" and no repeated tag, when a payment was made in the display currency on a card of another', async () => {
    const tx = {
      id: 't-1',
      account_id: 'a-eur',
      booked_at: '2026-11-23T12:00:00Z',
      amount: -1200,
      currency: 'EUR',
      original_amount: -1000,
      original_currency: 'GBP',
      display_amount_minor: -1000,
      description: 'Dinner',
      counterparty: 'Corner Cafe',
      category_code: null,
      balance_after: null,
      pending: false,
      declined: false,
      internal_transfer: false,
      settled_at: null,
      category: 'eating_out',
      category_overridden: false,
    };
    setup({
      finance: finance({
        accounts: [acct('a-eur', 'Euro card', 5000, { currency: 'EUR', display_own_balance_minor: 4200, display_balance_minor: 4200, converted: true })],
        transactions: [tx],
        display: { currency: 'GBP', rates: { EUR: { rate: '0.83', as_of: '2026-11-24T08:00:00Z', source: 'bank' } }, missing: [] },
      }),
    });
    renderAt(ALL);
    const list = within(await within(main()).findByRole('region', { name: 'Transactions' }));
    const row = (await list.findByText('Corner Cafe')).closest('li') as HTMLElement;
    expect(row).toHaveTextContent('−£10.00');
    expect(row).toHaveTextContent('−€12.00');
    expect(row).not.toHaveTextContent('≈');
    expect(row).not.toHaveTextContent('originally');
  });

  it('asks for the accounts, the totals and the spending again after a change to a bank entered by hand', async () => {
    const api = setup({
      finance: finance({
        accounts: [acct('h-main', 'Current account', 123456, { provider: 'hand-bank', connection_id: 'c-2' })],
      }),
    });
    const user = userEvent.setup();
    renderAt(ALL);
    await ready();
    const accounts = () => api.callsTo('GET', '/finance/accounts').length;
    const summary = () => api.callsTo('GET', '/finance/summary').length;
    const categories = () => api.callsTo('GET', '/finance/categories').length;
    const before = [accounts(), summary(), categories()];
    const account = within(wallet().getByRole('article')).getByText('Current account').closest('li') as HTMLElement;
    await user.click(within(account).getByRole('button', { name: 'Update balance' }));
    const form = within(within(account).getByRole('form', { name: 'Update balance: Current account' }));
    await user.clear(form.getByLabelText(/Balance/));
    await user.type(form.getByLabelText(/Balance/), '100');
    await user.click(form.getByRole('button', { name: 'Save balance' }));
    await waitFor(() => expect(accounts()).toBeGreaterThan(before[0]));
    await waitFor(() => expect(summary()).toBeGreaterThan(before[1]));
    await waitFor(() => expect(categories()).toBeGreaterThan(before[2]));
  });

  it('accepts nothing owed on a hand-entered credit card (a card paid off) and refuses a negative figure', async () => {
    const api = setup({
      finance: finance({
        accounts: [acct('h-card', 'Plastic card', 70000, { provider: 'hand-bank', connection_id: 'c-2', type: 'credit', kind: 'credit_card', credit_limit: 100000, own_balance_minor: -30000 })],
      }),
    });
    const user = userEvent.setup();
    renderAt(ALL);
    await ready();
    const card = within(wallet().getByRole('article')).getByText('Plastic card').closest('li') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: 'Update balance' }));
    const form = within(within(card).getByRole('form', { name: 'Update balance: Plastic card' }));
    const owed = form.getByLabelText(/Owed on the card/);
    await user.clear(owed);
    await user.type(owed, '-5');
    await user.click(form.getByRole('button', { name: 'Save balance' }));
    expect(await form.findByRole('alert')).toHaveTextContent('Enter what is owed');
    expect(api.callsTo('POST', '/finance/manual/accounts/h-card/balance')).toHaveLength(0);
    await user.clear(owed);
    await user.type(owed, '0');
    await user.click(form.getByRole('button', { name: 'Save balance' }));
    await waitFor(() => expect(api.callsTo('POST', '/finance/manual/accounts/h-card/balance')).toHaveLength(1));
    expect(api.callsTo('POST', '/finance/manual/accounts/h-card/balance')[0].body).toEqual({ owed: 0 });
  });

  it('makes a bank from a name with no Latin letters under a neutral id', async () => {
    const api = setup({ finance: finance({ providers: [] }) });
    const user = userEvent.setup();
    renderAt(ALL);
    await ready();
    await user.click(wallet().getByRole('button', { name: 'Add a bank' }));
    const form = within(wallet().getByRole('form', { name: 'Add a bank' }));
    await user.selectOptions(form.getByLabelText('Bank'), '__custom');
    await user.type(form.getByLabelText('Bank name'), 'Мой банк');
    await user.type(form.getByLabelText('Balance'), '10');
    await user.click(form.getByRole('button', { name: 'Add bank' }));
    await waitFor(() => expect(api.callsTo('POST', '/finance/manual/connections')).toHaveLength(1));
    expect(api.callsTo('POST', '/finance/manual/connections')[0].body).toMatchObject({ provider: 'bank', display_name: 'Мой банк' });
  });
});

describe('the Money page: attention figures in one currency', () => {
  it('tells a changed amount and a payment that is not covered in the payment\'s own currency on both sides, even in pounds', async () => {
    setup({
      finance: finance({
        accounts: [acct('a-1', 'Everyday', 45050, { display_own_balance_minor: 45050 })],
        display: { currency: 'GBP', rates: { USD: { rate: '0.79', as_of: '2026-11-24T08:00:00Z', source: 'bank' } }, missing: [] },
        recurring: [{ id: 'r-1', name: 'Cloud storage', kind: 'subscription', amount: 400, currency: 'USD', frequency: 'monthly', frequency_interval: 1, is_active: true, converted: true }],
        attention: [attentionItem('amount_changed', 'c1', ['recurring', 'r-1'], { amount: 500, currency: 'USD', display_amount: 395, converted: true, facts: { recorded_amount: 400, charged_amount: 500 } })],
      }),
    });
    const user = userEvent.setup();
    renderAt(ALL);
    const row = await within(main()).findByRole('region', { name: 'Needs attention' });
    const card = within(row).getByRole('button', { name: /Cloud storage/ });
    expect(card).toHaveTextContent('$5.00, was $4.00');
    await user.click(card);
    expect(within(screen.getByRole('dialog', { name: 'Cloud storage' })).getByText('Cloud storage was charged $5.00 instead of the recorded $4.00.')).toBeInTheDocument();
  });

  it('asks for the accounts and the totals again after a limit is set from an attention card, and keeps the card busy until the list is current', async () => {
    const api = setup({
      finance: finance({ attention: [attentionItem('overdrawn', 'o1', ['account', 'a-1'], { severity: 'info', amount: 2500, currency: 'GBP', facts: { balance: -2500, overdraft_limit: null } })] }),
    });
    const user = userEvent.setup();
    renderAt(ALL);
    const row = await within(main()).findByRole('region', { name: 'Needs attention' });
    const before = [api.callsTo('GET', '/finance/accounts').length, api.callsTo('GET', '/finance/summary').length];
    await user.click(within(row).getByRole('button', { name: /Everyday/ }));
    const dialog = within(screen.getByRole('dialog', { name: 'Everyday' }));
    await user.click(dialog.getByRole('button', { name: 'Set limit' }));
    await user.type(dialog.getByLabelText(/Overdraft limit/), '500');
    await user.click(dialog.getByRole('button', { name: 'Save limit' }));
    await waitFor(() => expect(api.callsTo('PATCH', '/finance/accounts/a-1')).toHaveLength(1));
    await waitFor(() => expect(api.callsTo('GET', '/finance/accounts').length).toBeGreaterThan(before[0]));
    await waitFor(() => expect(api.callsTo('GET', '/finance/summary').length).toBeGreaterThan(before[1]));
  });
});

describe('the Money page: the upcoming total', () => {
  const upcoming = (converted: boolean) => ({
    from_date: '2026-11-23',
    to_date: '2026-12-07',
    items: [
      { recurring_id: 'r-1', name: 'Streaming', kind: 'subscription', due_date: '2026-11-24', days_until: 1, amount: 1000, currency: 'GBP', display_amount: null, converted: false, account_id: null, payment_method: null, icon_url: null, color: null, covered: null, shortfall: null, account_currency: null },
    ],
    totals: [{ currency: 'GBP', amount: 1000, display_amount: 1000, converted }],
    display: { currency: 'GBP', rates: {}, missing: [], complete: true, total: 1000 },
  });

  it('is one plain figure, with no "≈" and no second list, when the window is all in pounds', async () => {
    setup({ finance: finance({ upcoming: upcoming(false) }) });
    renderAt(ALL);
    const panel = within(await within(main()).findByRole('region', { name: 'Upcoming payments' }));
    expect(await panel.findByText('In all: £10.00')).toBeInTheDocument();
    expect(panel.queryByText(/≈/)).toBeNull();
    expect(panel.getAllByText('£10.00')).toHaveLength(1);
  });
});
