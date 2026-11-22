import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '../context/ThemeContext';
import App from '../App';
import { NAV_PAGES, PAGES, pagePath } from '../data/site';
import { LANG_STORAGE_KEY } from '../services/dashboards/strings';
import { resetStorageFallback } from '../utils/safeStorage';

function renderAt(path: string) {
  window.history.pushState({}, '', path);
  return render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
}

const main = () => screen.getByRole('main');

describe('the private dashboards: routes', () => {
  beforeEach(() => {
    // Skip the animated loading screen; start every test in the default language.
    sessionStorage.setItem('appLoaded', 'true');
    localStorage.clear();
    resetStorageFallback();
  });

  it.each([
    ['/dashboards', 'Дашборды', 'Dashboards | Yurii Oksamytnyi'],
    ['/dashboards/personal', 'Personal', 'Personal dashboard | Yurii Oksamytnyi'],
    ['/dashboards/work-1', 'Работа 1', 'Work 1 dashboard | Yurii Oksamytnyi'],
    ['/dashboards/work-2', 'Работа 2', 'Work 2 dashboard | Yurii Oksamytnyi'],
    ['/dashboards/calendar', 'Календарь', 'Dashboards calendar | Yurii Oksamytnyi'],
  ])('%s renders its own page with the heading %s and its title', (path, heading, title) => {
    renderAt(path);
    expect(within(main()).getByRole('heading', { level: 1, name: new RegExp(heading) })).toBeInTheDocument();
    expect(document.title).toBe(title);
    // A private area: kept out of search results.
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  });

  it('keeps the existing /dashboard coming-soon page as it was', () => {
    renderAt('/dashboard');
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText(/Planned Features/)).toBeInTheDocument();
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
  });

  it('is registered as pages, but with no place in the header, palette, footer or terminal', () => {
    const ids = PAGES.map(({ id }) => id);
    for (const id of ['dashboards', 'dashboards-personal', 'dashboards-work-1', 'dashboards-work-2', 'dashboards-calendar']) {
      expect(ids).toContain(id);
      expect(NAV_PAGES.map((page) => page.id)).not.toContain(id);
    }
    expect(pagePath('dashboards-work-1')).toBe('/dashboards/work-1');

    renderAt('/');
    const hrefs = [...document.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.filter((href) => href.startsWith('/dashboards'))).toEqual([]);
  });
});

