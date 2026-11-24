import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '../context/ThemeContext';
import App from '../App';
import { resetBootstrap } from '../services/dashboards/bootstrapStore';
import { LANG_STORAGE_KEY } from '../services/dashboards/strings';
import { resetStorageFallback } from '../utils/safeStorage';
import { installFakeApi, type FakeApi, type FakeApiOptions, type FinanceData } from '../test/dashboardsApiMock';

// Everything here is invented: a made-up bank entered by hand, made-up balances and statement totals.

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

function finance(overrides: Partial<FinanceData> = {}): FinanceData {
  return {
    accounts: [
      acct('a-api', 'Everyday', 45050),
      acct('h-main', 'Current account', 123456, { provider: 'hand-bank', connection_id: 'c-2' }),
      acct('h-card', 'Plastic card', 70000, { provider: 'hand-bank', connection_id: 'c-2', kind: 'credit_card', type: 'credit', credit_limit: 100000, own_balance_minor: -30000 }),
    ],
    connections: [
      { provider: 'acme-bank', status: 'ok', last_ok_at: '2026-11-23T09:00:00Z', manual: false, display_name: null },
      { provider: 'hand-bank', status: 'ok', last_ok_at: '2026-11-01T12:00:00Z', manual: true, display_name: 'Hand Bank' },
    ],
    transactions: [],
    summary: { month: '2026-11', as_of: '2026-11-23T09:00:00Z', currencies: [{ currency: 'GBP', accounts: 3, balance: 138506, own_balance: 138506, spent: 0, received: 0 }] },
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
const bankButton = (name: string) => wallet().getByRole('button', { name: new RegExp(`^${name}`) });
const bankCard = (name: string) => bankButton(name).parentElement as HTMLElement;
const opened = () => within(wallet().getByRole('article'));

async function openHandBank() {
  const user = userEvent.setup();
  renderAt(PATH);
  await within(main()).findByRole('region', { name: 'Wallet' });
  await wallet().findByRole('group', { name: 'Banks' });
  await user.click(bankButton('Hand Bank'));
  return user;
}

describe('the Money page: a bank entered by hand', () => {
  it('takes the bank\'s name and colours from the server, and says its balance is as of a date instead of a link state', async () => {
    setup();
    await openHandBank();
    expect(bankCard('Hand Bank').getAttribute('style')).toContain('--bank-bg: #aa2244');
    expect(bankCard('Acme Bank').getAttribute('style')).toContain('--bank-bg: #0b3d91');
    expect(bankCard('Hand Bank')).toHaveTextContent('balance as of Nov 1, 2026');
    expect(bankCard('Hand Bank')).not.toHaveTextContent(/connected|updated/);
    expect(opened().getByRole('heading', { level: 3, name: 'Hand Bank' })).toBeInTheDocument();
    expect(wallet().getByRole('article')).toHaveTextContent('balance as of Nov 1, 2026');
  });

  it('keeps the table\'s colours and the id\'s name for a server that sends neither', async () => {
    setup({ finance: finance({ providers: [] }) });
    renderAt(PATH);
    await within(main()).findByRole('region', { name: 'Wallet' });
    await wallet().findByRole('group', { name: 'Banks' });
    expect(bankButton('Hand bank')).toBeInTheDocument();
    expect(bankCard('Hand bank').getAttribute('style')).toBeNull();
  });

  it('offers the balance and statement tools on the accounts of a bank entered by hand only', async () => {
    setup();
    const user = await openHandBank();
    expect(opened().getAllByRole('button', { name: 'Update balance' })).toHaveLength(2);
    expect(opened().getAllByRole('button', { name: 'Upload statement' })).toHaveLength(2);
    await user.click(bankButton('Acme Bank'));
    expect(opened().queryByRole('button', { name: 'Update balance' })).toBeNull();
    expect(opened().queryByRole('button', { name: 'Upload statement' })).toBeNull();
  });

  it('sets a balance with a date, asks for the accounts again and shows the new figure and date', async () => {
    const api = setup();
    const user = await openHandBank();
    const account = opened().getByText('Current account').closest('li') as HTMLElement;
    await user.click(within(account).getByRole('button', { name: 'Update balance' }));
    const form = within(within(account).getByRole('form', { name: 'Update balance: Current account' }));
    const amount = form.getByLabelText(/Balance/);
    await user.clear(amount);
    await user.type(amount, '-250.50');
    await user.type(form.getByLabelText('As of'), '2026-11-20');
    await user.click(form.getByRole('button', { name: 'Save balance' }));
    await waitFor(() => expect(api.callsTo('POST', '/finance/manual/accounts/h-main/balance')).toHaveLength(1));
    expect(api.callsTo('POST', '/finance/manual/accounts/h-main/balance')[0].body).toEqual({ balance: -25050, as_of: '2026-11-20' });
    await waitFor(() => expect(wallet().getByRole('article')).toHaveTextContent('balance as of Nov 20, 2026'));
    expect(opened().getByText('Current account').closest('li')).toHaveTextContent('-£250.50');
    // The form closed.
    expect(opened().queryByRole('form', { name: 'Update balance: Current account' })).toBeNull();
  });

  it('sends what is owed for a card, refuses an amount it cannot read before asking, and says so when the server fails', async () => {
    const api = setup();
    const user = await openHandBank();
    const card = opened().getByText('Plastic card').closest('li') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: 'Update balance' }));
    const form = within(within(card).getByRole('form', { name: 'Update balance: Plastic card' }));
    const amount = form.getByLabelText(/Owed on the card/);
    expect(amount).toHaveValue('300.00');
    await user.clear(amount);
    await user.type(amount, 'lots');
    await user.click(form.getByRole('button', { name: 'Save balance' }));
    expect(await form.findByRole('alert')).toHaveTextContent('Enter what is owed now');
    expect(api.callsTo('POST', '/finance/manual')).toHaveLength(0);
    await user.clear(amount);
    await user.type(amount, '120');
    api.fail.add('manualWrite');
    await user.click(form.getByRole('button', { name: 'Save balance' }));
    expect(await form.findByRole('alert')).toHaveTextContent('Could not save the balance');
    expect(api.callsTo('POST', '/finance/manual/accounts/h-card/balance')[0].body).toEqual({ owed: 12000 });
  });

  it('checks a statement first (nothing saved, the totals to compare), then imports it and asks for the data again', async () => {
    const api = setup();
    const user = await openHandBank();
    const account = opened().getByText('Current account').closest('li') as HTMLElement;
    await user.click(within(account).getByRole('button', { name: 'Upload statement' }));
    const group = within(within(account).getByRole('group', { name: 'Upload statement: Current account' }));
    // No file yet.
    await user.click(group.getByRole('button', { name: 'Check the file' }));
    expect(await group.findByRole('alert')).toHaveTextContent('Choose a statement file.');
    await user.upload(group.getByLabelText('Statement file'), new File(['date,description,amount\n2026-10-01,Coffee,-3.50\n'], 'october.csv', { type: 'text/csv' }));
    await user.click(group.getByRole('button', { name: 'Check the file' }));
    expect(await group.findByText('Lines read: 3')).toBeInTheDocument();
    expect(group.getByText('New: 3')).toBeInTheDocument();
    expect(group.getByText('Already there: 0')).toBeInTheDocument();
    expect(group.getByText('From Oct 1, 2026 to Oct 31, 2026')).toBeInTheDocument();
    expect(group.getByText('Money in: £1,500.00')).toBeInTheDocument();
    expect(group.getByText('Money out: £45.50')).toBeInTheDocument();
    expect(group.getByText(/Nothing is saved yet/)).toBeInTheDocument();
    const checks = api.calls.filter((call) => call.url.includes('/statement'));
    expect(checks).toHaveLength(1);
    expect(checks[0].url).toContain('dry_run=true');
    // A changed choice asks for the check again.
    await user.selectOptions(group.getByLabelText('Date order'), 'dmy');
    expect(group.queryByRole('button', { name: 'Import' })).toBeNull();
    await user.click(group.getByRole('button', { name: 'Check the file' }));
    await user.click(await group.findByRole('button', { name: 'Import' }));
    await group.findByText('Imported.');
    const uploads = api.calls.filter((call) => call.url.includes('/statement'));
    expect(uploads).toHaveLength(3);
    expect(uploads[2].url).toContain('date_order=dmy');
    expect(uploads[2].url).not.toContain('dry_run');
    // The accounts were asked for again.
    await waitFor(() => expect(api.callsTo('GET', '/finance/accounts').length).toBeGreaterThan(1));
  });

  it('lists every bad line of a refused file and offers no import, and shows the server\'s words when the layout is not known', async () => {
    const api = setup({
      finance: finance({ manualStatement: { status: 422, body: { layout: 'csv', parsed: 3, created: 0, duplicates: 0, first_date: null, last_date: null, money_in: 0, money_out: 0, balance_applied: false, errors: [{ row: 2, field: 'date', message: 'cannot read the date' }, { row: 3, field: 'amount', message: 'too many decimals' }] } } }),
    });
    const user = await openHandBank();
    const account = opened().getByText('Current account').closest('li') as HTMLElement;
    await user.click(within(account).getByRole('button', { name: 'Upload statement' }));
    const group = within(within(account).getByRole('group', { name: 'Upload statement: Current account' }));
    await user.upload(group.getByLabelText('Statement file'), new File(['x'], 'bad.csv', { type: 'text/csv' }));
    await user.click(group.getByRole('button', { name: 'Check the file' }));
    expect(await group.findByText('Lines to fix (2)')).toBeInTheDocument();
    expect(group.getByText('Line 2: date: cannot read the date')).toBeInTheDocument();
    expect(group.getByText('Line 3: amount: too many decimals')).toBeInTheDocument();
    expect(group.queryByRole('button', { name: 'Import' })).toBeNull();
    expect(api.calls.filter((call) => call.url.includes('/statement'))).toHaveLength(1);
  });

  it('tells what the server says when a statement cannot be read at all', async () => {
    setup({ fail: ['manualWrite'] });
    const user = await openHandBank();
    const account = opened().getByText('Current account').closest('li') as HTMLElement;
    await user.click(within(account).getByRole('button', { name: 'Upload statement' }));
    const group = within(within(account).getByRole('group', { name: 'Upload statement: Current account' }));
    await user.upload(group.getByLabelText('Statement file'), new File(['x'], 'any.csv', { type: 'text/csv' }));
    await user.click(group.getByRole('button', { name: 'Check the file' }));
    expect(await group.findByRole('alert')).toHaveTextContent('Could not upload the file');
  });
});

