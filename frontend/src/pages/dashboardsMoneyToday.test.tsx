import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '../context/ThemeContext';
import App from '../App';
import { resetBootstrap } from '../services/dashboards/bootstrapStore';
import { LANG_STORAGE_KEY } from '../services/dashboards/strings';
import { resetStorageFallback } from '../utils/safeStorage';
import { installFakeApi, type FakeApi, type FakeApiOptions, type FinanceData } from '../test/dashboardsApiMock';

// Everything here is invented: made-up banks, payments and amounts.

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
  balance: 150000,
  credit_limit: 0,
  own_balance_minor: 150000,
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
  icon_state: 'none',
  icon_error: null,
  website: null,
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

const due = (id: string, name: string, dueDate: string, daysUntil: number, extra: Record<string, unknown> = {}) => ({
  recurring_id: id,
  name,
  kind: 'subscription',
  due_date: dueDate,
  days_until: daysUntil,
  amount: 1800,
  currency: 'GBP',
  display_amount: null,
  converted: false,
  account_id: null,
  payment_method: null,
  icon_url: null,
  color: null,
  covered: null,
  shortfall: null,
  account_short_total: null,
  account_currency: null,
  overdue: false,
  ...extra,
});

const line = (category: string, spent: number, previous: number, toDate: number | null) => ({ category, spent, previous, previous_to_date: toDate, display_spent: null, display_previous: null, display_previous_to_date: null });

