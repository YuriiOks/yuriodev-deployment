import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '../context/ThemeContext';
import App from '../App';
import { resetBootstrap } from '../services/dashboards/bootstrapStore';
import { LANG_STORAGE_KEY } from '../services/dashboards/strings';
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
const prompt = () => main().querySelector('[class*="terminalPrompt"]') as HTMLElement;

function live(options: FakeApiOptions = {}) {
  sessionStorage.setItem('appLoaded', 'true');
  localStorage.clear();
  resetStorageFallback();
  resetBootstrap();
  return installFakeApi(options);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the dashboards bar is the site header\'s prompt, nav and controls', () => {
  it('runs the current place in the site\'s terminal prompt, with the blinking cursor', () => {
    sessionStorage.setItem('appLoaded', 'true');
    localStorage.clear();
    resetStorageFallback();
    for (const [path, place] of [
      ['/dashboards', 'dashboards'],
      ['/dashboards/personal', 'dashboards/personal'],
      ['/dashboards/calendar', 'dashboards/calendar'],
    ]) {
      const view = renderAt(path);
      expect(prompt()).toHaveTextContent(`yurii@yuriodev:~$ ./${place}`);
      expect(prompt().querySelector('[aria-hidden="true"]')).toHaveTextContent('_');
      view.unmount();
    }
  });

  it('on sample data a space\'s prompt uses its bundled name (Russian by default, English when chosen)', () => {
    sessionStorage.setItem('appLoaded', 'true');
    localStorage.clear();
    resetStorageFallback();
    const ru = renderAt('/dashboards/work-1');
    expect(prompt()).toHaveTextContent('./dashboards/работа-1');
    ru.unmount();
    localStorage.setItem(LANG_STORAGE_KEY, 'en');
    renderAt('/dashboards/work-1');
    expect(prompt()).toHaveTextContent('./dashboards/work-1');
  });

  it('uses the server\'s name for a space, and a project\'s name on its page', async () => {
    live({ spaceNames: { 'work-1': 'Acme Corp' }, projects: [{ id: 'garden', name: 'Garden' }] });
    const first = renderAt('/dashboards/work-1');
    await screen.findByRole('link', { name: 'Acme Corp' });
    expect(prompt()).toHaveTextContent('./dashboards/acme-corp');
    first.unmount();

    live({ projects: [{ id: 'garden', name: 'Garden' }] });
    renderAt('/dashboards/projects/garden');
    await screen.findByRole('heading', { level: 1, name: 'Garden' });
    expect(prompt()).toHaveTextContent('./dashboards/projects/garden');
  });

  it('marks the current page as the site marks its own (aria-current, the .current underline) and links to the pages and the portfolio', () => {
    sessionStorage.setItem('appLoaded', 'true');
    localStorage.clear();
    resetStorageFallback();
    renderAt('/dashboards/work-2');
    const nav = within(main()).getByRole('navigation', { name: 'Дашборды' });
    expect(within(nav).getByRole('link', { name: 'Работа 2' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Работа 2' }).className).toMatch(/current/);
    expect(within(nav).getByRole('link', { name: 'Работа 1' })).not.toHaveAttribute('aria-current');
    const back = within(main()).getByRole('link', { name: 'yuriodev: на сайт' });
    expect(back).toHaveAttribute('href', '/');
    expect(back).toHaveTextContent('Портфолио');
    expect(within(nav).queryByRole('link', { name: 'yuriodev: на сайт' })).toBeNull();
  });

  it('has RU and EN as the site\'s controls, the language in use marked, and the theme button with the site\'s glyph', async () => {
    sessionStorage.setItem('appLoaded', 'true');
    localStorage.clear();
    resetStorageFallback();
    const user = userEvent.setup();
    renderAt('/dashboards');
    const group = within(main()).getByRole('group', { name: 'Язык' });
    expect(within(group).getByRole('button', { name: 'RU' }).className).toMatch(/current/);
    await user.click(within(group).getByRole('button', { name: 'EN' }));
    expect(within(group).getByRole('button', { name: 'EN' }).className).toMatch(/current/);
    expect(within(group).getByRole('button', { name: 'RU' }).className).not.toMatch(/current/);
    const theme = within(main()).getByRole('button', { name: /theme/ });
    expect(theme).toHaveTextContent(/^[☾☀]$/);
    expect(within(main()).getByRole('link', { name: 'yuriodev: back to the site' })).toHaveTextContent('Portfolio');
  });

  it('adds no palette or help buttons and no site header (the public header is untouched)', () => {
    sessionStorage.setItem('appLoaded', 'true');
    localStorage.clear();
    resetStorageFallback();
    renderAt('/dashboards');
    expect(screen.queryByRole('banner')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open command palette' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show help panel' })).toBeNull();
  });
});
