import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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

  it('on sample data a space\'s prompt is its route slug, whatever the language', () => {
    sessionStorage.setItem('appLoaded', 'true');
    localStorage.clear();
    resetStorageFallback();
    const ru = renderAt('/dashboards/work-1');
    expect(prompt()).toHaveTextContent('./dashboards/work-1');
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

describe('the bar lists the user\'s projects', () => {
  const nav = () => within(main()).getByRole('navigation', { name: 'Дашборды' });
  const links = () => within(nav()).getAllByRole('link').map((link) => link.textContent);

  it('puts the projects that are not archived after a divider that follows the fixed pages, in the server\'s order', async () => {
    live({ projects: [{ id: 'garden', name: 'Garden', icon: 'leaf' }, { id: 'old', name: 'Old one', archived: true }, { id: 'court', name: 'Court' }] });
    renderAt('/dashboards');
    await within(nav()).findByRole('link', { name: 'Garden' });
    expect(links()).toEqual(['Все', 'Личное', 'Работа 1', 'Работа 2', 'Календарь', 'Garden', 'Court']);
    const divider = within(nav()).getByRole('separator', { name: 'Проекты' });
    // The divider sits between Calendar and the first project, in one row.
    const all = Array.from(nav().children);
    expect(all.indexOf(divider)).toBe(all.indexOf(within(nav()).getByRole('link', { name: 'Garden' })) - 1);
    expect(all.indexOf(within(nav()).getByRole('link', { name: 'Календарь' }))).toBe(all.indexOf(divider) - 1);
    expect(within(nav()).getByRole('link', { name: 'Garden' })).toHaveAttribute('href', '/dashboards/projects/garden');
    expect(within(nav()).queryByRole('link', { name: 'Old one' })).toBeNull();
  });

  it('marks the project whose page it is as the current page, and no other pill', async () => {
    live({ projects: [{ id: 'garden', name: 'Garden' }, { id: 'court', name: 'Court' }] });
    renderAt('/dashboards/projects/court');
    const court = await within(nav()).findByRole('link', { name: 'Court' });
    expect(court).toHaveAttribute('aria-current', 'page');
    expect(court.className).toMatch(/current/);
    expect(within(nav()).getByRole('link', { name: 'Garden' })).not.toHaveAttribute('aria-current');
    expect(within(nav()).getByRole('link', { name: 'Все' })).not.toHaveAttribute('aria-current');
  });

  it('has no projects and no divider on the sample data', () => {
    sessionStorage.setItem('appLoaded', 'true');
    localStorage.clear();
    resetStorageFallback();
    renderAt('/dashboards');
    expect(links()).toEqual(['Все', 'Личное', 'Работа 1', 'Работа 2', 'Календарь']);
    expect(within(nav()).queryByRole('separator')).toBeNull();
  });

  it('has no divider while the user has no project', async () => {
    live();
    renderAt('/dashboards/personal');
    await within(nav()).findByRole('link', { name: 'Личное' });
    expect(within(nav()).queryByRole('separator')).toBeNull();
  });

  it('follows a create, a rename, an icon change and an archive without a reload, and the prompt follows the name', async () => {
    live({ projects: [{ id: 'garden', name: 'Garden' }] });
    const user = userEvent.setup();
    renderAt('/dashboards');
    await within(nav()).findByRole('link', { name: 'Garden' });
    const section = await within(main()).findByRole('region', { name: 'Проекты' });
    await user.click(await within(section).findByRole('button', { name: 'Новый проект' }));
    await user.type(within(section).getByLabelText('Название проекта'), 'Court case{Enter}');
    expect(await within(nav()).findByRole('link', { name: 'Court case' })).toBeInTheDocument();
    expect(links().slice(-2)).toEqual(['Garden', 'Court case']);

    await user.click(within(nav()).getByRole('link', { name: 'Garden' }));
    await user.click(await within(main()).findByRole('button', { name: 'Переименовать' }));
    const field = within(main()).getByLabelText('Название проекта');
    await user.clear(field);
    await user.type(field, 'Allotment{Enter}');
    expect(await within(nav()).findByRole('link', { name: 'Allotment' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav()).queryByRole('link', { name: 'Garden' })).toBeNull();

    await user.click(within(main()).getByRole('button', { name: 'Значок' }));
    await user.click(within(main()).getByRole('radio', { name: 'Книга' }));
    await waitFor(() => expect(within(nav()).getByRole('link', { name: 'Allotment' }).querySelector('svg[data-icon="book"]')).not.toBeNull());

    await user.click(within(main()).getByRole('button', { name: 'В архив' }));
    await user.click(within(main()).getByRole('button', { name: 'Подтвердить архивацию' }));
    await waitFor(() => expect(within(nav()).queryByRole('link', { name: 'Allotment' })).toBeNull());
    expect(links().slice(-1)).toEqual(['Court case']);
  });

  it('asks for the list once however many parts read it', async () => {
    const api = live({ projects: [{ id: 'garden', name: 'Garden' }] });
    renderAt('/dashboards/projects/garden');
    await screen.findByRole('heading', { level: 1, name: 'Garden' });
    expect(api.calls.filter((call) => call.method === 'GET' && call.path === '/projects')).toHaveLength(1);
  });

  it('shows a project\'s name in the prompt as soon as the list is in, and not a stale one after a rename', async () => {
    live({ projects: [{ id: 'garden', name: 'Garden' }] });
    const user = userEvent.setup();
    renderAt('/dashboards/projects/garden');
    await screen.findByRole('heading', { level: 1, name: 'Garden' });
    await user.click(within(main()).getByRole('button', { name: 'Переименовать' }));
    const field = within(main()).getByLabelText('Название проекта');
    await user.clear(field);
    await user.type(field, 'Allotment{Enter}');
    await screen.findByRole('heading', { level: 1, name: 'Allotment' });
    expect(prompt()).toHaveTextContent('./dashboards/projects/allotment');
  });
});

describe('every pill in the bar carries a decorative mark', () => {
  it('has a mark (aria-hidden, no alt text) on All, each space, Calendar and each project, and the pill\'s name is just its text', async () => {
    live({ projects: [{ id: 'garden', name: 'Garden', icon: 'leaf' }, { id: 'court', name: 'Court' }] });
    renderAt('/dashboards');
    const nav = within(main()).getByRole('navigation', { name: 'Дашборды' });
    await within(nav).findByRole('link', { name: 'Garden' });
    const pills = within(nav).getAllByRole('link');
    expect(pills).toHaveLength(7);
    for (const pill of pills) {
      const mark = pill.firstElementChild as HTMLElement;
      expect(mark, pill.textContent ?? '').toHaveAttribute('aria-hidden', 'true');
      expect(mark.className).toMatch(/mark/);
      for (const image of Array.from(pill.querySelectorAll('img'))) expect(image).toHaveAttribute('alt', '');
    }
    // All and Calendar are drawn from the same set as the projects' icons; a project without an icon has its letter.
    expect(within(nav).getByRole('link', { name: 'Все' }).querySelector('svg[data-icon="grid"]')).not.toBeNull();
    expect(within(nav).getByRole('link', { name: 'Календарь' }).querySelector('svg[data-icon="calendar"]')).not.toBeNull();
    expect(within(nav).getByRole('link', { name: 'Garden' }).querySelector('svg[data-icon="leaf"]')).not.toBeNull();
    expect(within(nav).getByRole('link', { name: 'Court' }).firstElementChild).toHaveTextContent('C');
    // A space shows its card's mark: the letter or number tile on sample-like data, the server's icon as an image.
    expect(within(nav).getByRole('link', { name: 'Работа 1' }).firstElementChild).toHaveTextContent(/\S/);
  });

  it('shows a space\'s server icon in its pill, as the hub card does', async () => {
    live({ spaceIcons: { 'work-1': 'data:image/png;base64,AAAA' } });
    renderAt('/dashboards');
    const nav = within(main()).getByRole('navigation', { name: 'Дашборды' });
    const pill = await within(nav).findByRole('link', { name: 'Работа 1' });
    const image = pill.querySelector('img') as HTMLImageElement;
    expect(image).toHaveAttribute('src', 'data:image/png;base64,AAAA');
    expect(image).toHaveAttribute('alt', '');
  });

  it('has marks on the sample data too (All, spaces, Calendar)', () => {
    sessionStorage.setItem('appLoaded', 'true');
    localStorage.clear();
    resetStorageFallback();
    renderAt('/dashboards');
    const nav = within(main()).getByRole('navigation', { name: 'Дашборды' });
    for (const pill of within(nav).getAllByRole('link')) expect(pill.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });
});
