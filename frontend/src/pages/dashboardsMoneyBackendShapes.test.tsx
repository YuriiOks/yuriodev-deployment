import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '../context/ThemeContext';
import App from '../App';
import { resetBootstrap } from '../services/dashboards/bootstrapStore';
import { iconBundles, logoBundles } from '../services/dashboards/imageBundles';
import { parseRecurring, parseUpcoming } from '../services/dashboards/recurringApi';
import { LANG_STORAGE_KEY } from '../services/dashboards/strings';
import { resetStorageFallback } from '../utils/safeStorage';
import { installFakeApi, type FakeApi, type FakeApiOptions, type FinanceData } from '../test/dashboardsApiMock';

// Everything here is invented: made-up banks, payments and amounts. These tests follow the shapes the finance API gained in its audit
// (a paid call with the due date, items that name their subject, overdue payments, month-to-date categories, newest and oldest reads).

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

const account = (extra: Record<string, unknown> = {}) => ({
  id: 'a-current',
  connection_id: 'c-1',
  provider: 'acme-bank',
  type: 'current',
  name: 'Everyday',
  currency: 'GBP',
  balance: 45050,
  credit_limit: 0,
  own_balance_minor: 45050,
  mask_last4: null,
  balance_at: '2026-11-24T09:00:00Z',
  history_from: null,
  archived: false,
  ...extra,
});

const payment = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  kind: 'subscription',
  amount: 999,
  currency: 'GBP',
  frequency: 'monthly',
  frequency_interval: 1,
  start_date: '2026-01-05',
  next_payment_date: '2026-12-05',
  is_active: true,
  account_id: null,
  payment_method: null,
  match_text: null,
  icon_url: null,
  color: null,
  is_installment: false,
  creditor: null,
  converted: false,
  ...extra,
});