describe('the Money page: a statement that is out of date', () => {
  it('shows the attention item as a card with the bank\'s name and, in its details, a sentence with the date and the way to upload a statement', async () => {
    setup({
      finance: finance({
        attention: [
          { key: 'stale_statement:c-2:2026-10-01', kind: 'stale_statement', title: 'English title', subject_type: 'connection', subject_id: 'c-2', due_date: null, amount: null, currency: null, display_amount: null, converted: false, facts: { provider: 'hand-bank', as_of: '2026-10-01', days_old: 54 }, state: 'active', snoozed_until: null },
        ],
      }),
    });
    renderAt(PATH);
    const panel = within(await within(main()).findByRole('region', { name: 'Needs attention' }));
    // A card in the row with the bank's own name and the fact in a few words.
    const card = panel.getByRole('button', { name: /Hand Bank/ });
    expect(card).toHaveTextContent('as of Oct 1, 2026, 54 d old');
    await userEvent.setup().click(card);
    const dialog = within(screen.getByRole('dialog', { name: 'Hand Bank' }));
    expect(dialog.getByText('The data of Hand Bank is out of date: the newest is from Oct 1, 2026 (54 d ago).')).toBeInTheDocument();
    expect(dialog.getByRole('link', { name: 'Upload statement' })).toHaveAttribute('href', '#money-wallet-title');
  });
});