describe('the entrance', () => {
  beforeEach(() => {
    sessionStorage.setItem('appLoaded', 'true');
    localStorage.clear();
    resetStorageFallback();
  });

  it('has a card per space with three counters, the next event and a way in, and no task', () => {
    renderAt('/dashboards');
    for (const [name, path, next] of [
      ['Personal', '/dashboards/personal', '18:00 Тренировка'],
      ['Работа 1', '/dashboards/work-1', '10:00 Стендап команды'],
      ['Работа 2', '/dashboards/work-2', '15:30 Синк по проекту'],
    ]) {
      const card = within(main()).getByRole('region', { name });
      expect(within(card).getAllByRole('listitem')).toHaveLength(3);
      expect(card).toHaveTextContent('открыто');
      expect(card).toHaveTextContent('приоритет');
      expect(card).toHaveTextContent('просрочено');
      expect(card).toHaveTextContent(next);
      expect(within(card).getByRole('link', { name: `Открыть ${name}` })).toHaveAttribute('href', path);
    }
    expect(within(main()).queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('switches to English and keeps the choice', async () => {
    const user = userEvent.setup();
    const { unmount } = renderAt('/dashboards');
    const group = within(main()).getByRole('group', { name: 'Язык' });
    expect(within(group).getByRole('button', { name: 'RU' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(within(group).getByRole('button', { name: 'EN' }));
    expect(within(main()).getByRole('heading', { level: 1, name: /Dashboards/ })).toBeInTheDocument();
    expect(within(main()).getByRole('link', { name: 'Open Work 1' })).toBeInTheDocument();
    expect(main().querySelector('[lang]')).toHaveAttribute('lang', 'en');
    expect(localStorage.getItem(LANG_STORAGE_KEY)).toBe('en');

    unmount();
    renderAt('/dashboards/calendar');
    expect(within(main()).getByRole('heading', { level: 1, name: /Calendar/ })).toBeInTheDocument();
  });

  it('moves between the pages from its own bar, marking the current one', async () => {
    const user = userEvent.setup();
    renderAt('/dashboards');
    const bar = within(main()).getByRole('navigation', { name: 'Дашборды' });
    expect(within(bar).getByRole('link', { name: 'Все' })).toHaveAttribute('aria-current', 'page');

    await user.click(within(bar).getByRole('link', { name: 'Работа 1' }));
    expect(window.location.pathname).toBe('/dashboards/work-1');
    expect(within(main()).getByRole('heading', { level: 1, name: 'Работа 1' })).toBeInTheDocument();
    expect(within(bar).getByRole('link', { name: 'Работа 1' })).toHaveAttribute('aria-current', 'page');
    expect(within(bar).getByRole('link', { name: 'Все' })).not.toHaveAttribute('aria-current');
  });
});

describe('a space page', () => {
  beforeEach(() => {
    sessionStorage.setItem('appLoaded', 'true');
    localStorage.clear();
    resetStorageFallback();
  });

  it('shows the hero, the quick-add field, the tabs and the overview panels', () => {
    renderAt('/dashboards/work-1');
    const m = within(main());
    expect(m.getByText('Стендап команды', { selector: 'p' })).toBeInTheDocument();
    expect(m.getByRole('button', { name: 'Подключиться' })).toBeInTheDocument();
    expect(m.getByRole('textbox', { name: 'добавить задачу в «Работа 1»…' })).toBeInTheDocument();
    const tabs = m.getByRole('navigation', { name: 'Источники' });
    expect(within(tabs).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Обзор', 'GitHub7', 'Linear3', 'Slack5', 'Notion2', 'PostHog2', 'Grafana2', 'Встречи3',
    ]);
    expect(within(tabs).getByRole('button', { name: 'Обзор' })).toHaveAttribute('aria-pressed', 'true');
    expect(m.getByRole('region', { name: 'Приоритет' })).toBeInTheDocument();
    expect(m.getByRole('region', { name: /Меня ждут/ })).toBeInTheDocument();
    expect(m.queryByRole('region', { name: 'Мои PR' })).toBeNull();
  });

  it('a space with no Join button in its hero has none', () => {
    renderAt('/dashboards/personal');
    expect(within(main()).queryByRole('button', { name: 'Подключиться' })).toBeNull();
  });

  it('switching a tab swaps the panels, and a new space starts on its overview', async () => {
    const user = userEvent.setup();
    renderAt('/dashboards/work-1');
    const m = within(main());
    await user.click(m.getByRole('button', { name: /^GitHub/ }));
    expect(m.getByRole('button', { name: /^GitHub/ })).toHaveAttribute('aria-pressed', 'true');
    expect(m.getByRole('region', { name: /Ждут моего ревью/ })).toBeInTheDocument();
    expect(m.getByRole('region', { name: /Мои PR/ })).toBeInTheDocument();
    expect(m.queryByRole('region', { name: 'Приоритет' })).toBeNull();

    // A pull request row: a linked reference, a CI state in words.
    const review = m.getByRole('region', { name: /Ждут моего ревью/ });
    expect(within(review).getByRole('link', { name: /#123/ })).toHaveAttribute('href', 'https://github.com/example/repo/pull/123');
    expect(within(review).getAllByText('CI падает').length).toBeGreaterThan(0);

    await user.click(within(m.getByRole('navigation', { name: 'Дашборды' })).getByRole('link', { name: 'Работа 2' }));
    expect(m.getByRole('button', { name: 'Обзор' })).toHaveAttribute('aria-pressed', 'true');
    expect(m.getByRole('region', { name: 'Приоритет' })).toBeInTheDocument();
  });

  it('ticking a task toggles its checkbox and strikes the title', async () => {
    const user = userEvent.setup();
    renderAt('/dashboards/personal');
    const box = within(main()).getByRole('checkbox', { name: 'Оплатить счёт за электричество' });
    expect(box).not.toBeChecked();
    await user.click(box);
    expect(box).toBeChecked();
    await user.click(box);
    expect(box).not.toBeChecked();
  });

  it('the priority panel spans the row and holds only tinted, flagged tasks', () => {
    renderAt('/dashboards/personal');
    const panel = within(main()).getByRole('region', { name: 'Приоритет' });
    expect(within(panel).getAllByRole('checkbox')).toHaveLength(3);
    expect(panel.className).toMatch(/priority/);
  });

  it('the life-areas tab shows the area tiles with their counts', async () => {
    const user = userEvent.setup();
    renderAt('/dashboards/personal');
    await user.click(within(main()).getByRole('button', { name: /^Сферы/ }));
    const tiles = within(main()).getByRole('region', { name: 'Сферы' });
    expect(within(tiles).getAllByRole('listitem')).toHaveLength(10);
    expect(within(tiles).getByText('Деньги').closest('li')).toHaveTextContent('4');
  });

  it('a row with an action has a link naming the verb and the tool, opening in a new tab', async () => {
    const user = userEvent.setup();
    renderAt('/dashboards/work-1');
    await user.click(within(main()).getByRole('button', { name: /^Slack/ }));
    const link = within(main()).getAllByRole('link', { name: /Ответить · Slack/ })[0];
    expect(link).toHaveAttribute('href', 'https://slack.com');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(main()).getAllByRole('link', { name: /Спросить · Slack/ }).length).toBeGreaterThan(0);
  });

  it('the quick-add field takes text and does nothing else', async () => {
    const user = userEvent.setup();
    renderAt('/dashboards/work-2');
    const field = within(main()).getByRole('textbox', { name: 'добавить задачу в «Работа 2»…' });
    await user.type(field, 'x{Enter}');
    expect(window.location.pathname).toBe('/dashboards/work-2');
  });
});

describe('the calendar', () => {
  beforeEach(() => {
    sessionStorage.setItem('appLoaded', 'true');
    localStorage.clear();
    resetStorageFallback();
  });

  it('is a week table, days as columns and hours as rows, with events of every space and a legend', () => {
    renderAt('/dashboards/calendar');
    const grid = within(main()).getByRole('table');
    expect(within(grid).getAllByRole('columnheader')).toHaveLength(7);
    expect(within(grid).getAllByRole('rowheader')).toHaveLength(12);
    expect(within(grid).getAllByText(/Стендап команды/).length).toBeGreaterThan(0);
    expect(within(grid).getAllByText(/Тренировка/).length).toBeGreaterThan(0);
    expect(within(grid).getAllByText(/Синк по проекту/).length).toBeGreaterThan(0);
    // The space is said in words too, not only by colour.
    expect(within(grid).getAllByText(/^Работа 2:/).length).toBeGreaterThan(0);
    expect(within(grid).getByRole('columnheader', { name: 'Пн 23' })).toHaveAttribute('aria-current', 'date');
    expect(within(main()).getAllByRole('listitem').map((li) => li.textContent)).toEqual(
      expect.arrayContaining(['Personal', 'Работа 1', 'Работа 2']),
    );
  });

  it('has a Week / Month switch with Week on and Month not built yet', () => {
    renderAt('/dashboards/calendar');
    const view = within(main()).getByRole('group', { name: 'Вид' });
    expect(within(view).getByRole('button', { name: 'Неделя' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(view).getByRole('button', { name: 'Месяц' })).toBeDisabled();
  });

  it('shows no task: no checkbox anywhere', () => {
    renderAt('/dashboards/calendar');
    expect(within(main()).queryAllByRole('checkbox')).toHaveLength(0);
  });
});
