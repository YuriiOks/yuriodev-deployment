import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '../context/ThemeContext';
import App from '../App';
import { resetBootstrap } from '../services/dashboards/bootstrapStore';
import { LANG_STORAGE_KEY } from '../services/dashboards/strings';
import { resetStorageFallback } from '../utils/safeStorage';
import { installFakeApi, type FakeApi, type FakeApiOptions, type FinanceData } from '../test/dashboardsApiMock';

// Everything here is invented: made-up banks, balances and names.

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
    accounts: [acct('a-api', 'Everyday', 45050), acct('h-main', 'Current account', 123456, { provider: 'hand-bank', connection_id: 'c-2' })],
    connections: [
      { id: 'c-1', provider: 'acme-bank', status: 'ok', last_ok_at: '2026-11-23T09:00:00Z', manual: false, display_name: null },
      { id: 'c-2', provider: 'hand-bank', status: 'ok', last_ok_at: '2026-11-20T12:00:00Z', manual: true, display_name: 'Hand Bank' },
    ],
    transactions: [],
    summary: { month: '2026-11', as_of: '2026-11-23T09:00:00Z', currencies: [{ currency: 'GBP', accounts: 2, balance: 168506, own_balance: 168506, spent: 0, received: 0 }] },
    providers: [
      { id: 'acme-bank', name: 'Acme Bank', entry: 'api', colors: { background: '#0b3d91', foreground: '#ffffff' }, logo: { on_light: null, on_dark: null, mark: null } },
      { id: 'hand-bank', name: 'Hand Bank', entry: 'manual', colors: { background: '#aa2244', foreground: '#ffffff' }, logo: { on_light: null, on_dark: null, mark: null } },
      { id: 'brand-one', name: 'Brand One', entry: 'manual', colors: { background: '#006a4d', foreground: '#ffffff' }, logo: { on_light: null, on_dark: null, mark: null } },
      { id: 'brand-two', name: 'Brand Two', entry: 'manual', colors: { background: '#50ffeb', foreground: '#321e37' }, logo: { on_light: null, on_dark: null, mark: null } },
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
const openForm = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(wallet().getByRole('button', { name: 'Add a bank' }));
  return within(wallet().getByRole('form', { name: 'Add a bank' }));
};

