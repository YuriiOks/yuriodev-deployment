import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '../context/ThemeContext';
import App from '../App';
import { NAV_PAGES, PAGES, pagePath } from '../data/site';
import { maxWidth } from '../constants/breakpoints';
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
    ['/dashboards', 'Дашборды', 'Дашборды | Yurii Oksamytnyi'],
    ['/dashboards/personal', 'Личное', 'Личное | Yurii Oksamytnyi'],
    ['/dashboards/work-1', 'Работа 1', 'Работа 1 | Yurii Oksamytnyi'],
    ['/dashboards/work-2', 'Работа 2', 'Работа 2 | Yurii Oksamytnyi'],
    ['/dashboards/calendar', 'Календарь', 'Календарь | Yurii Oksamytnyi'],
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
      ['Личное', '/dashboards/personal', '18:00 Тренировка'],
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
    expect(within(tabs).getAllByRole('tab').map((b) => b.textContent)).toEqual([
      'Обзор', 'GitHub7', 'Linear3', 'Slack5', 'Notion2', 'PostHog2', 'Grafana2', 'Встречи3',
    ]);
    expect(within(tabs).getByRole('tab', { name: 'Обзор' })).toHaveAttribute('aria-selected', 'true');
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
    await user.click(m.getByRole('tab', { name: /^GitHub/  }));
    expect(m.getByRole('tab', { name: /^GitHub/ })).toHaveAttribute('aria-selected', 'true');
    expect(m.getByRole('region', { name: /Ждут моего ревью/ })).toBeInTheDocument();
    expect(m.getByRole('region', { name: /Мои PR/ })).toBeInTheDocument();
    expect(m.queryByRole('region', { name: 'Приоритет' })).toBeNull();

    // A pull request row: a linked reference, a CI state in words.
    const review = m.getByRole('region', { name: /Ждут моего ревью/ });
    expect(within(review).getByRole('link', { name: /#123/ })).toHaveAttribute('href', 'https://github.com/example/repo/pull/123');
    expect(within(review).getAllByText('CI падает').length).toBeGreaterThan(0);

    await user.click(within(m.getByRole('navigation', { name: 'Дашборды' })).getByRole('link', { name: 'Работа 2' }));
    expect(m.getByRole('tab', { name: 'Обзор' })).toHaveAttribute('aria-selected', 'true');
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
    await user.click(within(main()).getByRole('tab', { name: /^Сферы/  }));
    const tiles = within(main()).getByRole('region', { name: 'Сферы' });
    expect(within(tiles).getAllByRole('listitem')).toHaveLength(10);
    expect(within(tiles).getByText('Деньги').closest('li')).toHaveTextContent('4');
  });

  it('a row with an action has a button naming the verb and the tool; the sample has nothing to open, so it does nothing yet', async () => {
    const user = userEvent.setup();
    renderAt('/dashboards/work-1');
    await user.click(within(main()).getByRole('tab', { name: /^Slack/  }));
    const reply = within(main()).getAllByRole('button', { name: /Ответить · Slack/ })[0];
    expect(reply).toHaveAttribute('title', 'Пример: источник не подключён');
    await user.click(reply);
    expect(window.location.pathname).toBe('/dashboards/work-1');
    expect(within(main()).getAllByRole('button', { name: /Спросить · Slack/ }).length).toBeGreaterThan(0);
    // No link out to a vendor's home page.
    expect(main().querySelector('a[href^="https://slack.com"]')).toBeNull();
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
    // Hours run down the page as a scale (read aloud through each event's own times), not as rows.
    expect(within(grid).queryAllByRole('rowheader')).toHaveLength(0);
    expect(within(grid).getAllByText(/Стендап команды/).length).toBeGreaterThan(0);
    expect(within(grid).getAllByText(/Тренировка/).length).toBeGreaterThan(0);
    expect(within(grid).getAllByText(/Синк по проекту/).length).toBeGreaterThan(0);
    // The space is said in words too, not only by colour.
    expect(within(grid).getAllByText(/^Работа 2:/).length).toBeGreaterThan(0);
    expect(within(grid).getByRole('columnheader', { name: 'Пн 23' })).toHaveAttribute('aria-current', 'date');
    expect(within(main()).getAllByRole('listitem').map((li) => li.textContent)).toEqual(
      expect.arrayContaining(['Личное', 'Работа 1', 'Работа 2']),
    );
  });

  it('counts the conflicts between spaces, and marks each conflicting event in words', () => {
    renderAt('/dashboards/calendar');
    // Five blocks are marked: two on Tuesday, three on Friday.
    expect(within(main()).getByText('Конфликты: 5')).toBeInTheDocument();
    const grid = within(main()).getByRole('table');
    expect(within(grid).getAllByText(/Конфликт: пересекается/)).toHaveLength(5);
    // An overlap inside one space is laid out side by side but not flagged.
    const pairing = within(grid).getByText(/Парная работа/).closest('li')!;
    expect(pairing).not.toHaveAttribute('data-conflict');
    expect(within(grid).getByText(/Воркшоп/).closest('li')).toHaveAttribute('data-conflict', 'true');
  });

  it('says the conflicts in English too', async () => {
    const user = userEvent.setup();
    renderAt('/dashboards/calendar');
    await user.click(within(main()).getByRole('button', { name: 'EN' }));
    expect(within(main()).getByText('Conflicts: 5')).toBeInTheDocument();
    expect(within(main()).getAllByText(/Conflict: overlaps an event of another space/)).toHaveLength(5);
  });

  it('places an event by its time and sizes it by its length, sharing the width in a cluster', () => {
    renderAt('/dashboards/calendar');
    const grid = within(main()).getByRole('table');
    // The first match is Monday's: columns come in day order.
    const block = (name: RegExp) => within(grid).getAllByText(name)[0].closest('li')!;
    const prop = (el: HTMLElement, name: string) => el.style.getPropertyValue(name);
    // Stand-up on Monday is 10:00-10:30: one hour below the 09:00 start, half an hour tall, the whole width.
    const standup = block(/Стендап команды/);
    expect(prop(standup, '--top')).toBe('1');
    expect(prop(standup, '--span')).toBe('0.5');
    expect([prop(standup, '--col'), prop(standup, '--cols')]).toEqual(['0', '1']);
    // Friday's three-way overlap: each takes a third.
    const vendor = block(/Звонок поставщику/);
    expect([prop(vendor, '--col'), prop(vendor, '--cols')]).toEqual(['2', '3']);
    // A 45-minute call starting at 16:00: seven hours below 09:00, three quarters of an hour tall.
    expect(prop(vendor, '--top')).toBe('7');
    expect(prop(vendor, '--span')).toBe('0.75');
  });

  it('has a Week / Month switch, with Week on to begin with', () => {
    renderAt('/dashboards/calendar');
    const view = within(main()).getByRole('group', { name: 'Вид' });
    expect(within(view).getByRole('button', { name: 'Неделя' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(view).getByRole('button', { name: 'Месяц' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(view).getByRole('button', { name: 'Месяц' })).toBeEnabled();
  });
});

describe('the calendar: month view', () => {
  beforeEach(() => {
    sessionStorage.setItem('appLoaded', 'true');
    localStorage.clear();
    resetStorageFallback();
  });

  async function openMonth() {
    const user = userEvent.setup();
    renderAt('/dashboards/calendar');
    await user.click(within(within(main()).getByRole('group', { name: 'Вид' })).getByRole('button', { name: 'Месяц' }));
    return user;
  }

  const monthTable = () => within(within(main()).getByRole('region', { name: /^(Месяц, события|Month, events)/ }));

  it('toggles to a month grid: weekday headers, six weeks of day buttons, the month in the title', async () => {
    await openMonth();
    expect(within(main()).getByRole('button', { name: 'Месяц' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(main()).getByRole('button', { name: 'Неделя' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(main()).getByRole('heading', { level: 1, name: /Ноябрь 2026/ })).toBeInTheDocument();
    const grid = monthTable();
    expect(grid.getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']);
    // November 2026 starts on a Sunday: six weeks.
    expect(grid.getAllByRole('button')).toHaveLength(42);
  });

  it('a day button is named by its date and its number of events; today is marked', async () => {
    await openMonth();
    const today = monthTable().getByRole('button', { name: '23 ноября, событий: 5' });
    expect(today).toHaveAttribute('aria-current', 'date');
    // Up to three chips, then how many more.
    expect(within(today).getAllByText(/^\d{2}:\d{2} /)).toHaveLength(3);
    expect(within(today).getByText('+2 ещё')).toBeInTheDocument();
    expect(monthTable().getByRole('button', { name: '24 ноября, событий: 4, есть конфликт' })).toBeInTheDocument();
  });

  it('shows the days of the neighbouring months muted, and a day with a conflict says so', async () => {
    await openMonth();
    const october = monthTable().getByRole('button', { name: /^26 октября/ });
    expect(october.closest('td')).toHaveAttribute('data-muted', 'true');
    expect(monthTable().getByRole('button', { name: /^1 декабря/ }).closest('td')).toHaveAttribute('data-muted', 'true');
    expect(monthTable().getByRole('button', { name: /^30 ноября/ }).closest('td')).not.toHaveAttribute('data-muted');
    expect(monthTable().getByRole('button', { name: /^27 ноября.*есть конфликт/ })).toBeInTheDocument();
    expect(monthTable().getByRole('button', { name: /^23 ноября/ })).not.toHaveAttribute('data-conflict');
  });

  it('counts what is marked on screen: in a month, the days with a conflict (four in November)', async () => {
    await openMonth();
    expect(within(main()).getByText('Конфликты: 4')).toBeInTheDocument();
  });

  it('clicking a day goes to the week that contains it', async () => {
    const user = await openMonth();
    await user.click(monthTable().getByRole('button', { name: /^3 ноября/ }));
    expect(within(main()).getByRole('heading', { level: 1, name: /2–8 ноября/ })).toBeInTheDocument();
    expect(within(main()).getByRole('button', { name: 'Неделя' })).toHaveAttribute('aria-pressed', 'true');
    const grid = within(main()).getByRole('table');
    expect(within(grid).getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'Пн 2', 'Вт 3', 'Ср 4', 'Чт 5', 'Пт 6', 'Сб 7', 'Вс 8',
    ]);
    // The 3rd had a quarterly review: it is in this week's grid.
    expect(within(grid).getAllByText(/Квартальный обзор/).length).toBeGreaterThan(0);
  });

  it('previous, next and Today move the week, then the month', async () => {
    const user = userEvent.setup();
    renderAt('/dashboards/calendar');
    const heading = () => within(main()).getByRole('heading', { level: 1 });
    expect(heading()).toHaveTextContent('23–29 ноября');

    await user.click(within(main()).getByRole('button', { name: 'Следующая неделя' }));
    expect(heading()).toHaveTextContent('30 ноября – 6 декабря');
    await user.click(within(main()).getByRole('button', { name: 'Предыдущая неделя' }));
    await user.click(within(main()).getByRole('button', { name: 'Предыдущая неделя' }));
    expect(heading()).toHaveTextContent('16–22 ноября');
    await user.click(within(main()).getByRole('button', { name: 'Сегодня' }));
    expect(heading()).toHaveTextContent('23–29 ноября');

    await user.click(within(main()).getByRole('button', { name: 'Месяц' }));
    await user.click(within(main()).getByRole('button', { name: 'Следующий месяц' }));
    expect(heading()).toHaveTextContent('Декабрь 2026');
    // December has no overlap between two spaces: no conflict, and five weeks.
    expect(within(main()).getByText('Конфликтов нет')).toBeInTheDocument();
    expect(monthTable().getAllByRole('button')).toHaveLength(35);
    await user.click(within(main()).getByRole('button', { name: 'Предыдущий месяц' }));
    await user.click(within(main()).getByRole('button', { name: 'Предыдущий месяц' }));
    expect(heading()).toHaveTextContent('Октябрь 2026');
    await user.click(within(main()).getByRole('button', { name: 'Сегодня' }));
    expect(heading()).toHaveTextContent('Ноябрь 2026');
  });

  it('is in English too', async () => {
    const user = userEvent.setup();
    renderAt('/dashboards/calendar');
    await user.click(within(main()).getByRole('button', { name: 'EN' }));
    await user.click(within(main()).getByRole('button', { name: 'Month' }));
    expect(within(main()).getByRole('heading', { level: 1, name: /November 2026/ })).toBeInTheDocument();
    expect(monthTable().getByRole('button', { name: '23 November, events: 5' })).toBeInTheDocument();
    expect(within(monthTable().getByRole('button', { name: '23 November, events: 5' })).getByText('+2 more')).toBeInTheDocument();
  });
});

describe('the calendar: no tasks', () => {
  beforeEach(() => {
    sessionStorage.setItem('appLoaded', 'true');
    localStorage.clear();
    resetStorageFallback();
  });

  it('has seven equal day columns', () => {
    renderAt('/dashboards/calendar');
    const widths = [...main().querySelectorAll<HTMLElement>('colgroup col')].slice(1).map((c) => c.style.width);
    expect(widths).toHaveLength(7);
    expect(new Set(widths).size).toBe(1);
  });

  it('shows no task: no checkbox anywhere', () => {
    renderAt('/dashboards/calendar');
    expect(within(main()).queryAllByRole('checkbox')).toHaveLength(0);
  });
});

describe('the dashboards bar is the only chrome', () => {
  beforeEach(() => {
    sessionStorage.setItem('appLoaded', 'true');
    localStorage.clear();
    resetStorageFallback();
  });

  it('has a link back to the site, the pages, the language switch and the theme toggle, and no site header or footer', () => {
    renderAt('/dashboards/personal');
    expect(screen.queryByRole('banner')).toBeNull();
    expect(screen.queryByRole('contentinfo')).toBeNull();
    const bar = within(main()).getByRole('navigation', { name: 'Дашборды' });
    expect(within(bar).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '/dashboards', '/dashboards/personal', '/dashboards/work-1', '/dashboards/work-2', '/dashboards/calendar',
    ]);
    expect(within(main()).getByRole('link', { name: 'yuriodev: на сайт' })).toHaveAttribute('href', '/');
    expect(within(main()).getByRole('group', { name: 'Язык' })).toBeInTheDocument();
    // No raw path or slug as a label.
    expect(main()).not.toHaveTextContent('/dashboards/');
    expect(main()).not.toHaveTextContent('work-1');
  });

  it('the theme toggle drives the site theme and says what it will switch to', async () => {
    const user = userEvent.setup();
    renderAt('/dashboards');
    const html = document.documentElement;
    const before = html.getAttribute('data-theme');
    const label = before === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему';
    await user.click(within(main()).getByRole('button', { name: label }));
    expect(html.getAttribute('data-theme')).toBe(before === 'dark' ? 'light' : 'dark');
    expect(localStorage.getItem('theme-choice')).toBe(before === 'dark' ? 'light' : 'dark');
    expect(within(main()).getByRole('button', { name: before === 'dark' ? 'Включить тёмную тему' : 'Включить светлую тему' })).toBeInTheDocument();
  });

  it('the document title and the space names follow the language', async () => {
    const user = userEvent.setup();
    renderAt('/dashboards/work-1');
    expect(document.title).toBe('Работа 1 | Yurii Oksamytnyi');
    await user.click(within(main()).getByRole('button', { name: 'EN' }));
    expect(document.title).toBe('Work 1 | Yurii Oksamytnyi');
    expect(within(main()).getByRole('heading', { level: 1, name: 'Work 1' })).toBeInTheDocument();
    expect(within(main()).getByRole('link', { name: 'Personal' })).toBeInTheDocument();
  });
});

describe('the space page: details', () => {
  beforeEach(() => {
    sessionStorage.setItem('appLoaded', 'true');
    localStorage.clear();
    resetStorageFallback();
  });

  it('the hero chips are the rest of the day: the next event is the headline, not repeated', () => {
    renderAt('/dashboards/personal');
    const chips = within(main()).getAllByRole('listitem').filter((li) => /^\d{2}:\d{2}/.test(li.textContent ?? '') && li.textContent?.includes('Урок языка'));
    expect(chips).toHaveLength(1);
    expect(within(main()).queryAllByRole('listitem').filter((li) => li.textContent?.includes('Тренировка'))).toHaveLength(0);
    expect(within(main()).getByText(/мин$/)).toBeInTheDocument();
  });

  it('an empty panel shows a muted line, no rows and no count', async () => {
    const user = userEvent.setup();
    renderAt('/dashboards/personal');
    await user.click(within(main()).getByRole('tab', { name: /^Работа и доход/ }));
    const leads = within(main()).getByRole('region', { name: 'Лиды' });
    expect(within(leads).getByText(/Здесь появятся лиды/)).toBeInTheDocument();
    expect(within(leads).queryAllByRole('listitem')).toHaveLength(0);
    // The tab counts rows only: the empty state is not an item.
    expect(within(main()).getByRole('tab', { name: /^Работа и доход/ })).toHaveTextContent('6');
  });

  it('every row of every panel has a leading marker, and panel titles do not repeat the action', async () => {
    const user = userEvent.setup();
    renderAt('/dashboards/work-1');
    await user.click(within(main()).getByRole('tab', { name: /^Slack/ }));
    expect(within(main()).getByRole('region', { name: /Ждут ответа/ })).toBeInTheDocument();
    expect(within(main()).getByRole('region', { name: /Что спросить/ })).toBeInTheDocument();
    for (const li of main().querySelectorAll('[role=tabpanel] li')) {
      expect(li.firstElementChild?.children.length, li.textContent ?? '').toBeGreaterThan(0);
    }
  });
});

describe('the panel grid follows the panels', () => {
  beforeEach(() => {
    sessionStorage.setItem('appLoaded', 'true');
    localStorage.clear();
    resetStorageFallback();
  });

  const grid = () => main().querySelector<HTMLElement>('[style*="--cols-lg"]')!;

  it('a tab with one panel besides the priority panel fills the row; the priority panel is its own full row', () => {
    renderAt('/dashboards/personal');
    expect(grid().style.getPropertyValue('--cols-lg')).toBe('1');
    expect(grid().style.getPropertyValue('--cols-md')).toBe('1');
  });

  it('panels with references or long titles (GitHub) go two to a row, the odd one taking the whole row', async () => {
    const user = userEvent.setup();
    renderAt('/dashboards/work-1');
    await user.click(within(main()).getByRole('tab', { name: /^GitHub/ }));
    expect([grid().style.getPropertyValue('--cols-md'), grid().style.getPropertyValue('--cols-lg')]).toEqual(['2', '2']);
    const panels = [...grid().children] as HTMLElement[];
    expect(panels).toHaveLength(3);
    expect(panels[2].className).toMatch(/fill/);
    expect(panels[0].className).not.toMatch(/fill/);
  });

  it('two panels share the row, three take three columns, four sit two by two', async () => {
    const user = userEvent.setup();
    renderAt('/dashboards/personal');
    const cols = () => [grid().style.getPropertyValue('--cols-md'), grid().style.getPropertyValue('--cols-lg')];
    await user.click(within(main()).getByRole('tab', { name: /^Сферы/  }));
    expect(cols()).toEqual(['2', '2']);
    await user.click(within(main()).getByRole('tab', { name: /^Работа и доход/  }));
    expect(cols()).toEqual(['2', '3']);
    await user.click(within(main()).getByRole('tab', { name: /^Суд/  }));
    expect(cols()).toEqual(['2', '2']);
  });
});

describe('the calendar on a phone', () => {
  const original = window.matchMedia;

  beforeEach(() => {
    sessionStorage.setItem('appLoaded', 'true');
    localStorage.clear();
    resetStorageFallback();
    window.matchMedia = vi.fn((query: string) => ({
      matches: query === maxWidth('md'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    window.matchMedia = original;
  });

  it('shows one day at a time, and previous / next step by a day', async () => {
    const user = userEvent.setup();
    renderAt('/dashboards/calendar');
    const heading = () => within(main()).getByRole('heading', { level: 1 });
    expect(within(within(main()).getByRole('table')).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Пн 23']);
    expect(heading()).toHaveTextContent('23 ноября');

    await user.click(within(main()).getByRole('button', { name: 'Следующий день' }));
    expect(within(within(main()).getByRole('table')).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Вт 24']);
    // Tuesday's two overlapping events are there, and the day's conflict is counted.
    expect(within(main()).getByText('Конфликты: 2')).toBeInTheDocument();
    await user.click(within(main()).getByRole('button', { name: 'Предыдущий день' }));
    expect(heading()).toHaveTextContent('23 ноября');
  });

  it('picking a day in the month opens that day', async () => {
    const user = userEvent.setup();
    renderAt('/dashboards/calendar');
    await user.click(within(main()).getByRole('button', { name: 'Месяц' }));
    await user.click(within(main()).getByRole('button', { name: /^3 ноября/ }));
    expect(within(within(main()).getByRole('table')).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Вт 3']);
  });
});
