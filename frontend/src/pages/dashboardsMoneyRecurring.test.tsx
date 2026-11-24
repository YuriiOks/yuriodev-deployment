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

/** How the server rates each kind (the page orders by the severity an item carries). */
const SEVERITY_OF: Record<string, string> = { due_not_covered: 'high', missed_payment: 'high', overdraft: 'high', reconsent: 'high', amount_changed: 'medium', credit_high: 'medium', stale_statement: 'medium', overdrawn: 'info' };

const item = (kind: string, key: string, subject: [string, string], extra: Record<string, unknown> = {}) => ({
  key,
  kind,
  severity: SEVERITY_OF[kind] ?? 'medium',
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

/** Ten items of mixed kinds: two overdrafts, one each of the urgent kinds, and five changed amounts. */
const mixedItems = () => [
  item('amount_changed', 'c1', ['recurring', 'r-3'], { amount: 1250, currency: 'GBP', facts: { recorded_amount: 1000, charged_amount: 1250 } }),
  item('amount_changed', 'c2', ['recurring', 'r-4'], { amount: 2000, currency: 'GBP', facts: { recorded_amount: 1500, charged_amount: 2000 } }),
  item('amount_changed', 'c3', ['recurring', 'r-5'], { amount: 3000, currency: 'GBP', facts: { recorded_amount: 2500, charged_amount: 3000 } }),
  item('amount_changed', 'c4', ['recurring', 'r-6'], { amount: 4000, currency: 'GBP', facts: { recorded_amount: 3500, charged_amount: 4000 } }),
  item('amount_changed', 'c5', ['recurring', 'r-7'], { amount: 5000, currency: 'GBP', facts: { recorded_amount: 4500, charged_amount: 5000 } }),
  item('credit_high', 'k4', ['account', 'a-card'], { amount: 217400, currency: 'GBP', facts: { used_percent: 72, owed: 217400, credit_limit: 300000 } }),
  item('stale_statement', 'k8', ['connection', 'c-2'], { facts: { provider: 'hand-bank', as_of: '2026-10-01', days_old: 54 } }),
  item('reconsent', 'k6', ['connection', 'c-1'], { facts: { provider: 'monzo' } }),
  item('missed_payment', 'k2', ['recurring', 'r-2'], { amount: 2500, currency: 'GBP', facts: { days_overdue: 3 } }),
  item('due_not_covered', 'k1', ['recurring', 'r-1'], { amount: 999, currency: 'GBP', facts: { due_in_days: 1, shortfall: 250, account_currency: 'GBP' } }),
  item('overdraft', 'k5', ['account', 'a-current'], { amount: 4000, currency: 'GBP', facts: { over_by: 4000 } }),
  item('overdraft', 'k9', ['account', 'a-card'], { amount: 100, currency: 'GBP', facts: { over_by: 100 } }),
];
const mixedPayments = () => [rec('r-1', 'Streaming'), rec('r-2', 'Gym'), rec('r-3', 'Phone plan'), rec('r-4', 'Broadband'), rec('r-5', 'Insurance'), rec('r-6', 'Water'), rec('r-7', 'Energy')];

const cardOf = (panel: ReturnType<typeof within>, key: string) => panel.getAllByRole('button').find((button) => button.getAttribute('data-key') === key) as HTMLElement;

describe('the Money page: the row of attention cards', () => {
  it('is not rendered when nothing is active, and the Attention view then says so', async () => {
    setup();
    renderAt(PATH);
    await within(main()).findByRole('region', { name: 'Wallet' });
    await waitFor(() => expect(within(main()).queryByRole('region', { name: 'Upcoming payments' })).not.toBeNull());
    expect(within(main()).queryByRole('region', { name: 'Needs attention' })).toBeNull();
  });

  it('is one row of small cards in the server\'s severity order, with a label first and "All 12" last, every card one button with its subject, fact and severity in words', async () => {
    setup({ finance: { recurring: mixedPayments(), attention: mixedItems() } });
    renderAt(PATH);
    const panel = await attentionPanel();
    expect(panel.getByText('Needs attention · 12')).toBeInTheDocument();
    const cards = panel.getAllByRole('button').filter((button) => button.getAttribute('data-key'));
    // High first (by kind), then medium, with the changed amounts last.
    expect(cards.map((card) => card.getAttribute('data-key'))).toEqual(['k5', 'k9', 'k1', 'k2', 'k6', 'k4', 'k8', 'c1', 'c2', 'c3', 'c4', 'c5']);
    expect(within(cards[0]).getByText('Everyday')).toBeInTheDocument();
    expect(within(cards[0]).getByText('£40.00 past the overdraft')).toBeInTheDocument();
    expect(within(cards[0]).getByText('Urgent')).toBeInTheDocument();
    expect(within(cards[2]).getByText('Streaming')).toBeInTheDocument();
    expect(within(cards[2]).getByText('tomorrow, short £2.50')).toBeInTheDocument();
    expect(within(cards[3]).getByText('3 d overdue, £25.00')).toBeInTheDocument();
    expect(within(cards[5]).getByText('72% of the limit')).toBeInTheDocument();
    expect(within(cards[5]).getByText('Soon')).toBeInTheDocument();
    expect(within(cards[6]).getByText('as of Oct 1, 2026, 54 d old')).toBeInTheDocument();
    expect(within(cards[7]).getByText('£12.50, was £10.00')).toBeInTheDocument();
    expect(panel.getByRole('link', { name: 'All 12' })).toHaveAttribute('href', expect.stringContaining('view=attention'));
    // A card has nothing in it to press but itself.
    for (const card of cards) expect(card.querySelector('button, a')).toBeNull();
    // Nothing of the long list is on the overview.
    expect(panel.queryByRole('group')).toBeNull();
  });

  it('has arrow buttons at its ends, and the arrow keys move between the cards', async () => {
    setup({ finance: { recurring: mixedPayments(), attention: mixedItems() } });
    const user = userEvent.setup();
    renderAt(PATH);
    const panel = await attentionPanel();
    expect(panel.getByRole('button', { name: 'Scroll left' })).toBeInTheDocument();
    expect(panel.getByRole('button', { name: 'Scroll right' })).toBeInTheDocument();
    const cards = panel.getAllByRole('button').filter((button) => button.getAttribute('data-key'));
    cards[0].focus();
    await user.keyboard('{ArrowRight}');
    expect(cards[1]).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(cards[0]).toHaveFocus();
  });

  it('tells severity in a word on every card and never leaves the row with a count of zero', async () => {
    setup({ finance: { recurring: mixedPayments(), attention: [item('overdrawn', 'o1', ['account', 'a-current'], { amount: 2500, currency: 'GBP', facts: { balance: -2500, overdraft_limit: null } })] } });
    renderAt(PATH);
    const panel = await attentionPanel();
    const card = cardOf(panel, 'o1');
    expect(within(card).getByText('Note')).toBeInTheDocument();
    expect(within(card).getByText('overdrawn, no limit set')).toBeInTheDocument();
    expect(card).toHaveAttribute('data-severity', 'info');
  });

  it('falls back to the server\'s title on a card when a fact is missing', async () => {
    setup({ finance: { recurring: mixedPayments(), attention: [item('missed_payment', 'k', ['recurring', 'r-2'], { title: 'The fallback title', amount: 2500, currency: 'GBP' })] } });
    renderAt(PATH);
    expect(await (await attentionPanel()).findByText('The fallback title')).toBeInTheDocument();
  });
});

describe('the Money page: the sections switch', () => {
  it('offers Overview, Attention (with its count) and Recurring payments, the current one marked, and switches the view', async () => {
    setup({ finance: { recurring: mixedPayments(), attention: mixedItems() } });
    const user = userEvent.setup();
    renderAt(PATH);
    const nav = within(await within(main()).findByRole('navigation', { name: 'Money sections' }));
    expect(nav.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    const attentionTab = nav.getByRole('link', { name: /^Attention/ });
    expect(attentionTab).toHaveTextContent('12');
    await user.click(attentionTab);
    expect(await within(main()).findByRole('heading', { level: 2, name: 'Needs attention' })).toBeInTheDocument();
    expect(nav.getByRole('link', { name: /^Attention/ })).toHaveAttribute('aria-current', 'page');
    expect(within(main()).queryByRole('region', { name: 'Wallet' })).toBeNull();
    await user.click(nav.getByRole('link', { name: 'Recurring payments' }));
    expect(await within(main()).findByRole('region', { name: 'Recurring payments' })).toBeInTheDocument();
    await user.click(nav.getByRole('link', { name: 'Overview' }));
    expect(await within(main()).findByRole('region', { name: 'Wallet' })).toBeInTheDocument();
  });

  it('keeps a quiet "N hidden" link when nothing is active but something is hidden', async () => {
    setup({ finance: { attention: [item('overdraft', 'k5', ['account', 'a-current'], { amount: 4000, currency: 'GBP', state: 'dismissed' })] } });
    renderAt(PATH);
    const nav = within(await within(main()).findByRole('navigation', { name: 'Money sections' }));
    expect(await nav.findByRole('link', { name: '1 hidden' })).toHaveAttribute('href', expect.stringContaining('view=attention'));
    expect(within(main()).queryByRole('region', { name: 'Needs attention' })).toBeNull();
  });

  it('reaches the whole list from "All 12"', async () => {
    setup({ finance: { recurring: mixedPayments(), attention: mixedItems() } });
    const user = userEvent.setup();
    renderAt(PATH);
    await user.click(await (await attentionPanel()).findByRole('link', { name: 'All 12' }));
    expect(await within(main()).findByRole('group', { name: /^Past the overdraft/ })).toBeInTheDocument();
  });
});

describe('the Money page: an attention item in detail', () => {
  const dialogOf = (name: string) => within(screen.getByRole('dialog', { name }));

  it('opens from a card as a dialog with the sentence, the facts as a definition list with a link to what it concerns, and the actions as buttons', async () => {
    setup({ finance: { recurring: mixedPayments(), attention: mixedItems() } });
    const user = userEvent.setup();
    renderAt(PATH);
    await user.click(cardOf(await attentionPanel(), 'k1'));
    const dialog = dialogOf('Streaming');
    expect(dialog.getByText('Streaming is due tomorrow (£9.99) and the paying account is short by £2.50.')).toBeInTheDocument();
    const terms = dialog.getAllByRole('term').map((term) => term.textContent);
    expect(terms).toEqual(['Concerns', 'Priority', 'Amount', 'Short by']);
    expect(dialog.getByRole('link', { name: 'Streaming' })).toHaveAttribute('href', expect.stringContaining('view=recurring&edit=r-1'));
    expect(dialog.getByText('Urgent')).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Mark paid' })).toBeInTheDocument();
    const snooze = within(dialog.getByRole('group', { name: 'Snooze for' }));
    expect(snooze.getAllByRole('button').map((button) => button.textContent)).toEqual(['1 d', '3 d', '7 d', '30 d', 'Dismiss']);
  });

  it('shows an amount in pounds with the original beside it when the server converted it', async () => {
    setup({ finance: { recurring: mixedPayments(), attention: [item('missed_payment', 'k2', ['recurring', 'r-2'], { amount: 500, currency: 'USD', display_amount: 395, converted: true, facts: { days_overdue: 3, last_paid_on: '2026-10-24' } })] } });
    const user = userEvent.setup();
    renderAt(PATH);
    await user.click(cardOf(await attentionPanel(), 'k2'));
    const dialog = dialogOf('Gym');
    expect(dialog.getByText('≈ £3.95')).toBeInTheDocument();
    expect(dialog.getByText('$5.00')).toBeInTheDocument();
    expect(dialog.getByText('Oct 24, 2026')).toBeInTheDocument();
  });

  it('closes on Escape, giving the focus back to the card, and keeps Tab inside while open', async () => {
    setup({ finance: { recurring: mixedPayments(), attention: mixedItems() } });
    const user = userEvent.setup();
    renderAt(PATH);
    const card = cardOf(await attentionPanel(), 'k1');
    await user.click(card);
    const dialog = screen.getByRole('dialog', { name: 'Streaming' });
    expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus();
    for (let step = 0; step < 14; step += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(card).toHaveFocus();
  });

  it('closes from its Close button', async () => {
    setup({ finance: { recurring: mixedPayments(), attention: mixedItems() } });
    const user = userEvent.setup();
    renderAt(PATH);
    await user.click(cardOf(await attentionPanel(), 'k1'));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('moves on to the next item after an action and closes when none is left', async () => {
    const api = setup({ finance: { recurring: mixedPayments(), attention: [item('due_not_covered', 'k1', ['recurring', 'r-1'], { amount: 999, currency: 'GBP', facts: { due_in_days: 1, shortfall: 250, account_currency: 'GBP' } }), item('missed_payment', 'k2', ['recurring', 'r-2'], { amount: 2500, currency: 'GBP', facts: { days_overdue: 3 } })] } });
    const user = userEvent.setup();
    renderAt(PATH);
    const panel = await attentionPanel();
    await user.click(cardOf(panel, 'k1'));
    await user.click(dialogOf('Streaming').getByRole('button', { name: '3 d' }));
    await waitFor(() => expect(api.callsTo('POST', '/finance/attention/snooze')).toHaveLength(1));
    // The next item is in the sheet now, and the first has left the row.
    expect(await screen.findByRole('dialog', { name: 'Gym' })).toBeInTheDocument();
    await waitFor(() => expect(panel.getAllByRole('button').filter((button) => button.getAttribute('data-key') === 'k1')).toHaveLength(0));
    await user.click(dialogOf('Gym').getByRole('button', { name: '7 d' }));
    await waitFor(() => expect(api.callsTo('POST', '/finance/attention/snooze')).toHaveLength(2));
    expect(api.callsTo('POST', '/finance/attention/snooze')[1].body).toEqual({ key: 'k2', days: 7 });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('marks a payment paid from the sheet and moves to the next item', async () => {
    const api = setup({ finance: { recurring: mixedPayments(), attention: [item('due_not_covered', 'k1', ['recurring', 'r-1'], { amount: 999, currency: 'GBP', facts: { due_in_days: 1, shortfall: 250, account_currency: 'GBP' } }), item('missed_payment', 'k2', ['recurring', 'r-2'], { amount: 2500, currency: 'GBP', facts: { days_overdue: 3 } })] } });
    const user = userEvent.setup();
    renderAt(PATH);
    await user.click(cardOf(await attentionPanel(), 'k1'));
    await user.click(dialogOf('Streaming').getByRole('button', { name: 'Mark paid' }));
    await waitFor(() => expect(api.callsTo('POST', '/finance/recurring/r-1/paid')).toHaveLength(1));
    expect(await screen.findByRole('dialog', { name: 'Gym' })).toBeInTheDocument();
  });

  it.each([
    ['k2', 'Gym', 'Gym was due 3 d ago (£25.00) and no matching transaction has been seen.'],
    ['k4', 'Plastic card', 'Plastic card has used 72% of its limit (£2,174.00 of £3,000.00).'],
    ['k6', 'Monzo', 'The Monzo connection needs to be approved again.'],
    ['k8', 'Hand bank', 'The data of Hand bank is out of date: the newest is from Oct 1, 2026 (54 d ago).'],
    ['k5', 'Everyday', 'Everyday is £40.00 past its overdraft.'],
  ])('tells the %s item in one plain sentence in the sheet', async (key, name, sentence) => {
    setup({ finance: { recurring: mixedPayments(), attention: mixedItems() } });
    const user = userEvent.setup();
    renderAt(PATH);
    await user.click(cardOf(await attentionPanel(), key));
    expect(dialogOf(name).getByText(sentence)).toBeInTheDocument();
  });

  it('dismisses an item from the sheet', async () => {
    const api = setup({ finance: { recurring: mixedPayments(), attention: [item('missed_payment', 'k2', ['recurring', 'r-2'], { amount: 2500, currency: 'GBP', facts: { days_overdue: 3 } })] } });
    const user = userEvent.setup();
    renderAt(PATH);
    await user.click(cardOf(await attentionPanel(), 'k2'));
    await user.click(dialogOf('Gym').getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(api.callsTo('POST', '/finance/attention/dismiss')[0]?.body).toEqual({ key: 'k2' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('accepts the charged amount of a changed payment', async () => {
    const api = setup({ finance: { recurring: mixedPayments(), attention: [item('amount_changed', 'c1', ['recurring', 'r-3'], { amount: 1250, currency: 'GBP', facts: { recorded_amount: 1000, charged_amount: 1250, difference: 250, paid_on: '2026-11-20' } })] } });
    const user = userEvent.setup();
    renderAt(PATH);
    await user.click(cardOf(await attentionPanel(), 'c1'));
    const dialog = dialogOf('Phone plan');
    expect(dialog.getAllByRole('term').map((term) => term.textContent)).toEqual(['Concerns', 'Priority', 'Amount', 'Recorded', 'Charged', 'Difference', 'Charged on']);
    await user.click(dialog.getByRole('button', { name: 'Accept the charged amount' }));
    await waitFor(() => expect(api.callsTo('PATCH', '/finance/recurring/r-3')[0]?.body).toEqual({ amount: 1250 }));
  });

  it('sets the overdraft limit of an overdrawn account from the sheet', async () => {
    const api = setup({ finance: { attention: [item('overdrawn', 'o1', ['account', 'a-current'], { amount: 2500, currency: 'GBP', facts: { balance: -2500, overdraft_limit: null } })] } });
    const user = userEvent.setup();
    renderAt(PATH);
    await user.click(cardOf(await attentionPanel(), 'o1'));
    const dialog = dialogOf('Everyday');
    expect(dialog.getByText('Everyday is overdrawn by £25.00; no overdraft limit is set.')).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Set limit' }));
    await user.type(dialog.getByLabelText(/Overdraft limit/), '500');
    await user.click(dialog.getByRole('button', { name: 'Save limit' }));
    await waitFor(() => expect(api.callsTo('PATCH', '/finance/accounts/a-current')[0]?.body).toEqual({ overdraft_limit: 50000 }));
  });

  it('offers the action that fits each kind: open the bank for a card near its limit, upload a statement for old data, reconnect for a link', async () => {
    setup({ finance: { recurring: mixedPayments(), attention: mixedItems() } });
    const user = userEvent.setup();
    renderAt(PATH);
    const panel = await attentionPanel();
    await user.click(cardOf(panel, 'k4'));
    expect(dialogOf('Plastic card').getByRole('link', { name: 'Open bank' })).toHaveAttribute('href', '#money-wallet-title');
    await user.keyboard('{Escape}');
    await user.click(cardOf(panel, 'k8'));
    expect(dialogOf('Hand bank').getByRole('link', { name: 'Upload statement' })).toHaveAttribute('href', '#money-wallet-title');
    // Going to the bank closes the sheet.
    await user.click(dialogOf('Hand bank').getByRole('link', { name: 'Upload statement' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(cardOf(panel, 'k6'));
    expect(dialogOf('Monzo').getByRole('link', { name: 'Reconnect' })).toHaveAttribute('href', '/api/dashboards/v1/finance/monzo/connect');
  });

  it('says so when an action fails and stays open', async () => {
    setup({ fail: ['attentionWrite'], finance: { recurring: mixedPayments(), attention: [item('missed_payment', 'k2', ['recurring', 'r-2'], { amount: 2500, currency: 'GBP', facts: { days_overdue: 3 } })] } });
    const user = userEvent.setup();
    renderAt(PATH);
    await user.click(cardOf(await attentionPanel(), 'k2'));
    await user.click(dialogOf('Gym').getByRole('button', { name: 'Dismiss' }));
    expect(await dialogOf('Gym').findByRole('alert')).toHaveTextContent('That did not work');
    expect(screen.getByRole('dialog', { name: 'Gym' })).toBeInTheDocument();
  });
});

describe('the Money page: the whole attention list', () => {
  it('says so when there is nothing to look at', async () => {
    setup();
    renderAt(`${PATH}?view=attention`);
    expect(await (await attentionPanel()).findByText('Nothing needs attention.')).toBeInTheDocument();
  });

  it('lists the groups in severity order, three rows each with "Show all", every row one line: name, the fact in short form, one primary action and a menu', async () => {
    setup({ finance: { recurring: mixedPayments(), attention: mixedItems() } });
    const user = userEvent.setup();
    renderAt(`${PATH}?view=attention`);
    const panel = await attentionPanel();
    const groups = panel.getAllByRole('group').filter((group) => group.getAttribute('data-kind'));
    expect(groups.map((group) => group.getAttribute('data-kind'))).toEqual(['overdraft', 'due_not_covered', 'missed_payment', 'reconsent', 'credit_high', 'stale_statement', 'amount_changed']);
    expect(within(groups[0]).getByRole('heading', { level: 3 })).toHaveTextContent('Past the overdraft 2');
    const overdraft = within(groups[0]).getAllByRole('listitem');
    expect(overdraft[0]).toHaveTextContent('Everyday');
    expect(overdraft[0]).toHaveTextContent('£40.00 past the overdraft');
    expect(within(overdraft[0]).getByRole('link', { name: 'Open bank' })).toHaveAttribute('href', '#money-wallet-title');
    expect(within(groups[1]).getByRole('listitem')).toHaveTextContent('Streaming£9.99 tomorrow · short £2.50');
    expect(within(within(groups[1]).getByRole('listitem')).getByRole('button', { name: 'Mark paid' })).toBeInTheDocument();
    expect(within(groups[2]).getByRole('listitem')).toHaveTextContent('Gym£25.00 · 3 d overdue');
    expect(within(within(groups[3]).getByRole('listitem')).getByRole('link', { name: 'Reconnect' })).toHaveAttribute('href', '/api/dashboards/v1/finance/monzo/connect');
    expect(within(groups[4]).getByRole('listitem')).toHaveTextContent('72% of the limit');
    expect(within(groups[5]).getByRole('listitem')).toHaveTextContent('Hand bank');
    expect(within(groups[5]).getByRole('listitem')).toHaveTextContent('as of Oct 1, 2026 · 54 d old');
    // Changed amounts last, three rows of five.
    const changed = within(groups[6]);
    expect(changed.getAllByRole('listitem')).toHaveLength(3);
    expect(changed.getAllByRole('listitem')[0]).toHaveTextContent('Phone plan£12.50, recorded £10.00');
    await user.click(changed.getByRole('button', { name: 'Show all 5' }));
    expect(changed.getAllByRole('listitem')).toHaveLength(5);
    await user.click(changed.getByRole('button', { name: 'Show fewer' }));
    expect(changed.getAllByRole('listitem')).toHaveLength(3);
    // No select boxes in the rows.
    expect(panel.queryByRole('combobox')).toBeNull();
  });

  it('does what a row\'s buttons say: mark paid, snooze from the menu (the days inside it), dismiss; then asks for the list again', async () => {
    const api = setup({ finance: { recurring: mixedPayments(), attention: mixedItems() } });
    const user = userEvent.setup();
    renderAt(`${PATH}?view=attention`);
    const panel = await attentionPanel();
    const group = (kind: string) => within(panel.getAllByRole('group').find((candidate) => candidate.getAttribute('data-kind') === kind) as HTMLElement);
    await user.click(within(group('missed_payment').getAllByRole('listitem')[0]).getByRole('button', { name: 'Mark paid' }));
    await waitFor(() => expect(api.callsTo('POST', '/finance/recurring/r-2/paid')).toHaveLength(1));
    // The menu: Open payment, the four snooze choices and Dismiss.
    const row = group('due_not_covered').getAllByRole('listitem')[0];
    await user.click(within(row).getByRole('button', { name: 'More: Streaming' }));
    expect(within(row).getByRole('link', { name: 'Open payment' })).toHaveAttribute('href', expect.stringContaining('view=recurring&edit=r-1'));
    for (const days of [1, 3, 7, 30]) expect(within(row).getByRole('button', { name: `Snooze for ${days} d` })).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'Snooze for 3 d' }));
    await waitFor(() => expect(api.callsTo('POST', '/finance/attention/snooze')).toHaveLength(1));
    expect(api.callsTo('POST', '/finance/attention/snooze')[0].body).toEqual({ key: 'k1', days: 3 });
    // The group is gone once its only item is snoozed.
    await waitFor(() => expect(panel.queryByRole('heading', { name: /Due soon, not covered/ })).toBeNull());
    const overdraftRow = group('overdraft').getAllByRole('listitem')[1];
    await user.click(within(overdraftRow).getByRole('button', { name: 'More: Plastic card' }));
    await user.click(within(overdraftRow).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(api.callsTo('POST', '/finance/attention/dismiss')[0]?.body).toEqual({ key: 'k9' }));
  });

  it('accepts every charged amount of a group (each payment\'s amount becomes the charged one), and snoozes or dismisses a whole group with a confirmation before the dismissal', async () => {
    const api = setup({ finance: { recurring: mixedPayments(), attention: mixedItems() } });
    const user = userEvent.setup();
    renderAt(`${PATH}?view=attention`);
    const panel = await attentionPanel();
    const changed = within(panel.getAllByRole('group').find((candidate) => candidate.getAttribute('data-kind') === 'amount_changed') as HTMLElement);
    await user.click(changed.getByRole('button', { name: 'Accept charged amounts' }));
    await waitFor(() => expect(api.calls.filter((call) => call.method === 'PATCH' && call.path.startsWith('/finance/recurring/'))).toHaveLength(5));
    const bodies = api.calls.filter((call) => call.method === 'PATCH').map((call) => [call.path, call.body]);
    expect(bodies).toEqual([
      ['/finance/recurring/r-3', { amount: 1250 }],
      ['/finance/recurring/r-4', { amount: 2000 }],
      ['/finance/recurring/r-5', { amount: 3000 }],
      ['/finance/recurring/r-6', { amount: 4000 }],
      ['/finance/recurring/r-7', { amount: 5000 }],
    ]);
    // Snooze all: one bulk request for the group, 7 days.
    const overdraft = within(panel.getAllByRole('group').find((candidate) => candidate.getAttribute('data-kind') === 'overdraft') as HTMLElement);
    await user.click(overdraft.getByRole('button', { name: 'Snooze all for 7 d' }));
    await waitFor(() => expect(api.callsTo('POST', '/finance/attention/bulk')).toHaveLength(1));
    expect(api.callsTo('POST', '/finance/attention/bulk')[0].body).toEqual({ keys: ['k5', 'k9'], action: 'snooze', days: 7 });
  });

  it('asks before a bulk dismissal, and does nothing when it is cancelled', async () => {
    const api = setup({ finance: { recurring: mixedPayments(), attention: mixedItems() } });
    const user = userEvent.setup();
    renderAt(`${PATH}?view=attention`);
    const panel = await attentionPanel();
    const changed = within(panel.getAllByRole('group').find((candidate) => candidate.getAttribute('data-kind') === 'amount_changed') as HTMLElement);
    await user.click(changed.getByRole('button', { name: 'Dismiss all' }));
    expect(changed.getByText('Dismiss all 5?')).toBeInTheDocument();
    await user.click(changed.getByRole('button', { name: 'Cancel' }));
    expect(changed.queryByText('Dismiss all 5?')).toBeNull();
    expect(api.callsTo('POST', '/finance/attention/dismiss')).toHaveLength(0);
    await user.click(changed.getByRole('button', { name: 'Dismiss all' }));
    await user.click(changed.getByRole('button', { name: 'Yes, dismiss' }));
    await waitFor(() => expect(api.callsTo('POST', '/finance/attention/bulk')).toHaveLength(1));
    expect(api.callsTo('POST', '/finance/attention/bulk')[0].body).toEqual({ keys: ['c1', 'c2', 'c3', 'c4', 'c5'], action: 'dismiss' });
    expect(api.callsTo('POST', '/finance/attention/dismiss')).toHaveLength(0);
  });

  it('counts the hidden ones at the end, lists them on request and restores one', async () => {
    const api = setup({
      finance: {
        attention: [item('overdraft', 'k5', ['account', 'a-current'], { amount: 4000, currency: 'GBP', state: 'snoozed', snoozed_until: '2026-12-01T00:00:00Z' }), item('overdraft', 'k7', ['account', 'a-card'], { amount: 100, currency: 'GBP', state: 'dismissed' }), item('missed_payment', 'k2', ['recurring', 'r-2'], { amount: 2500, currency: 'GBP', facts: { days_overdue: 3 } })],
        recurring: [rec('r-2', 'Gym')],
      },
    });
    const user = userEvent.setup();
    renderAt(`${PATH}?view=attention`);
    let panel = await attentionPanel();
    expect(panel.getByText('2 hidden')).toBeInTheDocument();
    await user.click(panel.getByRole('button', { name: 'Show hidden' }));
    await waitFor(() => expect(api.calls.filter((call) => call.url.includes('include_hidden=true')).length).toBeGreaterThan(0));
    panel = await attentionPanel();
    const hidden = await panel.findByRole('group', { name: 'Hidden' });
    const rows = within(hidden).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('snoozed until');
    expect(rows[1]).toHaveTextContent('dismissed');
    expect(within(rows[0]).queryByRole('button', { name: /More/ })).toBeNull();
    await user.click(within(rows[0]).getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(api.callsTo('POST', '/finance/attention/restore')[0]?.body).toEqual({ key: 'k5' }));
  });

  it('says so when an action fails, and when a whole group could not be changed', async () => {
    setup({ fail: ['attentionWrite'], finance: { recurring: mixedPayments(), attention: mixedItems() } });
    const user = userEvent.setup();
    renderAt(`${PATH}?view=attention`);
    const panel = await attentionPanel();
    const overdraft = within(panel.getAllByRole('group').find((candidate) => candidate.getAttribute('data-kind') === 'overdraft') as HTMLElement);
    await user.click(overdraft.getByRole('button', { name: 'More: Everyday' }));
    await user.click(overdraft.getByRole('button', { name: 'Dismiss' }));
    expect((await overdraft.findAllByRole('alert'))[0]).toHaveTextContent('That did not work');
    await user.click(overdraft.getByRole('button', { name: 'Snooze all for 7 d' }));
    expect(await overdraft.findByText('Some could not be changed: 2. Try again.')).toBeInTheDocument();
  });

  it('orders the groups by the severity the server gives, then by kind: a plain fact (info) comes after a changed amount (medium)', async () => {
    setup({
      finance: {
        recurring: mixedPayments(),
        attention: [
          item('overdrawn', 'o1', ['account', 'a-current'], { amount: 2500, currency: 'GBP', facts: { balance: -2500, overdraft_limit: null } }),
          item('amount_changed', 'c1', ['recurring', 'r-3'], { amount: 1250, currency: 'GBP', facts: { recorded_amount: 1000, charged_amount: 1250 } }),
          item('overdraft', 'k5', ['account', 'a-card'], { amount: 4000, currency: 'GBP' }),
          // A kind rated higher than its usual place: the server's rating wins.
          item('stale_statement', 'k8', ['connection', 'c-2'], { severity: 'high', facts: { provider: 'hand-bank', as_of: '2026-10-01', days_old: 54 } }),
        ],
      },
    });
    renderAt(`${PATH}?view=attention`);
    const panel = await attentionPanel();
    expect(panel.getAllByRole('group').filter((group) => group.getAttribute('data-kind')).map((group) => group.getAttribute('data-kind'))).toEqual(['overdraft', 'stale_statement', 'amount_changed', 'overdrawn']);
  });

  it('says an overdrawn account with no limit on record, and sets the limit from the row (the owner\'s figure goes to the account)', async () => {
    const api = setup({ finance: { attention: [item('overdrawn', 'o1', ['account', 'a-current'], { amount: 2500, currency: 'GBP', facts: { balance: -2500, overdraft_limit: null } })] } });
    const user = userEvent.setup();
    renderAt(`${PATH}?view=attention`);
    const panel = await attentionPanel();
    const row = within(panel.getByRole('listitem'));
    expect(row.getByText('Everyday')).toBeInTheDocument();
    expect(row.getByText('£25.00 overdrawn · no limit set')).toBeInTheDocument();
    await user.click(row.getByRole('button', { name: 'Set limit' }));
    const form = within(row.getByRole('form', { name: 'Set limit: Everyday' }));
    await user.type(form.getByLabelText(/Overdraft limit/), 'many');
    await user.click(form.getByRole('button', { name: 'Save limit' }));
    expect(await form.findByRole('alert')).toHaveTextContent('Enter an amount like 500');
    expect(api.callsTo('PATCH', '/finance/accounts/a-current')).toHaveLength(0);
    await user.clear(form.getByLabelText(/Overdraft limit/));
    await user.type(form.getByLabelText(/Overdraft limit/), '500');
    await user.click(form.getByRole('button', { name: 'Save limit' }));
    await waitFor(() => expect(api.callsTo('PATCH', '/finance/accounts/a-current')).toHaveLength(1));
    expect(api.callsTo('PATCH', '/finance/accounts/a-current')[0].body).toEqual({ overdraft_limit: 50000 });
  });

  it('speaks Russian: the groups, the facts and the switch', async () => {
    setup({ lang: 'ru', finance: { recurring: mixedPayments(), attention: mixedItems() } });
    renderAt(`${PATH}?view=attention`);
    const panel = within(await within(main()).findByRole('region', { name: 'Требует внимания' }));
    expect(panel.getByRole('heading', { name: /Овердрафт/ })).toBeInTheDocument();
    expect(panel.getAllByText('сверх овердрафта', { exact: false })).toHaveLength(2);
    expect(within(main()).getByRole('navigation', { name: 'Разделы денег' })).toBeInTheDocument();
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
    const user = userEvent.setup();
    renderAt(PATH);
    const panel = within(await within(main()).findByRole('region', { name: 'Upcoming payments' }));
    expect(await panel.findByRole('heading', { level: 3, name: 'Today' })).toBeInTheDocument();
    expect(panel.getByRole('heading', { level: 3, name: 'Tomorrow' })).toBeInTheDocument();
    // By default the next 7 days only: the payment 8 days away waits behind "Show all".
    expect(panel.getAllByRole('listitem').filter((row) => row.getAttribute('data-covered'))).toHaveLength(3);
    await user.click(panel.getByRole('button', { name: 'Show all 4' }));
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
    const user = userEvent.setup();
    renderAt(PATH);
    const panel = within(await within(main()).findByRole('region', { name: 'Upcoming payments' }));
    await user.click(await panel.findByRole('button', { name: 'Show all 5' }));
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
    const user = userEvent.setup();
    renderAt(PATH);
    const panel = within(await within(main()).findByRole('region', { name: 'Debts and installments' }));
    // Collapsed to one summary row: how many and how much is left.
    expect(panel.getByText('2 · £700.00 remaining')).toBeInTheDocument();
    expect(panel.queryAllByRole('listitem')).toHaveLength(0);
    await user.click(panel.getByRole('button', { name: 'Show' }));
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