describe('the Money page: adding a bank entered by hand', () => {
  it('lists the server\'s brands that are not connected yet, and adds the chosen one with its first account', async () => {
    const api = setup();
    const user = userEvent.setup();
    renderAt(ALL);
    await ready();
    const form = await openForm(user);
    const options = within(form.getByLabelText('Bank')).getAllByRole('option').map((option) => option.textContent);
    // Brands with an API or already in the wallet are not offered.
    expect(options).toEqual(['Brand One', 'Brand Two', 'Another bank…']);
    await user.selectOptions(form.getByLabelText('Bank'), 'brand-two');
    await user.clear(form.getByLabelText('Account name'));
    await user.type(form.getByLabelText('Account name'), 'Rainy day');
    await user.selectOptions(form.getByLabelText('Type'), 'savings');
    await user.type(form.getByLabelText('Balance'), '1000.50');
    await user.type(form.getByLabelText('Last four digits (optional)'), '4321');
    await user.click(form.getByRole('button', { name: 'Add bank' }));
    await waitFor(() => expect(api.callsTo('POST', '/finance/manual/accounts')).toHaveLength(1));
    expect(api.callsTo('POST', '/finance/manual/connections')[0].body).toEqual({ provider: 'brand-two' });
    const body = api.callsTo('POST', '/finance/manual/accounts')[0].body as Record<string, unknown>;
    expect(body).toMatchObject({ name: 'Rainy day', kind: 'savings', currency: 'GBP', balance: 100050, mask_last4: '4321' });
    expect(String(body.connection_id)).toMatch(/^conn-/);
    // The new bank is in the wallet and opened.
    const opened = await wallet().findByRole('article', { name: 'Brand Two' });
    expect(within(opened).getByText('Rainy day')).toBeInTheDocument();
    expect(wallet().queryByRole('form', { name: 'Add a bank' })).toBeNull();
  });

  it('makes a bank of the owner\'s own from a name and colours: a neutral id from the name, the colours sent with it, the contrast held', async () => {
    const api = setup();
    const user = userEvent.setup();
    renderAt(ALL);
    await ready();
    const form = await openForm(user);
    await user.selectOptions(form.getByLabelText('Bank'), '__custom');
    await user.type(form.getByLabelText('Bank name'), 'Corner Credit Union!');
    fireEvent.change(form.getByLabelText('Card colour'), { target: { value: '#7a2e8e' } });
    // Text almost the card's own colour: refused before anything is sent.
    fireEvent.change(form.getByLabelText('Text colour'), { target: { value: '#7b2f8f' } });
    expect(form.getByRole('alert')).toHaveTextContent('Choose colours with more contrast');
    await user.type(form.getByLabelText('Balance'), '2525');
    await user.click(form.getByRole('button', { name: 'Add bank' }));
    expect(api.callsTo('POST', '/finance/manual/connections')).toHaveLength(0);
    fireEvent.change(form.getByLabelText('Text colour'), { target: { value: '#ffffff' } });
    await user.click(form.getByRole('button', { name: 'Add bank' }));
    await waitFor(() => expect(api.callsTo('POST', '/finance/manual/accounts')).toHaveLength(1));
    expect(api.callsTo('POST', '/finance/manual/connections')[0].body).toEqual({ provider: 'corner-credit-union', display_name: 'Corner Credit Union!', brand_bg: '#7a2e8e', brand_fg: '#ffffff' });
    // The server's list is asked again, so the bank shows under its own name and colours.
    expect(await wallet().findByRole('article', { name: 'Corner Credit Union!' })).toBeInTheDocument();
  });

  it('takes what is owed and the limit for a credit card, and refuses what cannot be read before sending anything', async () => {
    const api = setup();
    const user = userEvent.setup();
    renderAt(ALL);
    await ready();
    const form = await openForm(user);
    await user.selectOptions(form.getByLabelText('Type'), 'credit_card');
    expect(form.queryByLabelText('Balance')).toBeNull();
    await user.type(form.getByLabelText('Credit limit'), 'lots');
    await user.click(form.getByRole('button', { name: 'Add bank' }));
    expect(await form.findByText('Enter a limit above zero')).toBeInTheDocument();
    await user.clear(form.getByLabelText('Credit limit'));
    await user.type(form.getByLabelText('Credit limit'), '3000');
    await user.type(form.getByLabelText('Owed now'), '-5');
    await user.click(form.getByRole('button', { name: 'Add bank' }));
    expect(await form.findByText(/Enter what is owed/)).toBeInTheDocument();
    await user.clear(form.getByLabelText('Owed now'));
    await user.type(form.getByLabelText('Owed now'), '120.50');
    await user.clear(form.getByLabelText('Currency'));
    await user.type(form.getByLabelText('Currency'), 'gb');
    await user.click(form.getByRole('button', { name: 'Add bank' }));
    expect(await form.findByText('Three capital letters, like GBP')).toBeInTheDocument();
    expect(api.callsTo('POST', '/finance/manual')).toHaveLength(0);
    await user.type(form.getByLabelText('Currency'), 'P');
    await user.click(form.getByRole('button', { name: 'Add bank' }));
    await waitFor(() => expect(api.callsTo('POST', '/finance/manual/accounts')).toHaveLength(1));
    expect(api.callsTo('POST', '/finance/manual/accounts')[0].body).toMatchObject({ kind: 'credit_card', currency: 'GBP', credit_limit: 300000, owed: 12050 });
  });

  it('keeps the bank when only its account is refused: the server\'s words are shown and a second try adds only the account', async () => {
    const api = setup({ fail: ['manualAccount'] });
    const user = userEvent.setup();
    renderAt(ALL);
    await ready();
    const form = await openForm(user);
    await user.type(form.getByLabelText('Balance'), '10');
    await user.click(form.getByRole('button', { name: 'Add bank' }));
    expect(await form.findByRole('alert')).toHaveTextContent('The bank was added but its account was not: a credit card needs credit_limit above 0');
    api.fail.delete('manualAccount');
    // The bank choice is locked: the bank exists now.
    expect(form.getByLabelText('Bank')).toBeDisabled();
    await user.click(form.getByRole('button', { name: 'Add bank' }));
    await waitFor(() => expect(wallet().queryByRole('form', { name: 'Add a bank' })).toBeNull());
    expect(api.callsTo('POST', '/finance/manual/connections')).toHaveLength(1);
    expect(api.callsTo('POST', '/finance/manual/accounts')).toHaveLength(2);
  });

  it('shows the server\'s words when the bank itself is refused, and adds nothing', async () => {
    const api = setup({ fail: ['manualConnection'] });
    const user = userEvent.setup();
    renderAt(ALL);
    await ready();
    const form = await openForm(user);
    await user.type(form.getByLabelText('Balance'), '10');
    await user.click(form.getByRole('button', { name: 'Add bank' }));
    expect(await form.findByRole('alert')).toHaveTextContent('Could not add it: that bank is already entered');
    expect(api.callsTo('POST', '/finance/manual/accounts')).toHaveLength(0);
  });
});

describe('the Money page: adding an account to a bank entered by hand', () => {
  it('is offered on a bank entered by hand only, and adds the account to that bank\'s connection', async () => {
    const api = setup();
    const user = userEvent.setup();
    renderAt(ALL);
    await ready();
    expect(wallet().queryByRole('button', { name: 'Add an account' })).toBeNull();
    await user.click(within(wallet().getByRole('group', { name: 'Banks' })).getByRole('button', { name: /^Hand Bank/ }));
    await user.click(wallet().getByRole('button', { name: 'Add an account' }));
    const form = within(wallet().getByRole('form', { name: 'Add an account' }));
    await user.clear(form.getByLabelText('Account name'));
    await user.type(form.getByLabelText('Account name'), 'Holiday');
    await user.type(form.getByLabelText('Balance'), '-12.5');
    await user.click(form.getByRole('button', { name: 'Add account' }));
    await waitFor(() => expect(api.callsTo('POST', '/finance/manual/accounts')).toHaveLength(1));
    expect(api.callsTo('POST', '/finance/manual/accounts')[0].body).toEqual({ connection_id: 'c-2', name: 'Holiday', kind: 'current', currency: 'GBP', balance: -1250 });
    expect(api.callsTo('POST', '/finance/manual/connections')).toHaveLength(0);
    expect(await wallet().findByText('Holiday')).toBeInTheDocument();
  });
});