const attentionItem = (kind: string, key: string, subject: [string, string], extra: Record<string, unknown> = {}) => ({
  key,
  kind,
  severity: 'medium',
  title: "The server's own English title",
  subject_type: subject[0],
  subject_id: subject[1],
  subject_name: null,
  provider: null,
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

function finance(overrides: Partial<FinanceData> = {}): FinanceData {
  return {
    accounts: [account()],
    connections: [{ id: 'c-1', provider: 'acme-bank', status: 'ok', last_ok_at: '2026-11-24T09:00:00Z' }],
    transactions: [],
    summary: { month: '2026-11', as_of: '2026-11-24T09:00:00Z', currencies: [{ currency: 'GBP', accounts: 1, balance: 45050, own_balance: 45050, spent: 0, received: 0 }] },
    ...overrides,
  };
}

function setup(options: FakeApiOptions & { lang?: 'ru' | 'en' } = {}): FakeApi {
  sessionStorage.setItem('appLoaded', 'true');
  localStorage.clear();
  localStorage.setItem(LANG_STORAGE_KEY, options.lang ?? 'en');
  resetStorageFallback();
  resetBootstrap();
  return installFakeApi({ ...options, finance: finance(options.finance) });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const attentionPanel = async () => within(await within(main()).findByRole('region', { name: 'Needs attention' }));
const cardOf = (panel: ReturnType<typeof within>, key: string) => panel.getAllByRole('button').find((button) => button.getAttribute('data-key') === key) as HTMLElement;

describe('the Money page: marking a payment paid', () => {
  it('sends the due date the page showed, and when the payment has already moved on it refreshes and says so instead of retrying', async () => {
    const api = setup({
      finance: {
        recurring: [payment('r-1', 'Streaming')],
        attention: [attentionItem('missed_payment', 'k1', ['recurring', 'r-1'], { subject_name: 'Streaming', due_date: '2026-12-01', amount: 999, currency: 'GBP', severity: 'high', facts: { days_overdue: 2 } })],
      },
    });
    const user = userEvent.setup();
    renderAt(ALL);
    await user.click(cardOf(await attentionPanel(), 'k1'));
    const dialog = within(await screen.findByRole('dialog', { name: 'Streaming' }));
    await user.click(dialog.getByRole('button', { name: 'Mark paid' }));
    await waitFor(() => expect(api.callsTo('POST', '/finance/recurring/r-1/paid')).toHaveLength(1));
    expect(api.callsTo('POST', '/finance/recurring/r-1/paid')[0].body).toEqual({ due_date: '2026-12-01' });
    // The server says 409 (its next date is Dec 5, not Dec 1): told once, the sheet stays, nothing is sent again.
    expect(await dialog.findByRole('alert')).toHaveTextContent('The payment has already changed');
    expect(api.callsTo('POST', '/finance/recurring/r-1/paid')).toHaveLength(1);
    await waitFor(() => expect(api.callsTo('GET', '/finance/recurring').length).toBeGreaterThan(1));
  });
});

describe('the Money page: attention items that name their own subject', () => {
  it('tells a bank that has not been read for hours from the item alone, with no account to join', async () => {
    setup({
      finance: {
        accounts: [],
        attention: [attentionItem('stale_connection', 'k1', ['connection', 'conn-9'], { subject_name: 'Acme Bank', provider: 'acme-bank', severity: 'high', facts: { provider: 'acme-bank', since: '2026-11-22', hours_old: 30, last_error: 'timeout' } })],
      },
    });
    const user = userEvent.setup();
    renderAt(ALL);
    const panel = await attentionPanel();
    expect(cardOf(panel, 'k1')).toHaveTextContent('Acme Bank');
    expect(cardOf(panel, 'k1')).toHaveTextContent('not read for 30 h');
    await user.click(cardOf(panel, 'k1'));
    const dialog = within(await screen.findByRole('dialog', { name: 'Acme Bank' }));
    expect(dialog.getByText('The balances of Acme Bank have not been read for 30 h (last read 22 Nov 2026).')).toBeInTheDocument();
    expect(dialog.getByRole('link', { name: 'Open bank' })).toBeInTheDocument();
    // The raw error kind is not shown.
    expect(dialog.queryByText(/timeout/)).toBeNull();
  });

  it('says that a bank has no data yet, in its own words, instead of the server title', async () => {
    setup({
      finance: {
        accounts: [],
        attention: [attentionItem('stale_statement', 'k2', ['connection', 'conn-8'], { subject_name: 'Hand Bank', provider: 'hand-bank', facts: { provider: 'hand-bank', as_of: null, days_old: null, no_data: true } })],
      },
    });
    const user = userEvent.setup();
    renderAt(ALL);
    await user.click(cardOf(await attentionPanel(), 'k2'));
    const dialog = within(await screen.findByRole('dialog', { name: 'Hand Bank' }));
    expect(dialog.getByText('No data yet for Hand Bank: set a balance or upload a statement.')).toBeInTheDocument();
    expect(dialog.queryByText("The server's own English title")).toBeNull();
  });
});

describe('the Money page: upcoming payments that are already late', () => {
  it('lists an overdue payment first as overdue, not as today, and says what the account is short in all', async () => {
    setup({
      finance: {
        recurring: [payment('r-1', 'Streaming'), payment('r-2', 'Gym')],
        upcoming: {
          from_date: '2026-11-24',
          to_date: '2026-12-07',
          items: [
            { recurring_id: 'r-1', name: 'Streaming', kind: 'subscription', due_date: '2026-11-20', days_until: -4, amount: 999, currency: 'GBP', display_amount: null, converted: false, account_id: 'a-current', payment_method: null, icon_url: null, color: null, covered: true, shortfall: null, account_short_total: null, account_currency: 'GBP', overdue: true },
            { recurring_id: 'r-2', name: 'Gym', kind: 'subscription', due_date: '2026-11-24', days_until: 0, amount: 2500, currency: 'GBP', display_amount: null, converted: false, account_id: 'a-current', payment_method: null, icon_url: null, color: null, covered: false, shortfall: 700, account_short_total: 1200, account_currency: 'GBP', overdue: false },
          ],
          totals: [{ currency: 'GBP', amount: 3499, display_amount: null, converted: false }],
        },
      },
    });
    renderAt(ALL);
    const panel = within(await within(main()).findByRole('region', { name: 'Upcoming payments' }));
    const headings = (await panel.findAllByRole('heading', { level: 3 })).map((heading) => heading.textContent);
    expect(headings).toEqual(['Overdue since 20 Nov', 'Today']);
    const rows = panel.getAllByRole('listitem').filter((row) => row.getAttribute('data-covered'));
    expect(rows[0]).toHaveAttribute('data-overdue', 'true');
    expect(rows[1]).not.toHaveAttribute('data-overdue');
    // This payment's own missing part, then the account's whole gap.
    expect(rows[1]).toHaveTextContent('short by £7.00');
    expect(rows[1]).toHaveTextContent('the account is short £12.00 in all, counting earlier payments');
  });
});

describe('the Money page: spend by category, month to date', () => {
  const categories = (day: string | null) => ({
    month: '2026-11',
    previous_month: '2026-10',
    previous_to_date_day: day,
    currencies: [
      {
        currency: 'GBP',
        spent: 10000,
        previous_spent: 40000,
        previous_to_date_spent: day ? 20000 : null,
        converted: false,
        display_spent: null,
        display_previous_spent: null,
        display_previous_to_date_spent: null,
        categories: [{ category: 'groceries', spent: 10000, previous: 40000, previous_to_date: day ? 20000 : null, display_spent: null, display_previous: null, display_previous_to_date: null }],
      },
    ],
    display: { currency: 'GBP', rates: {}, missing: [], complete: true, spent: 10000, previous_spent: 40000, previous_to_date_spent: day ? 20000 : null, categories: [{ category: 'groceries', spent: 10000, previous: 40000, previous_to_date: day ? 20000 : null }] },
  });

  it('compares the month so far with the month before up to the same day, and keeps the full month for a month that is over', async () => {
    setup({ finance: { categories: categories('2026-10-24') } });
    renderAt(ALL);
    const panel = within(await within(main()).findByRole('region', { name: 'Spend by category' }));
    // £100 against £200 by the same day last month: 50% less, not 75% less than the whole of it.
    expect(await panel.findByText(/50% less than October by 24 Oct 2026/)).toBeInTheDocument();
    expect(panel.getByText(/by 24 Oct 2026 was £200\.00/)).toBeInTheDocument();
    expect(panel.queryByText(/was £400\.00/)).toBeNull();
  });

  it('falls back to the whole month before when the answer has no month-to-date figure', async () => {
    setup({ finance: { categories: categories(null) } });
    renderAt(ALL);
    const panel = within(await within(main()).findByRole('region', { name: 'Spend by category' }));
    expect(await panel.findByText(/75% less than October/)).toBeInTheDocument();
    expect(panel.getByText(/was £400\.00/)).toBeInTheDocument();
  });
});

describe('the Money page: when the data was read', () => {
  it('says the newest read as updated, warns when an API bank has gone quiet, and refreshes from its own button', async () => {
    // The freshness lines tell "today" and "yesterday" against now: the clock is fixed well after the dates the test uses.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-20T12:00:00Z'));
    const api = setup({
      finance: {
        connections: [{ id: 'c-1', provider: 'acme-bank', status: 'ok', last_ok_at: '2026-11-20T09:00:00Z', stale: true, stale_since: '2026-11-20T09:00:00Z' }],
        summary: { month: '2026-11', as_of: '2026-11-20T09:00:00Z', as_of_newest: '2026-11-24T10:30:00Z', as_of_oldest: '2026-11-20T09:00:00Z', currencies: [{ currency: 'GBP', accounts: 1, balance: 45050, own_balance: 45050, spent: 0, received: 0 }] },
      },
    });
    const user = userEvent.setup();
    renderAt(ALL);
    const sub = (await screen.findByRole('heading', { level: 1 })).closest('header') as HTMLElement;
    await waitFor(() => expect(sub).toHaveTextContent(/updated 24 Nov/));
    expect(sub).not.toHaveTextContent(/updated 20 Nov/);
    expect(sub).toHaveTextContent('A bank has not been read since 20 Nov');
    const before = api.callsTo('GET', '/finance/summary').length;
    await user.click(within(sub).getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(api.callsTo('GET', '/finance/summary').length).toBeGreaterThan(before));
    expect(await within(sub).findByRole('button', { name: 'Refresh' })).toBeEnabled();
  });
});

describe('the Money page: loading, error and refresh states', () => {
  it('keeps the last answer on screen when asking again fails, and says it may be out of date, with one retry', async () => {
    const api = setup({ finance: { recurring: [payment('r-1', 'Streaming')] } });
    const user = userEvent.setup();
    renderAt(`${PATH}?view=recurring`);
    const panel = within(await within(main()).findByRole('region', { name: 'Recurring payments' }));
    expect(await panel.findByText('Streaming')).toBeInTheDocument();
    api.fail.add('financeRecurring');
    await user.click(within(main()).getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Could not refresh: the last data is shown and may be out of date.')).toBeInTheDocument();
    // The list it had is still there.
    expect(panel.getByText('Streaming')).toBeInTheDocument();
    api.fail.delete('financeRecurring');
    await user.click(within(screen.getByText('Could not refresh: the last data is shown and may be out of date.').closest('[role="alert"]') as HTMLElement).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByText('Could not refresh: the last data is shown and may be out of date.')).toBeNull());
  });

  it('says so when what needs attention cannot be read, and when the totals cannot, each with a retry', async () => {
    const api = setup({ fail: ['financeAttention', 'financeSummary'] });
    const user = userEvent.setup();
    renderAt(ALL);
    expect(await screen.findByText('Could not load what needs attention.')).toBeInTheDocument();
    expect(await screen.findByText("Could not load the month's totals and the grand total.")).toBeInTheDocument();
    api.fail.delete('financeAttention');
    api.fail.delete('financeSummary');
    const alerts = screen.getAllByRole('alert');
    for (const alert of alerts) {
      const retry = within(alert).queryByRole('button', { name: 'Try again' });
      if (retry) await user.click(retry);
    }
    await waitFor(() => expect(screen.queryByText("Could not load the month's totals and the grand total.")).toBeNull());
  });

  it('keeps the 14 or 30 days choice when the upcoming payments fail, and dims the list while it is for the other window', async () => {
    const api = setup({ fail: ['financeUpcoming'] });
    const user = userEvent.setup();
    renderAt(ALL);
    const panel = within(await within(main()).findByRole('region', { name: 'Upcoming payments' }));
    expect(await panel.findByRole('alert')).toBeInTheDocument();
    // The window can be changed out of the failure.
    api.fail.delete('financeUpcoming');
    await user.click(panel.getByRole('button', { name: '30 days' }));
    await waitFor(() => expect(api.callsTo('GET', '/finance/upcoming').some((call) => call.url.includes('days=30'))).toBe(true));
  });

  it('asks again for the payments and attention when a tab that was hidden comes back after a while', async () => {
    const api = setup({ finance: { recurring: [payment('r-1', 'Streaming')] } });
    renderAt(ALL);
    await within(main()).findByRole('region', { name: 'Upcoming payments' });
    await waitFor(() => expect(api.callsTo('GET', '/finance/attention').length).toBeGreaterThan(0));
    const before = api.callsTo('GET', '/finance/attention').length;
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now');
    const setVisibility = (state: 'hidden' | 'visible') => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    clock.mockReturnValue(now);
    setVisibility('hidden');
    clock.mockReturnValue(now + 6 * 60 * 1000);
    setVisibility('visible');
    await waitFor(() => expect(api.callsTo('GET', '/finance/attention').length).toBeGreaterThan(before));
    clock.mockRestore();
  });

  it('says there are no payments yet apart from nothing matching, with a way to clear the filters, and holds the account choice until the accounts are read', async () => {
    const api = setup({ finance: { recurring: [payment('r-1', 'Streaming'), payment('r-2', 'Gym', { kind: 'service' })] }, fail: ['financeAccounts'] });
    const user = userEvent.setup();
    renderAt(`${PATH}?view=recurring`);
    const panel = within(await within(main()).findByRole('region', { name: 'Recurring payments' }));
    expect(await panel.findByText('Could not load the accounts.')).toBeInTheDocument();
    await user.click(panel.getByRole('button', { name: 'Add payment' }));
    expect(panel.getByLabelText('Paying account')).toBeDisabled();
    api.fail.delete('financeAccounts');
    await user.click(panel.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(panel.getByLabelText('Paying account')).toBeEnabled());
    await user.type(panel.getByLabelText('Search payments'), 'zzz');
    expect(await panel.findByText(/Nothing matches/)).toBeInTheDocument();
    await user.click(panel.getByRole('button', { name: 'Clear filters' }));
    expect(await panel.findByText('Streaming')).toBeInTheDocument();
  });

  it('says there are no payments at all when there are none', async () => {
    setup({ finance: { recurring: [] } });
    renderAt(`${PATH}?view=recurring`);
    const panel = within(await within(main()).findByRole('region', { name: 'Recurring payments' }));
    expect(await panel.findByText('No recurring payments yet. Add the first one.')).toBeInTheDocument();
    expect(panel.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });
});

describe('the Money page: what the backend added after the audit', () => {
  const ICON = '/api/dashboards/v1/finance/recurring/r-1/icon?v=0a1b2c3d';

  it('shows a payment\'s inlined icon, the colour tile while it is pending, and offers a website and "Refresh icon" in the form', async () => {
    const api = setup({
      finance: {
        recurring: [payment('r-1', 'Streaming', { icon_url: ICON, icon_state: 'ok', icon_error: null, website: 'streaming.example.com' }), payment('r-2', 'Gym', { icon_url: null, icon_state: 'pending', icon_error: null, color: '#3366cc' })],
      },
    });
    const user = userEvent.setup();
    renderAt(`${PATH}?view=recurring`);
    const panel = within(await within(main()).findByRole('region', { name: 'Recurring payments' }));
    const streaming = (await panel.findByText('Streaming')).closest('li') as HTMLElement;
    // The picture is given its address once it has its turn at the loader (after a render): waited for, never read at once.
    await waitFor(() => expect(streaming.querySelector('img')).toHaveAttribute('src', ICON));
    const gym = panel.getByText('Gym').closest('li') as HTMLElement;
    expect(gym.querySelector('img')).toBeNull();
    expect(gym).toHaveTextContent('G');
    await user.click(within(streaming).getByRole('button', { name: /^Actions: / }));
    await user.click(within(streaming).getByRole('menuitem', { name: 'Edit' }));
    expect(panel.getByLabelText('Website')).toHaveValue('streaming.example.com');
    await user.click(panel.getByRole('button', { name: 'Refresh icon' }));
    await waitFor(() => expect(api.callsTo('POST', '/finance/recurring/r-1/icon/refresh')).toHaveLength(1));
    await user.clear(panel.getByLabelText('Website'));
    await user.type(panel.getByLabelText('Website'), 'cdn.example.org');
    await user.click(panel.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.callsTo('PATCH', '/finance/recurring/r-1')[0]?.body).toEqual({ website: 'cdn.example.org' }));
  });

  it('reads the way to reconnect from the provider: a link for oauth, the hint only for a token', async () => {
    setup({
      finance: {
        connections: [
          { id: 'c-1', provider: 'acme-bank', status: 'needs_reconsent', last_ok_at: '2026-11-20T09:00:00Z' },
          { id: 'c-2', provider: 'globex-bank', status: 'needs_reconsent', last_ok_at: '2026-11-20T09:00:00Z' },
        ],
        accounts: [account(), account({ id: 'a-2', connection_id: 'c-2', provider: 'globex-bank', name: 'Globex main' })],
        providers: [
          { id: 'acme-bank', name: 'Acme Bank', reconnect: 'oauth', reconnect_path: '/api/dashboards/v1/finance/acme/connect' },
          { id: 'globex-bank', name: 'Globex', reconnect: 'token', reconnect_path: null },
        ],
      },
    });
    const user = userEvent.setup();
    renderAt(ALL);
    const wallet = within(await within(main()).findByRole('region', { name: 'Wallet' }));
    await user.click(await wallet.findByRole('button', { name: /Acme Bank/ }));
    for (const link of await wallet.findAllByRole('link', { name: 'Reconnect' })) expect(link).toHaveAttribute('href', '/api/dashboards/v1/finance/acme/connect');
    await user.click(wallet.getByRole('button', { name: /Globex/ }));
    await waitFor(() => expect(wallet.queryByRole('link', { name: 'Reconnect' })).toBeNull());
  });

  it('shows the result of the bank\'s consent page once and cleans the address', async () => {
    setup();
    renderAt(`${PATH}?monzo=denied`);
    expect(await screen.findByText('Access was not approved: Monzo was refused.')).toBeInTheDocument();
    await waitFor(() => expect(window.location.search).not.toContain('monzo'));
  });

  it('hides the time of a line that had only a day, and marks a line as a move between the owner\'s own accounts', async () => {
    const api = setup({
      finance: {
        transactions: [
          { id: 't-1', account_id: 'a-current', booked_at: '2026-11-20T12:00:00Z', amount: -1500, currency: 'GBP', description: 'Statement line', counterparty: 'Corner Cafe', pending: false, declined: false, internal_transfer: false, internal_transfer_by_owner: false, time_known: false, converted: false, category: 'other' },
          { id: 't-2', account_id: 'a-current', booked_at: '2026-11-21T09:30:00Z', amount: -2500, currency: 'GBP', description: 'Card payment', counterparty: 'Fresh Market', pending: false, declined: false, internal_transfer: false, internal_transfer_by_owner: false, time_known: true, converted: false, category: 'other' },
        ],
      },
    });
    const user = userEvent.setup();
    renderAt(ALL);
    const panel = within(await within(main()).findByRole('region', { name: 'Transactions' }));
    const dayOnly = (await panel.findByText('Corner Cafe')).closest('li') as HTMLElement;
    // The day is the group's heading; a row tells only its time, and none when the bank gave only a day.
    expect(panel.getByRole('heading', { level: 3, name: /20 Nov/ })).toBeInTheDocument();
    expect(panel.getByRole('heading', { level: 3, name: /21 Nov/ })).toBeInTheDocument();
    expect(dayOnly).not.toHaveTextContent(/\d{2}:\d{2}/);
    const timed = panel.getByText('Fresh Market').closest('li') as HTMLElement;
    expect(timed).toHaveTextContent(/\d{2}:\d{2}/);
    // The move between the owner's own accounts is in the row's menu.
    expect(within(dayOnly).queryByRole('button', { name: 'Mark as a move between my accounts' })).toBeNull();
    await user.click(within(dayOnly).getByRole('button', { name: 'Actions for this line: Corner Cafe' }));
    await user.click(within(dayOnly).getByRole('button', { name: 'Mark as a move between my accounts' }));
    await waitFor(() => expect(api.callsTo('PATCH', '/finance/transactions/t-1')[0]?.body).toEqual({ internal_transfer: true }));
    const marked = (await panel.findByText('Corner Cafe')).closest('li') as HTMLElement;
    await user.click(within(marked).getByRole('button', { name: 'Actions for this line: Corner Cafe' }));
    expect(await within(marked).findByRole('button', { name: 'Not a move between my accounts' })).toBeInTheDocument();
    // The category is changed from the same menu: a note on our own copy.
    await user.selectOptions(within(marked).getByRole('combobox', { name: 'Category' }), 'groceries');
    await waitFor(() => expect(api.callsTo('PATCH', '/finance/transactions/t-1').some((call) => (call.body as { category?: string }).category === 'groceries')).toBe(true));
  });
});

describe('the Money page: payment icons by address and uploads', () => {
  it('reads the live shape of a payment icon (a path with ?v=, icon_state, icon_error) and refuses any other address', () => {
    const live = { id: 'r-1', name: 'Streaming', kind: 'subscription', amount: 999, currency: 'GBP', frequency: 'monthly', icon_url: '/api/dashboards/v1/finance/recurring/r-1/icon?v=0a1b2c3d', icon_state: 'ok', icon_error: null, website: 'streaming.example.com' };
    expect(parseRecurring(live)).toMatchObject({ iconUrl: '/api/dashboards/v1/finance/recurring/r-1/icon?v=0a1b2c3d', iconState: 'ok', iconError: null, website: 'streaming.example.com' });
    expect(parseRecurring({ ...live, icon_url: null, icon_state: 'failed', icon_error: 'timeout' })).toMatchObject({ iconUrl: null, iconState: 'failed', iconError: 'timeout' });
    for (const bad of ['/api/dashboards/v1/finance/recurring/r-1/icon?x=1', '/api/dashboards/v1/finance/recurring/../tasks/icon', '//evil.example.com/icon', 'http://x.example.com/a.png']) {
      expect(parseRecurring({ ...live, icon_url: bad })?.iconUrl, bad).toBeNull();
    }
    const upcoming = parseUpcoming({ items: [{ recurring_id: 'r-1', name: 'A', kind: 'utility', due_date: '2026-11-24', days_until: 0, amount: 100, currency: 'GBP', icon_url: live.icon_url, icon_state: 'ok', overdue: false }], totals: [] });
    expect(upcoming?.items[0].iconUrl).toBe(live.icon_url);
  });

  it('says why a fetch failed next to "Refresh icon", and uploads an icon by hand (PNG or SVG), saying a refusal in words', async () => {
    const api = setup({ finance: { recurring: [payment('r-1', 'Streaming', { icon_url: null, icon_state: 'failed', icon_error: 'timeout', website: 'streaming.example.com' })] } });
    const user = userEvent.setup({ applyAccept: false });
    renderAt(`${PATH}?view=recurring`);
    const panel = within(await within(main()).findByRole('region', { name: 'Recurring payments' }));
    const row = (await panel.findByText('Streaming')).closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: /^Actions: / }));
    await user.click(within(row).getByRole('menuitem', { name: 'Edit' }));
    expect(panel.getByText(/No icon found: the site did not answer in time/)).toBeInTheDocument();
    const input = panel.getByLabelText('Upload icon', { selector: 'input' }) as HTMLInputElement;
    // A file of a type the server refuses: its refusal is told in words.
    await user.upload(input, new File(['x'], 'icon.gif', { type: 'image/gif' }));
    expect(await panel.findByText('Send a PNG or SVG file.')).toBeInTheDocument();
    await user.upload(input, new File([new Uint8Array([137, 80, 78, 71])], 'icon.png', { type: 'image/png' }));
    await waitFor(() => expect(api.callsTo('POST', '/finance/recurring/r-1/icon').length).toBe(2));
    expect(api.callsTo('POST', '/finance/recurring/r-1/icon')[1].headers['Content-Type']).toBe('image/png');
  });
});

