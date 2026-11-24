import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '../context/ThemeContext';
import App from '../App';
import { readBarCache, writeBarCache } from '../services/dashboards/barCache';
import { resetBootstrap } from '../services/dashboards/bootstrapStore';
import { parseBootstrap } from '../services/dashboards/liveApi';
import { resetStorageFallback } from '../utils/safeStorage';
import { installFakeApi, type FakeApiOptions } from '../test/dashboardsApiMock';

function renderAt(path: string) {
  window.history.pushState({}, '', path);
  return render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
}

const main = () => screen.getByRole('main');
const nav = () => within(main()).getByRole('navigation', { name: 'Дашборды' });
const KEY = 'dashboards-bar-v1';

function fresh() {
  sessionStorage.setItem('appLoaded', 'true');
  localStorage.clear();
  resetStorageFallback();
  resetBootstrap();
}

/** The bootstrap never answers: what is on screen is the first paint. */
function neverAnswers() {
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
}

/** Keeps a last visit's bar state, as a live answer leaves it. */
function remember() {
  const bootstrap = parseBootstrap({
    enabled: true,
    spaces: [{ id: 'work-1', name: 'Acme Corp', icon: 'data:image/png;base64,AAAA' }],
    projects: [{ id: 'garden', name: 'Garden', icon: 'leaf' }, { id: 'court', name: 'Court', icon: null }],
  });
  if (!bootstrap) throw new Error('fixture');
  writeBarCache(bootstrap);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the bar paints once, in its final layout', () => {
  it('with a kept state, the very first render has the server names, the icon and the project pills', () => {
    fresh();
    remember();
    neverAnswers();
    renderAt('/dashboards');
    // Nothing has been answered yet; the pills are already the last visit's.
    expect(within(nav()).getByRole('link', { name: 'Acme Corp' }).querySelector('img')).toHaveAttribute('src', 'data:image/png;base64,AAAA');
    expect(within(nav()).getByRole('link', { name: 'Garden' }).querySelector('svg[data-icon="leaf"]')).not.toBeNull();
    expect(within(nav()).getByRole('link', { name: 'Court' })).toBeInTheDocument();
    expect(within(nav()).queryByText(/Работа 1/)).toBeNull();
    expect(within(nav()).queryAllByRole('separator')).toHaveLength(1);
    expect(nav().querySelectorAll('[data-skeleton]')).toHaveLength(0);
  });

  it('without a kept state, the first render has quiet placeholders and none of the bundled names or number tiles', () => {
    fresh();
    neverAnswers();
    renderAt('/dashboards');
    expect(nav().querySelectorAll('[data-skeleton]')).toHaveLength(5);
    expect(nav()).toHaveAttribute('aria-busy', 'true');
    expect(within(nav()).queryAllByRole('link')).toHaveLength(0);
    for (const bundled of [/Работа 1/, /Работа 2/, /Личное/, /Work 1/]) expect(within(nav()).queryByText(bundled)).toBeNull();
    // What cannot change is there: the prompt, the portfolio link and the switches.
    expect(within(main()).getByRole('link', { name: 'yuriodev: на сайт' })).toBeInTheDocument();
    expect(within(main()).getByRole('group', { name: 'Язык' })).toBeInTheDocument();
  });

  it('keeps the prompt\'s two forms in the markup whatever arrives (the width alone picks one), with no data attribute that flips it', async () => {
    fresh();
    installFakeApi({ projects: [{ id: 'garden', name: 'Garden' }] });
    renderAt('/dashboards');
    const bar = main().querySelector('[class*="terminalPrompt"]') as HTMLElement;
    const before = bar.innerHTML;
    await within(nav()).findByRole('link', { name: 'Garden' });
    expect(bar.innerHTML).toBe(before);
    expect(bar.closest('[data-projects]')).toBeNull();
  });

  it('reconciles silently: the answer replaces the kept names, writes the new state, and a changed project list shows', async () => {
    fresh();
    remember();
    installFakeApi({ spaceNames: { 'work-1': 'Globex' }, projects: [{ id: 'garden', name: 'Garden' }, { id: 'side', name: 'Side' }] });
    renderAt('/dashboards');
    expect(within(nav()).getByRole('link', { name: 'Acme Corp' })).toBeInTheDocument();
    await within(nav()).findByRole('link', { name: 'Globex' });
    expect(within(nav()).queryByRole('link', { name: 'Acme Corp' })).toBeNull();
    await within(nav()).findByRole('link', { name: 'Side' });
    expect(within(nav()).queryByRole('link', { name: 'Court' })).toBeNull();
    await waitFor(() => expect(readBarCache()?.spaceNames['work-1']).toBe('Globex'));
    expect(readBarCache()?.projects.map((project) => project.id)).toEqual(['garden', 'side']);
  });

  it('shows the bundled names once the answer says sample data, and forgets the kept state', async () => {
    fresh();
    remember();
    installFakeApi({ enabled: false });
    renderAt('/dashboards');
    expect(within(nav()).getByRole('link', { name: 'Acme Corp' })).toBeInTheDocument();
    await within(nav()).findByRole('link', { name: 'Работа 1' });
    expect(within(nav()).queryByRole('link', { name: 'Acme Corp' })).toBeNull();
    expect(within(nav()).queryAllByRole('separator')).toHaveLength(0);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('keeps the kept state when the answer fails (a network error is not "disabled")', async () => {
    fresh();
    remember();
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))));
    renderAt('/dashboards');
    await within(nav()).findByRole('link', { name: 'Работа 1' });
    expect(localStorage.getItem(KEY)).not.toBeNull();
  });

  it('writes the project list into the kept state once it is loaded', async () => {
    fresh();
    const options: FakeApiOptions = { projects: [{ id: 'garden', name: 'Garden' }] };
    installFakeApi(options);
    renderAt('/dashboards');
    await within(nav()).findByRole('link', { name: 'Garden' });
    await waitFor(() => expect(readBarCache()?.projects.map((project) => project.id)).toEqual(['garden']));
  });
});

describe('the kept state is validated on read', () => {
  it('ignores anything that is not JSON, not a live answer, or not valid, and drops a bad icon or name', () => {
    fresh();
    localStorage.setItem(KEY, '{not json');
    expect(readBarCache()).toBeNull();
    localStorage.setItem(KEY, JSON.stringify({ enabled: false }));
    expect(readBarCache()).toBeNull();
    localStorage.setItem(KEY, JSON.stringify({ enabled: true, spaces: [{ id: 'work-1', name: 'Ok', icon: 'https://evil.example/x.png' }, { id: 'nope', name: 'X' }], projects: [{ id: 'a', name: 'A', icon: 'Bad Key' }, { id: 5 }] }));
    const read = readBarCache();
    expect(read?.spaceNames).toEqual({ 'work-1': 'Ok' });
    expect(read?.spaceIcons).toEqual({});
    expect(read?.projects).toEqual([{ id: 'a', name: 'A', icon: null }]);
  });

  it('survives a storage that throws', () => {
    fresh();
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readBarCache()).toBeNull();
    spy.mockRestore();
  });
});
