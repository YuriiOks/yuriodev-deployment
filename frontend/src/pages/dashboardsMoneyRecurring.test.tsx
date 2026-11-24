import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '../context/ThemeContext';
import App from '../App';
import { resetBootstrap } from '../services/dashboards/bootstrapStore';
import { LANG_STORAGE_KEY } from '../services/dashboards/strings';
import { resetStorageFallback } from '../utils/safeStorage';
import { installFakeApi, type FakeApi, type FakeApiOptions, type FinanceData } from '../test/dashboardsApiMock';

// Everything here is invented: made-up payments, creditors and amounts.

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

const rec = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
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

const item = (kind: string, key: string, subject: [string, string], extra: Record<string, unknown> = {}) => ({
  key,
  kind,
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

const due = (id: string, name: string, dueDate: string, daysUntil: number, extra: Record<string, unknown> = {}) => ({
  recurring_id: id,
  name,
  kind: 'subscription',
  due_date: dueDate,
  days_until: daysUntil,
  amount: 999,
  currency: 'GBP',
  display_amount: null,
  converted: false,
  account_id: null,
  payment_method: null,
  icon_url: null,
  color: null,
  covered: null,
  shortfall: null,
  account_currency: null,
  ...extra,
});

function finance(overrides: Partial<FinanceData> = {}): FinanceData {
  return {
    accounts: [acct('a-current', 'Everyday', 45050, { mask_last4: '1234' }), acct('a-card', 'Plastic card', 217400, { type: 'credit', credit_limit: 300000, own_balance_minor: -82600 })],
    connections: [{ provider: 'acme-bank', status: 'ok', last_ok_at: '2026-11-23T09:00:00Z' }],
    transactions: [],
    summary: { month: '2026-11', as_of: '2026-11-23T09:00:00Z', currencies: [{ currency: 'GBP', accounts: 2, balance: 45050, own_balance: 45050, spent: 0, received: 0 }] },
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

describe('the Money page: needs attention', () => {
  it('renders nothing at all when there is nothing to look at', async () => {
    setup();
    renderAt(PATH);
    await within(main()).findByRole('region', { name: 'Wallet' });
    await waitFor(() => expect(within(main()).queryByRole('region', { name: 'Upcoming payments' })).not.toBeNull());
    expect(within(main()).queryByRole('region', { name: 'Needs attention' })).toBeNull();
  });

  it('tells each kind in one plain sentence from its facts, with the action that fits it', async () => {
    setup({
      finance: {
        recurring: [rec('r-1', 'Streaming'), rec('r-2', 'Gym'), rec('r-3', 'Phone plan')],
        attention: [
          item('due_not_covered', 'k1', ['recurring', 'r-1'], { amount: 999, currency: 'GBP', facts: { due_in_days: 1, shortfall: 250, account_currency: 'GBP' } }),
          item('missed_payment', 'k2', ['recurring', 'r-2'], { amount: 2500, currency: 'GBP', facts: { days_overdue: 3 } }),
          item('amount_changed', 'k3', ['recurring', 'r-3'], { amount: 1250, currency: 'GBP', facts: { recorded_amount: 1000, charged_amount: 1250 } }),
          item('credit_high', 'k4', ['account', 'a-card'], { amount: 217400, currency: 'GBP', facts: { used_percent: 72, owed: 217400, credit_limit: 300000 } }),
          item('overdraft', 'k5', ['account', 'a-current'], { amount: 4000, currency: 'GBP', facts: { over_by: 4000 } }),
          item('reconsent', 'k6', ['connection', 'c-1'], { facts: { provider: 'monzo' } }),
        ],
      },
    });
    renderAt(PATH);
    const panel = await attentionPanel();
    const cards = panel.getAllByRole('listitem');
    expect(cards.map((card) => card.getAttribute('data-kind'))).toEqual(['due_not_covered', 'missed_payment', 'amount_changed', 'credit_high', 'overdraft', 'reconsent']);
    expect(cards[0]).toHaveTextContent('Streaming is due tomorrow (£9.99) and the paying account is short by £2.50.');
    expect(cards[1]).toHaveTextContent('Gym was due 3 d ago (£25.00) and no matching transaction has been seen.');
    expect(cards[2]).toHaveTextContent('Phone plan was charged £12.50 instead of the recorded £10.00.');
    expect(cards[3]).toHaveTextContent('Plastic card has used 72% of its limit (£2,174.00 of £3,000.00).');
    expect(cards[4]).toHaveTextContent('Everyday is £40.00 past its overdraft.');
    expect(cards[5]).toHaveTextContent('The Monzo connection needs to be approved again.');
    // The server's English title is not shown while the facts are there.
    expect(panel.queryByText(/The server's own English title/)).toBeNull();
    // Actions that fit each kind.
    expect(within(cards[0]).getByRole('button', { name: 'Mark paid' })).toBeInTheDocument();
    expect(within(cards[0]).getByRole('link', { name: 'Open payment' })).toHaveAttribute('href', expect.stringContaining('view=recurring&edit=r-1'));
    expect(within(cards[2]).getByRole('link', { name: 'Open payment' })).toBeInTheDocument();
    expect(within(cards[3]).getByRole('link', { name: 'Open bank' })).toHaveAttribute('href', '#money-wallet-title');
    expect(within(cards[5]).getByRole('link', { name: 'Reconnect' })).toHaveAttribute('href', '/api/dashboards/v1/finance/monzo/connect');
    for (const card of cards) {
      expect(within(card).getByRole('button', { name: 'Snooze' })).toBeInTheDocument();
      expect(within(card).getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    }
  });

  it('falls back to the server\'s title when a fact is missing, and speaks Russian when asked', async () => {
    setup({ lang: 'ru', finance: { recurring: [rec('r-2', 'Спортзал')], attention: [item('missed_payment', 'k2', ['recurring', 'r-2'], { title: 'Gym was due', amount: 2500, currency: 'GBP', facts: { days_overdue: 3 } }), item('missed_payment', 'k9', ['recurring', 'r-2'], { title: 'The fallback title', amount: 2500, currency: 'GBP' })] } });
    renderAt(PATH);
    const panel = within(await within(main()).findByRole('region', { name: 'Требует внимания' }));
    const cards = panel.getAllByRole('listitem');
    expect(cards[0]).toHaveTextContent('Спортзал: срок был 3 дн. назад');
    expect(cards[1]).toHaveTextContent('The fallback title');
    expect(within(cards[0]).getByRole('button', { name: 'Отметить оплаченным' })).toBeInTheDocument();
  });

  it('marks a payment paid, snoozes for a chosen number of days and dismisses, asking the server and then again for the list', async () => {
    const api = setup({
      finance: {
        recurring: [rec('r-2', 'Gym')],
        attention: [item('missed_payment', 'k2', ['recurring', 'r-2'], { amount: 2500, currency: 'GBP', facts: { days_overdue: 3 } }), item('overdraft', 'k5', ['account', 'a-current'], { amount: 4000, currency: 'GBP' }), item('overdraft', 'k7', ['account', 'a-current'], { amount: 100, currency: 'GBP' })],
      },
    });
    const user = userEvent.setup();
    renderAt(PATH);
    let panel = await attentionPanel();
    await user.click(within(panel.getAllByRole('listitem')[0]).getByRole('button', { name: 'Mark paid' }));
    await waitFor(() => expect(api.callsTo('POST', '/finance/recurring/r-2/paid')).toHaveLength(1));
    // Snooze: pick 3 days, then Snooze.
    panel = await attentionPanel();
    const second = panel.getAllByRole('listitem')[1];
    await user.selectOptions(within(second).getByRole('combobox'), '3');
    await user.click(within(second).getByRole('button', { name: 'Snooze' }));
    await waitFor(() => expect(api.callsTo('POST', '/finance/attention/snooze')).toHaveLength(1));
    expect(api.callsTo('POST', '/finance/attention/snooze')[0].body).toEqual({ key: 'k5', days: 3 });
    // The snoozed one is gone from the list and counted as hidden.
    await waitFor(() => expect(panel.getAllByRole('listitem')).toHaveLength(2));
    await user.click((await attentionPanel()).getAllByRole('button', { name: 'Dismiss' })[1]);
    await waitFor(() => expect(api.callsTo('POST', '/finance/attention/dismiss')[0]?.body).toEqual({ key: 'k7' }));
    await waitFor(() => expect(within(main()).getByText('2 hidden')).toBeInTheDocument());
  });

  it('counts the hidden ones, shows them on request and restores one', async () => {
    const api = setup({
      finance: {
        attention: [item('overdraft', 'k5', ['account', 'a-current'], { amount: 4000, currency: 'GBP', state: 'snoozed', snoozed_until: '2026-12-01T00:00:00Z' }), item('overdraft', 'k7', ['account', 'a-card'], { amount: 100, currency: 'GBP', state: 'dismissed' })],
      },
    });
    const user = userEvent.setup();
    renderAt(PATH);
    // Nothing active, two hidden: the panel is only the count and the way to show them.
    let panel = await attentionPanel();
    expect(panel.getByText('2 hidden')).toBeInTheDocument();
    expect(panel.queryAllByRole('listitem')).toHaveLength(0);
    await user.click(panel.getByRole('button', { name: 'Show hidden' }));
    await waitFor(() => expect(api.calls.filter((call) => call.url.includes('include_hidden=true')).length).toBeGreaterThan(0));
    panel = await attentionPanel();
    await waitFor(() => expect(panel.getAllByRole('listitem')).toHaveLength(2));
    const cards = panel.getAllByRole('listitem');
    expect(cards[0]).toHaveTextContent('snoozed until');
    expect(cards[1]).toHaveTextContent('dismissed');
    expect(within(cards[0]).queryByRole('button', { name: 'Snooze' })).toBeNull();
    await user.click(within(cards[0]).getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(api.callsTo('POST', '/finance/attention/restore')[0]?.body).toEqual({ key: 'k5' }));
  });

  it('says so when an action fails', async () => {
    setup({ fail: ['attentionWrite'], finance: { attention: [item('overdraft', 'k5', ['account', 'a-current'], { amount: 4000, currency: 'GBP' })] } });
    const user = userEvent.setup();
    renderAt(PATH);
    const panel = await attentionPanel();
    await user.click(panel.getByRole('button', { name: 'Dismiss' }));
    expect(await panel.findByRole('alert')).toHaveTextContent('That did not work');
  });
});

describe('the Money page: upcoming payments', () => {
  const upcoming = () => ({
    from_date: '2026-11-23',
    to_date: '2026-12-07',
    items: [
      due('r-1', 'Streaming', '2026-11-23', 0, { covered: true, account_id: 'a-current', color: '#3366cc' }),
      due('r-2', 'Gym', '2026-11-24', 1, { amount: 2500, covered: false, shortfall: 700, account_currency: 'GBP', account_id: 'a-current', icon_url: 'https://icons.example.com/gym.png' }),
      due('r-3', 'Cloud storage', '2026-11-24', 1, { amount: 500, currency: 'USD', display_amount: 395, converted: true, payment_method: 'Visa ending 0000', covered: null }),
      due('r-4', 'Rent', '2026-12-01', 8, { amount: 90000, kind: 'housing' }),
    ],
    totals: [
      { currency: 'GBP', amount: 93499, display_amount: null, converted: false },
      { currency: 'USD', amount: 500, display_amount: 395, converted: true },
    ],
    display: { currency: 'GBP', rates: { USD: { rate: '0.79', as_of: '2026-11-23T08:00:00Z', source: 'test' } }, missing: ['JPY'], complete: false, total: 93894 },
  });

  it('groups the payments by day, names what pays each and whether it is covered in words, and gives the totals the server added up', async () => {
    setup({ finance: { upcoming: upcoming() } });
    renderAt(PATH);
    const panel = within(await within(main()).findByRole('region', { name: 'Upcoming payments' }));
    expect(await panel.findByRole('heading', { level: 3, name: 'Today' })).toBeInTheDocument();
    expect(panel.getByRole('heading', { level: 3, name: 'Tomorrow' })).toBeInTheDocument();
    const rows = panel.getAllByRole('listitem').filter((row) => row.getAttribute('data-covered'));
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent('Streaming');
    expect(rows[0]).toHaveTextContent('subscription · from Everyday · covered');
    expect(rows[1]).toHaveTextContent('Gym');
    expect(rows[1]).toHaveTextContent('short by £7.00');
    expect(rows[2]).toHaveTextContent('Visa ending 0000');
    expect(rows[2]).toHaveTextContent('cover unknown');
    // A converted amount in pounds with the original beside it.
    expect(rows[2]).toHaveTextContent('≈ £3.95');
    expect(rows[2]).toHaveTextContent('$5.00');
    expect(rows[3]).toHaveTextContent('housing');
    // Totals: the grand one from the answer, the parts under it, and the note about a currency with no rate.
    expect(panel.getByText(/In all: ≈ £938\.94/)).toBeInTheDocument();
    expect(panel.getByText('£934.99')).toBeInTheDocument();
    expect(panel.getByText('$5.00', { selector: 'li' })).toBeInTheDocument();
    expect(panel.getByText('Currencies with no rate are not in the total.')).toBeInTheDocument();
  });

  it('shows the picture only from an https address with no referrer, hides it when it fails to load, and falls back to a tile in its colour', async () => {
    setup({ finance: { upcoming: { ...upcoming(), items: [...upcoming().items, due('r-5', 'Insecure', '2026-12-02', 9, { icon_url: 'http://icons.example.com/x.png' })] } } });
    renderAt(PATH);
    const panel = within(await within(main()).findByRole('region', { name: 'Upcoming payments' }));
    const gym = (await panel.findByText('Gym')).closest('li') as HTMLElement;
    const image = gym.querySelector('img') as HTMLImageElement;
    expect(image).toHaveAttribute('src', 'https://icons.example.com/gym.png');
    expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
    fireEvent.error(image);
    expect(gym.querySelector('img')).toBeNull();
    expect(gym).toHaveTextContent('G');
    // A colour tile, and a payment whose address is not https gets no image at all.
    const streaming = panel.getByText('Streaming').closest('li') as HTMLElement;
    expect(streaming.querySelector('[data-colored="true"]')?.getAttribute('style')).toContain('--tile-bg: #3366cc');
    expect((panel.getByText('Insecure').closest('li') as HTMLElement).querySelector('img')).toBeNull();
  });

  it('switches between 14 and 30 days and asks the server for the new window', async () => {
    const api = setup({ finance: { upcoming: upcoming() } });
    const user = userEvent.setup();
    renderAt(PATH);
    const panel = within(await within(main()).findByRole('region', { name: 'Upcoming payments' }));
    expect(await panel.findByRole('button', { name: '14 days' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(panel.getByRole('button', { name: '30 days' }));
    await waitFor(() => expect(api.calls.filter((call) => call.url.includes('/finance/upcoming?days=30'))).toHaveLength(1));
    expect(api.calls.filter((call) => call.url.includes('/finance/upcoming?days=14')).length).toBeGreaterThan(0);
    expect(panel.getByRole('link', { name: 'All recurring payments' })).toBeInTheDocument();
  });

  it('says plainly when nothing is due', async () => {
    setup();
    renderAt(PATH);
    const panel = within(await within(main()).findByRole('region', { name: 'Upcoming payments' }));
    expect(await panel.findByText('Nothing is due in the next 14 days.')).toBeInTheDocument();
  });

  it('has its own error state with a retry', async () => {
    const api = setup({ fail: ['financeUpcoming'] });
    renderAt(PATH);
    const panel = within(await within(main()).findByRole('region', { name: 'Upcoming payments' }));
    expect(await panel.findByRole('alert')).toHaveTextContent('Could not load the upcoming payments.');
    api.fail.delete('financeUpcoming');
    await userEvent.setup().click(panel.getByRole('button', { name: /retry|again/i }));
    expect(await panel.findByText('Nothing is due in the next 14 days.')).toBeInTheDocument();
  });
});

describe('the Money page: debts and installments', () => {
  it('shows each debt with what remains, how far it is paid, the next payment and the creditor; plain payments and ended ones are left out', async () => {
    setup({
      finance: {
        recurring: [
          rec('r-1', 'Streaming'),
          rec('d-1', 'Sofa installments', { kind: 'debt', is_installment: true, total_installments: 12, completed_installments: 3, remaining_balance: 45000, amount: 5000, creditor: 'Example Furniture Ltd', next_payment_date: '2026-12-02' }),
          rec('d-2', 'Family loan', { kind: 'debt', total_owed: 100000, remaining_balance: 25000, amount: 10000, creditor: 'A. Relative', next_payment_date: null }),
          rec('d-3', 'Paid-off loan', { kind: 'debt', is_active: false, remaining_balance: 0 }),
        ],
      },
    });
    renderAt(PATH);
    const panel = within(await within(main()).findByRole('region', { name: 'Debts and installments' }));
    const cards = panel.getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent('Sofa installments');
    expect(cards[0]).toHaveTextContent('Creditor: Example Furniture Ltd');
    expect(cards[0]).toHaveTextContent('£450.00');
    expect(cards[0]).toHaveTextContent('3 of 12 installments paid');
    expect(cards[0]).toHaveTextContent('Next: Dec 2, 2026 · £50.00');
    expect(cards[1]).toHaveTextContent('Family loan');
    expect(cards[1]).toHaveTextContent('£750.00 of £1,000.00 repaid');
    expect(cards[1]).toHaveTextContent('no next date');
    expect(panel.queryByText('Streaming')).toBeNull();
    expect(panel.queryByText('Paid-off loan')).toBeNull();
  });

  it('is not on the page when there are no debts', async () => {
    setup({ finance: { recurring: [rec('r-1', 'Streaming')] } });
    renderAt(PATH);
    await within(main()).findByRole('region', { name: 'Wallet' });
    await waitFor(() => expect(within(main()).queryByRole('region', { name: 'Upcoming payments' })).not.toBeNull());
    expect(within(main()).queryByRole('region', { name: 'Debts and installments' })).toBeNull();
  });
});

describe('the Money page: managing recurring payments', () => {
  const rows = () => [
    rec('r-1', 'Streaming', { match_text: 'STREAMCO', payment_method: 'Visa ending 0000' }),
    rec('r-2', 'Gym', { kind: 'service', account_id: 'a-current', amount: 2500 }),
    rec('r-3', 'Old magazine', { is_active: false }),
    rec('r-4', 'Broadband', { kind: 'utility', amount: 3000 }),
  ];
  const managerPanel = async () => within(await within(main()).findByRole('region', { name: 'Recurring payments' }));

  it('is reached from "All recurring payments" and lists the active ones with their account or method, searchable and filterable by kind, with the inactive ones on request', async () => {
    setup({ finance: { recurring: rows() } });
    const user = userEvent.setup();
    renderAt(PATH);
    await user.click(await screen.findByRole('link', { name: 'All recurring payments' }));
    const panel = await managerPanel();
    const names = () => panel.getAllByRole('listitem').filter((row) => row.getAttribute('data-payment')).map((row) => row.querySelector('strong')?.textContent);
    await waitFor(() => expect(names()).toEqual(['Streaming', 'Gym', 'Broadband']));
    expect(panel.getByText('from Everyday')).toBeInTheDocument();
    expect(panel.getByText('Visa ending 0000')).toBeInTheDocument();
    expect(panel.getAllByText('not linked to an account').length).toBeGreaterThan(0);
    await user.type(panel.getByRole('searchbox', { name: 'Search payments' }), 'streamco');
    expect(names()).toEqual(['Streaming']);
    await user.clear(panel.getByRole('searchbox', { name: 'Search payments' }));
    await user.selectOptions(panel.getByRole('combobox', { name: 'Kind' }), 'utility');
    expect(names()).toEqual(['Broadband']);
    await user.selectOptions(panel.getByRole('combobox', { name: 'Kind' }), '');
    await user.click(panel.getByRole('checkbox', { name: 'Show inactive' }));
    expect(names().some((name) => name?.startsWith('Old magazine'))).toBe(true);
    expect(panel.getByText('· inactive')).toBeInTheDocument();
    await user.click(panel.getByRole('link', { name: 'Back to Money' }));
    expect(await within(main()).findByRole('region', { name: 'Wallet' })).toBeInTheDocument();
  });

  it('edits the account, the amount, the next date and the match text, sending only what changed', async () => {
    const api = setup({ finance: { recurring: rows() } });
    const user = userEvent.setup();
    renderAt(`${PATH}?view=recurring`);
    const panel = await managerPanel();
    const row = (await panel.findByText('Streaming')).closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Edit' }));
    const form = within(within(row).getByRole('form', { name: 'Edit: Streaming' }));
    await user.selectOptions(form.getByLabelText('Paying account'), 'a-current');
    const amount = form.getByLabelText('Amount');
    await user.clear(amount);
    await user.type(amount, '12.50');
    fireEvent.change(form.getByLabelText('Next payment date'), { target: { value: '2026-12-20' } });
    const match = form.getByLabelText('Match text');
    await user.clear(match);
    await user.type(match, 'STREAM CO LTD');
    await user.click(form.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.callsTo('PATCH', '/finance/recurring/r-1')).toHaveLength(1));
    expect(api.callsTo('PATCH', '/finance/recurring/r-1')[0].body).toEqual({ amount: 1250, next_payment_date: '2026-12-20', account_id: 'a-current', match_text: 'STREAM CO LTD' });
  });

  it('opens the payment named in the address for editing at once, which is where an attention card sends you', async () => {
    setup({ finance: { recurring: rows() } });
    renderAt(`${PATH}?view=recurring&edit=r-2`);
    const panel = await managerPanel();
    expect(await panel.findByRole('form', { name: 'Edit: Gym' })).toBeInTheDocument();
    expect(panel.queryByRole('form', { name: 'Edit: Streaming' })).toBeNull();
  });

  it('refuses an amount the currency cannot hold before asking the server, and shows the server\'s own words when it refuses', async () => {
    const api = setup({ finance: { recurring: rows() } });
    const user = userEvent.setup();
    renderAt(`${PATH}?view=recurring&edit=r-2`);
    const panel = await managerPanel();
    const form = within(await panel.findByRole('form', { name: 'Edit: Gym' }));
    const amount = form.getByLabelText('Amount');
    await user.clear(amount);
    await user.type(amount, '12.999');
    await user.click(form.getByRole('button', { name: 'Save' }));
    expect(await form.findByRole('alert')).toHaveTextContent('Enter an amount like 12.99');
    expect(api.callsTo('PATCH', '/finance/recurring/r-2')).toHaveLength(0);
    await user.clear(amount);
    await user.type(amount, '30');
    api.fail.add('recurringWrite');
    await user.click(form.getByRole('button', { name: 'Save' }));
    expect(await form.findByRole('alert')).toHaveTextContent('Could not save: amount must be positive');
  });

  it('adds a payment and deactivates one', async () => {
    const api = setup({ finance: { recurring: rows() } });
    const user = userEvent.setup();
    renderAt(`${PATH}?view=recurring`);
    const panel = await managerPanel();
    await user.click(await panel.findByRole('button', { name: 'Add payment' }));
    const form = within(panel.getByRole('form', { name: 'Add payment' }));
    await user.type(form.getByLabelText('Name'), 'Water bill');
    await user.type(form.getByLabelText('Amount'), '18');
    await user.selectOptions(form.getByLabelText('Kind'), 'utility');
    await user.click(form.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.callsTo('POST', '/finance/recurring')).toHaveLength(1));
    expect(api.callsTo('POST', '/finance/recurring')[0].body).toEqual({ name: 'Water bill', amount: 1800, currency: 'GBP', kind: 'utility', frequency: 'monthly', frequency_interval: 1 });
    const gym = (await panel.findByText('Gym')).closest('li') as HTMLElement;
    await user.click(within(gym).getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(api.callsTo('PATCH', '/finance/recurring/r-2')[0]?.body).toEqual({ is_active: false }));
  });
});
