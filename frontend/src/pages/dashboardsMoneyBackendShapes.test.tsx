import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '../context/ThemeContext';
import App from '../App';
import { resetBootstrap } from '../services/dashboards/bootstrapStore';
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
    renderAt(PATH);
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
    renderAt(PATH);
    const panel = await attentionPanel();
    expect(cardOf(panel, 'k1')).toHaveTextContent('Acme Bank');
    expect(cardOf(panel, 'k1')).toHaveTextContent('not read for 30 h');
    await user.click(cardOf(panel, 'k1'));
    const dialog = within(await screen.findByRole('dialog', { name: 'Acme Bank' }));
    expect(dialog.getByText('The balances of Acme Bank have not been read for 30 h (last read Nov 22, 2026).')).toBeInTheDocument();
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
    renderAt(PATH);
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
    renderAt(PATH);
    const panel = within(await within(main()).findByRole('region', { name: 'Upcoming payments' }));
    const headings = (await panel.findAllByRole('heading', { level: 3 })).map((heading) => heading.textContent);
    expect(headings).toEqual(['Overdue since Nov 20', 'Today']);
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
    renderAt(PATH);
    const panel = within(await within(main()).findByRole('region', { name: 'Spend by category' }));
    // £100 against £200 by the same day last month: 50% less, not 75% less than the whole of it.
    expect(await panel.findByText(/50% less than October by Oct 24, 2026/)).toBeInTheDocument();
    expect(panel.getByText(/by Oct 24, 2026 was £200\.00/)).toBeInTheDocument();
    expect(panel.queryByText(/was £400\.00/)).toBeNull();
  });

  it('falls back to the whole month before when the answer has no month-to-date figure', async () => {
    setup({ finance: { categories: categories(null) } });
    renderAt(PATH);
    const panel = within(await within(main()).findByRole('region', { name: 'Spend by category' }));
    expect(await panel.findByText(/75% less than October/)).toBeInTheDocument();
    expect(panel.getByText(/was £400\.00/)).toBeInTheDocument();
  });
});

describe('the Money page: when the data was read', () => {
  it('says the newest read as updated, warns when an API bank has gone quiet, and refreshes from its own button', async () => {
    const api = setup({
      finance: {
        connections: [{ id: 'c-1', provider: 'acme-bank', status: 'ok', last_ok_at: '2026-11-20T09:00:00Z', stale: true, stale_since: '2026-11-20T09:00:00Z' }],
        summary: { month: '2026-11', as_of: '2026-11-20T09:00:00Z', as_of_newest: '2026-11-24T10:30:00Z', as_of_oldest: '2026-11-20T09:00:00Z', currencies: [{ currency: 'GBP', accounts: 1, balance: 45050, own_balance: 45050, spent: 0, received: 0 }] },
      },
    });
    const user = userEvent.setup();
    renderAt(PATH);
    const sub = (await screen.findByRole('heading', { level: 1 })).parentElement as HTMLElement;
    await waitFor(() => expect(sub).toHaveTextContent(/updated Nov 24/));
    expect(sub).not.toHaveTextContent(/updated Nov 20/);
    expect(sub).toHaveTextContent('A bank has not been read since Nov 20');
    const before = api.callsTo('GET', '/finance/summary').length;
    await user.click(within(sub).getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(api.callsTo('GET', '/finance/summary').length).toBeGreaterThan(before));
    expect(await within(sub).findByRole('button', { name: 'Refresh' })).toBeEnabled();
  });
});