function finance(overrides: Partial<FinanceData> = {}): FinanceData {
  return {
    accounts: [account()],
    connections: [{ id: 'c-1', provider: 'acme-bank', status: 'ok', last_ok_at: new Date(Date.now() - 5 * 60000).toISOString() }],
    transactions: [],
    summary: { month: '2026-11', as_of: '2026-11-24T09:00:00Z', currencies: [{ currency: 'GBP', accounts: 1, balance: 150000, own_balance: 150000, spent: 0, received: 0 }] },
    recurring: [payment('r-1', 'Streaming', { amount: 1999, next_payment_date: '2026-11-26' }), payment('r-2', 'Gym', { next_payment_date: '2026-11-25', amount: 1800 }), payment('r-3', 'Insurance', { next_payment_date: '2026-11-27', amount: 13400 })],
    attention: [
      attentionItem('amount_changed', 'k1', ['recurring', 'r-1'], { subject_name: 'Streaming', amount: 1999, currency: 'GBP', facts: { recorded_amount: 1299, charged_amount: 1999 } }),
      attentionItem('missed_payment', 'k2', ['recurring', 'r-2'], { subject_name: 'Gym', severity: 'high', due_date: '2026-12-05', amount: 1800, currency: 'GBP', facts: { days_overdue: 2 } }),
      attentionItem('credit_high', 'k3', ['account', 'a-current'], { subject_name: 'Everyday', provider: 'acme-bank', amount: 300000, currency: 'GBP', facts: { used_percent: 96, owed: 288000, credit_limit: 300000 } }),
      attentionItem('overdrawn', 'k4', ['account', 'a-current'], { subject_name: 'Everyday', provider: 'acme-bank', severity: 'info', amount: 5000, currency: 'GBP', facts: { balance: -5000, overdraft_limit: null } }),
    ],
    upcoming: {
      from_date: '2026-11-24',
      to_date: '2026-12-07',
      items: [due('r-2', 'Gym', '2026-11-25', 1), due('r-1', 'Streaming', '2026-11-26', 2, { amount: 1999 }), due('r-3', 'Insurance', '2026-11-27', 3, { amount: 13400 }), due('r-4', 'Rent', '2026-12-01', 7, { amount: 90000 })],
      totals: [{ currency: 'GBP', amount: 107199, display_amount: null, converted: false }],
      display: { currency: 'GBP', rates: {}, missing: [], complete: true, total: 107199 },
    },
    categories: {
      month: '2026-11',
      previous_month: '2026-10',
      previous_to_date_day: '2026-10-24',
      currencies: [
        {
          currency: 'GBP',
          spent: 254000,
          previous_spent: 300000,
          previous_to_date_spent: 176000,
          converted: false,
          display_spent: null,
          display_previous_spent: null,
          display_previous_to_date_spent: null,
          categories: [line('groceries', 62000, 50000, 40000), line('entertainment', 46000, 20000, 3700), line('eating_out', 29000, 36000, 30000), line('transport', 21000, 22000, 18000), line('other', 52000, 40000, 50000)],
        },
      ],
      display: { currency: 'GBP', rates: {}, missing: [], complete: true, spent: 254000, previous_spent: 300000, previous_to_date_spent: 176000, categories: [{ category: 'groceries', spent: 62000, previous: 50000, previous_to_date: 40000 }, { category: 'other', spent: 52000, previous: 40000, previous_to_date: 50000 }, { category: 'entertainment', spent: 46000, previous: 20000, previous_to_date: 3700 }, { category: 'eating_out', spent: 29000, previous: 36000, previous_to_date: 30000 }, { category: 'transport', spent: 21000, previous: 22000, previous_to_date: 18000 }] },
    },
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

describe('the Money page: Today', () => {
  it('is the default view: a greeting and one sentence of what matters now, with no other section on it', async () => {
    setup();
    renderAt(PATH);
    expect(await within(main()).findByRole('heading', { level: 2, name: /Good (morning|afternoon|evening)/ })).toBeInTheDocument();
    expect(await within(main()).findByText(/Across all accounts £1,500\.00\. 4 waiting for a decision\. Next payment: tomorrow\./)).toBeInTheDocument();
    expect(within(main()).queryByRole('region', { name: 'Wallet' })).toBeNull();
    // Nothing that the backend does not serve is faked.
    expect(within(main()).queryByText('Ask Claude')).toBeNull();
    expect(within(main()).queryByText(/Queue cleared/)).toBeNull();
  });

  it('shows at most three decisions, each a question with a line of fact and exactly two actions, and "All 4" for the rest', async () => {
    setup();
    renderAt(PATH);
    const queue = within(await within(main()).findByRole('region', { name: /First this/ }));
    const cards = await waitFor(() => {
      const found = queue.getAllByRole('listitem').filter((entry) => entry.getAttribute('data-key'));
      expect(found).toHaveLength(3);
      return found;
    });
    // The server's severity order: the missed payment (high) first, then the amount, then the limit.
    expect(cards.map((card) => card.getAttribute('data-key'))).toEqual(['k2', 'k3', 'k1']);
    expect(within(cards[0]).getByText('Was Gym paid?')).toBeInTheDocument();
    expect(within(cards[2]).getByText('Accept the new amount of Streaming?')).toBeInTheDocument();
    for (const card of cards) expect(within(card).getAllByRole('button').length + within(card).queryAllByRole('link').length).toBe(2);
    expect(queue.getByRole('link', { name: 'All 4' })).toHaveAttribute('href', expect.stringContaining('view=attention'));
  });

  it('accepts a new amount and marks a missed payment paid from the card, and walks the items one at a time', async () => {
    const api = setup();
    const user = userEvent.setup();
    renderAt(PATH);
    const queue = within(await within(main()).findByRole('region', { name: /First this/ }));
    const card = (key: string) => queue.getAllByRole('listitem').find((entry) => entry.getAttribute('data-key') === key) as HTMLElement;
    await user.click(await waitFor(() => within(card('k1')).getByRole('button', { name: 'Accept' })));
    await waitFor(() => expect(api.callsTo('PATCH', '/finance/recurring/r-1')[0]?.body).toEqual({ amount: 1999 }));
    await user.click(within(card('k2')).getByRole('button', { name: 'Mark paid' }));
    await waitFor(() => expect(api.callsTo('POST', '/finance/recurring/r-2/paid')[0]?.body).toEqual({ due_date: '2026-12-05' }));
    await user.click(queue.getByRole('button', { name: 'One at a time' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('lists what is due soon with its amount and day, and marks one paid', async () => {
    const api = setup();
    const user = userEvent.setup();
    renderAt(PATH);
    const soon = within((await within(main()).findByRole('heading', { level: 3, name: 'Due soon' })).closest('section') as HTMLElement);
    const rows = await waitFor(() => {
      const found = soon.getAllByRole('listitem').filter((entry) => !entry.getAttribute('data-key'));
      expect(found.length).toBeGreaterThan(0);
      return found;
    });
    expect(rows[0]).toHaveTextContent('Gym');
    expect(rows[0]).toHaveTextContent('£18.00');
    expect(rows[0]).toHaveTextContent('tomorrow');
    expect(soon.getByRole('link', { name: 'All payments →' })).toHaveAttribute('href', expect.stringContaining('view=payments'));
    await user.click(within(rows[0]).getByRole('button', { name: 'Paid' }));
    await waitFor(() => expect(api.callsTo('POST', '/finance/recurring/r-2/paid')[0]?.body).toEqual({ due_date: '2026-11-25' }));
  });

  it('shows the month so far against the same day last month, what is due in 14 days, where the money went and what rose', async () => {
    setup();
    renderAt(PATH);
    expect(await within(main()).findByText('Spent in November')).toBeInTheDocument();
    expect(within(main()).getByText('£2,540.00')).toBeInTheDocument();
    // 254000 against 176000 by the same day: 44% more.
    expect(within(main()).getByText(/44% more than by Oct 24, 2026/)).toBeInTheDocument();
    expect(within(main()).getByText('Due in 14 days')).toBeInTheDocument();
    expect(within(main()).getByText('£1,071.99')).toBeInTheDocument();
    expect(within(main()).getByText(/of which confirmed by the bank: £0\.00/)).toBeInTheDocument();
    const breakdown = within(await within(main()).findByRole('region', { name: 'Where the money went' }));
    expect(breakdown.getAllByRole('listitem')).toHaveLength(4);
    expect(breakdown.getByText('What rose: Entertainment')).toBeInTheDocument();
    expect(breakdown.getByText(/By Oct 24, 2026 last month it was £37\.00, now £460\.00/)).toBeInTheDocument();
  });

  it('lists the banks with how fresh each one\'s data is', async () => {
    setup();
    renderAt(PATH);
    const banks = within(await within(main()).findByRole('region', { name: 'Banks today' }));
    expect(await banks.findByText(/updated 5 minutes ago/)).toBeInTheDocument();
    expect(banks.getByText(/Acme bank · £1,500\.00/)).toBeInTheDocument();
    expect(banks.getByRole('link', { name: 'Wallet →' })).toHaveAttribute('href', expect.stringContaining('view=wallet'));
  });

  it('says so, without inventing anything, when there is nothing to decide, nothing due and no spending', async () => {
    setup({ finance: { attention: [], upcoming: { from_date: '2026-11-24', to_date: '2026-12-07', items: [], totals: [], display: { currency: 'GBP', rates: {}, missing: [], complete: true, total: 0 } }, categories: { month: '2026-11', previous_month: '2026-10', previous_to_date_day: '2026-10-24', currencies: [], display: { currency: 'GBP', rates: {}, missing: [], complete: true, spent: 0, previous_spent: 0, previous_to_date_spent: 0, categories: [] } } } });
    renderAt(PATH);
    expect(await within(main()).findByText('Nothing to decide.')).toBeInTheDocument();
    expect(within(main()).getByText('Nothing is due in the next few days.')).toBeInTheDocument();
    expect(within(main()).getByText('No spending this month yet.')).toBeInTheDocument();
    expect(within(main()).getByText(/Nothing needs attention\./)).toBeInTheDocument();
  });

  it('is in Russian too', async () => {
    setup({ lang: 'ru' });
    renderAt(PATH);
    expect(await within(main()).findByRole('heading', { level: 2, name: /(Доброе утро|Добрый день|Добрый вечер)/ })).toBeInTheDocument();
    expect(within(main()).getByRole('heading', { level: 3, name: /Сначала это/ })).toBeInTheDocument();
  });
});