describe('the Money page: the recurring list is dense', () => {
  it('is one row per payment ordered by its next date, with Edit and Deactivate in a row-end menu that Escape closes', async () => {
    setup({
      finance: {
        recurring: [payment('r-1', 'Later', { next_payment_date: '2026-12-20' }), payment('r-2', 'Sooner', { next_payment_date: '2026-12-02' }), payment('r-3', 'No date', { next_payment_date: null, frequency: 'once', start_date: null, is_active: true })],
      },
    });
    const user = userEvent.setup();
    renderAt(`${PATH}?view=recurring`);
    const panel = within(await within(main()).findByRole('region', { name: 'Recurring payments' }));
    const names = () => panel.getAllByRole('listitem').filter((row) => row.getAttribute('data-payment')).map((row) => row.querySelector('strong')?.textContent);
    await waitFor(() => expect(names()).toEqual(['Sooner', 'Later', 'No date']));
    await user.selectOptions(panel.getByLabelText('Sort'), 'name');
    expect(names()).toEqual(['Later', 'No date', 'Sooner']);
    // The buttons are in the menu, not on the row.
    const row = panel.getByText('Sooner').closest('li') as HTMLElement;
    expect(within(row).queryByRole('button', { name: 'Edit' })).toBeNull();
    const opener = within(row).getByRole('button', { name: 'Actions: Sooner' });
    await user.click(opener);
    expect(opener).toHaveAttribute('aria-expanded', 'true');
    expect(within(row).getByRole('menuitem', { name: 'Deactivate' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(within(row).queryByRole('menu')).toBeNull();
    expect(opener).toHaveFocus();
  });
});

describe('the Money page: logos and icons from the bundles', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgo=';
  const SVG = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
  const V = 'e6140d0d0a1b2c3d';
  const path = '/api/dashboards/v1/finance/providers/acme-bank/logo/on_dark?v=e6140d0d';

  afterEach(() => {
    logoBundles.reset();
    iconBundles.reset();
  });

  it('draws a bank\'s logo from the logo bundle in one request, never from its own address', async () => {
    logoBundles.reset();
    const api = setup({
        finance: {
          providers: [{ id: 'acme-bank', name: 'Acme Bank', logo: { on_light: path, on_dark: path, mark: path } }],
          logosBundle: { version: V, logos: { 'acme-bank': { on_light: SVG, on_dark: SVG, mark: PNG } } },
        },
      });
    renderAt(`${PATH}?view=wallet`);
    const wallet = within(await within(main()).findByRole('region', { name: 'Wallet' }));
    // Every picture of the card ends up drawn from a data URI of the bundle (the listing's own addresses are replaced, not requested).
    await waitFor(() => {
      const images = Array.from(wallet.getByRole('button', { name: /Acme Bank/ }).querySelectorAll('img'));
      expect(images.length).toBeGreaterThan(0);
      for (const image of images) expect(image.getAttribute('src')).toMatch(/^data:image\//);
    });
    expect(api.callsTo('GET', '/finance/providers/logos')).toHaveLength(1);
  });

  it('draws a payment\'s icon from the icon bundle, and an icon the bundle lacks from its own address', async () => {
    const own = '/api/dashboards/v1/finance/recurring/r-2/icon?v=0a1b2c3d';
    const api = setup({
      finance: {
        recurring: [payment('r-1', 'Streaming', { icon_url: null, icon_state: 'ok' }), payment('r-2', 'Gym', { icon_url: own, icon_state: 'ok' })],
        iconsBundle: { version: V, icons: { 'r-1': PNG } },
      },
    });
    renderAt(`${PATH}?view=recurring`);
    const panel = within(await within(main()).findByRole('region', { name: 'Recurring payments' }));
    const streaming = (await panel.findByText('Streaming')).closest('li') as HTMLElement;
    await waitFor(() => expect(streaming.querySelector('img')).toHaveAttribute('src', PNG));
    const gym = panel.getByText('Gym').closest('li') as HTMLElement;
    await waitFor(() => expect(gym.querySelector('img')).toHaveAttribute('src', own));
    expect(api.callsTo('GET', '/finance/recurring/icons')).toHaveLength(1);
  });

  it('keeps today\'s behaviour when the server names no version', async () => {
    const api = setup({ finance: { providers: [{ id: 'acme-bank', name: 'Acme Bank', logo: { on_light: SVG, on_dark: SVG } }] } });
    renderAt(`${PATH}?view=wallet`);
    const wallet = within(await within(main()).findByRole('region', { name: 'Wallet' }));
    await waitFor(() => expect(wallet.getByRole('button', { name: /Acme Bank/ }).querySelector('img')).not.toBeNull());
    expect(api.callsTo('GET', '/finance/providers/logos')).toHaveLength(0);
    expect(api.callsTo('GET', '/finance/recurring/icons')).toHaveLength(0);
  });
});
