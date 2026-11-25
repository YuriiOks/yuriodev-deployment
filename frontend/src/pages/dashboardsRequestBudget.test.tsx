import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '../context/ThemeContext';
import App from '../App';
import { resetBootstrap } from '../services/dashboards/bootstrapStore';
import { iconBundles, logoBundles } from '../services/dashboards/imageBundles';
import { LANG_STORAGE_KEY } from '../services/dashboards/strings';
import { resetStorageFallback } from '../utils/safeStorage';
import { installFakeApi, type FakeApi, type FakeApiOptions } from '../test/dashboardsApiMock';

// Everything here is invented. The CDN in front of the site limits what one visitor may send, so a first view of a page asks for very little.

function renderAt(path: string) {
  window.history.pushState({}, '', path);
  return render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
}

const main = () => screen.getByRole('main');
const V = '0123456789abcdef';
const BUNDLES = ['/finance/providers/logos', '/finance/recurring/icons'];
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

const emptyToday = (scope: string, extra: Record<string, unknown> = {}) => ({
  scope,
  date: '2026-11-24',
  generated_at: '2026-11-24T08:00:00Z',
  summary: { code: scope, facts: scope === 'money' ? { currency: 'GBP', total: 150000, complete: true } : { open: 0, priority: 0, overdue: 0 } },
  queue: [],
  queue_total: 0,
  soon: [],
  stats: [],
  breakdown: { code: scope === 'money' ? 'spent_by_category' : 'open_by_area', rows: [], insight: null },
  today: [],
  assistant: { enabled: false },
  ...extra,
});

function setup(options: FakeApiOptions = {}, keepStorage = false): FakeApi {
  sessionStorage.setItem('appLoaded', 'true');
  if (!keepStorage) localStorage.clear();
  localStorage.setItem(LANG_STORAGE_KEY, 'en');
  resetStorageFallback();
  resetBootstrap();
  logoBundles.reset();
  iconBundles.reset();
  return installFakeApi(options);
}

const gets = (api: FakeApi) => api.calls.filter((call) => call.method === 'GET');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  cleanup();
});

describe('requests per page view', () => {
  it('the Money Today view asks for the bootstrap, its one answer and the two bundles, and nothing else', async () => {
    const api = setup({
      today: { money: emptyToday('money', { logos_version: V, icons_version: V }) },
      finance: { logosBundle: { version: V, logos: { 'acme-bank': { on_light: PNG, on_dark: PNG, mark: PNG } } }, iconsBundle: { version: V, icons: { 'r-1': PNG } } },
    });
    renderAt('/dashboards/personal/money');
    await waitFor(() => expect(main()).toHaveTextContent(/Good (morning|afternoon|evening)/));
    await waitFor(() => expect(gets(api).filter((call) => BUNDLES.includes(call.path))).toHaveLength(2));
    expect(gets(api).length).toBeLessThanOrEqual(4);
    expect(gets(api).filter((call) => call.path.includes('/finance/') && !BUNDLES.includes(call.path))).toEqual([]);
  });

  it('asks for two requests on a reload with the bundles stored, and a tab switch does not ask for the bootstrap again', async () => {
    const options: FakeApiOptions = {
      today: { money: emptyToday('money', { logos_version: V, icons_version: V }) },
      finance: { logosBundle: { version: V, logos: { 'acme-bank': { on_light: PNG, on_dark: PNG, mark: PNG } } }, iconsBundle: { version: V, icons: { 'r-1': PNG } } },
    };
    const first = setup(options);
    renderAt('/dashboards/personal/money');
    await waitFor(() => expect(gets(first).length).toBeGreaterThanOrEqual(4));
    cleanup();
    const second = setup(options, true);
    // The stored copies are what a reload finds: the bundle stores read them back.
    renderAt('/dashboards/personal/money');
    await waitFor(() => expect(main()).toHaveTextContent(/Good (morning|afternoon|evening)/));
    expect(gets(second).length).toBeLessThanOrEqual(2);
    expect(gets(second).filter((call) => call.path.includes('/bootstrap'))).toHaveLength(1);
  });

  it.each(['personal', 'work-1', 'work-2'])('the Today tab of %s asks for the bootstrap and its one answer only', async (space) => {
    const api = setup({ today: { [space]: emptyToday(space) } });
    renderAt(`/dashboards/${space}`);
    await waitFor(() => expect(main()).toHaveTextContent(/Good (morning|afternoon|evening)/));
    expect(gets(api).length).toBeLessThanOrEqual(4);
    expect(gets(api).map((call) => call.path.split('?')[0]).sort()).toEqual(['/bootstrap', '/today']);
  });

  it('recovers quietly when a request is refused with 429 once: no error state, the placeholder stays until it works', async () => {
    const api = setup({ today: { money: emptyToday('money') } });
    const inner = globalThis.fetch;
    let refused = 0;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/bootstrap') && refused === 0) {
        refused += 1;
        return Promise.resolve(new Response('{}', { status: 429, headers: { 'content-type': 'application/json', 'Retry-After': '0' } }));
      }
      return inner(input, init);
    });
    renderAt('/dashboards/personal/money');
    expect(screen.queryByText(/Cannot reach the server/i)).toBeNull();
    await waitFor(() => expect(main()).toHaveTextContent(/Good (morning|afternoon|evening)/));
    expect(refused).toBe(1);
    expect(screen.queryByText(/Cannot reach the server/i)).toBeNull();
    expect(gets(api).filter((call) => call.path.includes('/bootstrap'))).toHaveLength(1);
  });

  it('a bundle that fails to load makes no per-image requests', async () => {
    // No bundle behind the version: both bundle requests answer 404.
    const api = setup({ today: { money: emptyToday('money', { logos_version: V, icons_version: V }) } });
    renderAt('/dashboards/personal/money');
    await waitFor(() => expect(main()).toHaveTextContent(/Good (morning|afternoon|evening)/));
    await waitFor(() => expect(gets(api).filter((call) => call.path.endsWith('/logos'))).toHaveLength(1));
    expect(gets(api).filter((call) => /\/(logo|icon)(\?|$)/.test(call.path))).toEqual([]);
  });
});
