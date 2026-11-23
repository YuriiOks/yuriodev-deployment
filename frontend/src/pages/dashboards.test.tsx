import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '../context/ThemeContext';
import App from '../App';
import { NAV_PAGES, PAGES, pagePath } from '../data/site';
import { maxWidth } from '../constants/breakpoints';
import { WORKDAYS_STORAGE_KEY } from '../services/dashboards/preferences';
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

  it('has a card per space with three counters, the next event and a way in, and no task, no blurb, no Open button', () => {
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
      // The whole card is the link: the title's anchor is stretched over it.
      expect(within(card).getByRole('link', { name })).toHaveAttribute('href', path);
    }
    expect(within(main()).queryAllByRole('checkbox')).toHaveLength(0);
    expect(within(main()).queryByRole('link', { name: /^Открыть/ })).toBeNull();
    expect(main()).not.toHaveTextContent('Три отдельных пространства');
  });

  it('says what is overdue in danger only above zero, and a zero is quiet', () => {
    renderAt('/dashboards');
    const personal = within(main()).getByRole('region', { name: 'Личное' });
    const overdue = within(personal).getByText('просрочено').previousElementSibling as HTMLElement;
    expect(overdue).toHaveTextContent('1');
    expect(overdue.className).toMatch(/alarm/);
    const work = within(main()).getByRole('region', { name: 'Работа 1' });
    const none = within(work).getByText('просрочено').previousElementSibling as HTMLElement;
    expect(none.className).toMatch(/zero/);
    expect(none.className).not.toMatch(/alarm/);
  });

  it('switches to English and keeps the choice', async () => {
    const user = userEvent.setup();
    const { unmount } = renderAt('/dashboards');
    const group = within(main()).getByRole('group', { name: 'Язык' });
    expect(within(group).getByRole('button', { name: 'RU' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(within(group).getByRole('button', { name: 'EN' }));
    expect(within(main()).getByRole('heading', { level: 1, name: /Dashboards/ })).toBeInTheDocument();
    expect(within(within(main()).getByRole('region', { name: 'Work 1' })).getByRole('link', { name: 'Work 1' })).toBeInTheDocument();
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

  it('shows the next-event strip, the quick-add field, the tabs and the overview panels', () => {
    renderAt('/dashboards/work-1');
    const m = within(main());
    expect(m.getByText('Стендап команды', { selector: 'p' })).toBeInTheDocument();
    expect(m.getByText('через 47 мин')).toBeInTheDocument();
    expect(m.getByText(/затем/)).toHaveTextContent('затем 13:00 Онбординг-синк');
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

  it('the priority panel is the main list: first in the grid, three flagged tasks that look like any other row', () => {
    renderAt('/dashboards/personal');
    const panel = within(main()).getByRole('region', { name: 'Приоритет' });
    expect(within(panel).getAllByRole('checkbox')).toHaveLength(3);
    expect(main().querySelector('[role=tabpanel]')!.firstElementChild).toBe(panel);
    expect(within(panel).getAllByText('Приоритет', { selector: '.sr-only' })).toHaveLength(3);
  });

  it('the life-areas tab shows the areas as plain rows with their counts, a zero quiet', async () => {
    const user = userEvent.setup();
    renderAt('/dashboards/personal');
    await user.click(within(main()).getByRole('tab', { name: /^Сферы/  }));
    const tiles = within(main()).getByRole('region', { name: 'Сферы' });
    expect(within(tiles).getAllByRole('listitem')).toHaveLength(10);
    expect(within(tiles).getByText('Деньги').closest('li')).toHaveTextContent('4');
    expect(within(tiles).getByText('Друзья').closest('li')!.querySelector('[data-zero="true"]')).toHaveTextContent('0');
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

  it('places an event by its time and sizes it by its length, cascading a crowded cluster', () => {
    renderAt('/dashboards/calendar');
    const grid = within(main()).getByRole('table');
    // The first match is Monday's: columns come in day order.
    const block = (name: RegExp) => within(grid).getAllByText(name)[0].closest('li')!;
    const prop = (el: HTMLElement, name: string) => el.style.getPropertyValue(name);
    const slotOf = (el: HTMLElement) => [prop(el, '--level'), prop(el, '--slot'), prop(el, '--slots')];
    // Stand-up on Monday is 10:00-10:30: one hour below the 09:00 start, half an hour tall, the whole width.
    const standup = block(/Стендап команды/);
    expect(prop(standup, '--top')).toBe('1');
    expect(prop(standup, '--span')).toBe('0.5');
    expect(slotOf(standup)).toEqual(['0', '0', '1']);
    // Friday's three-way overlap is a cascade: the third start (16:00) is two steps in.
    const vendor = block(/Звонок поставщику/);
    expect(slotOf(vendor)).toEqual(['2', '0', '1']);
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
    // Up to three event chips (the week's blocks at chip size: the title and the start time), then how many more.
    expect(within(today).getAllByText(/^\d{2}:\d{2}$/)).toHaveLength(3);
    expect(within(today).getByText('+2 ещё')).toBeInTheDocument();
    expect(monthTable().getByRole('button', { name: '24 ноября, событий: 4, есть конфликт' })).toBeInTheDocument();
  });

  it('draws a day\'s events like the week\'s blocks: a chip per event in its space, a warn ring on the conflicting ones', async () => {
    await openMonth();
    const chips = (name: string | RegExp) => Array.from(monthTable().getByRole('button', { name }).querySelectorAll('[data-for]'));
    const busy = chips('24 ноября, событий: 4, есть конфликт');
    expect(busy).toHaveLength(3);
    for (const chip of busy) expect(['personal', 'work-1', 'work-2']).toContain(chip.getAttribute('data-for'));
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
    // December has no overlap between two spaces: the count is not shown at all, and there are five weeks.
    expect(within(main()).queryByText(/Конфликты:/)).toBeNull();
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
    // No raw path or slug as a label of a page link (the prompt, which runs the current place, is the one place a path is shown).
    expect(bar).not.toHaveTextContent('/dashboards/');
    expect(bar).not.toHaveTextContent('work-1');
    expect(main().querySelector('[class*="terminalPrompt"]')).toHaveTextContent('yurii@yuriodev:~$ ./dashboards/personal');
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

  it('the strip names the next event once, then what comes after, and counts whole minutes', () => {
    renderAt('/dashboards/personal');
    const m = within(main());
    expect(m.getByText('Тренировка', { selector: 'p' })).toBeInTheDocument();
    expect(m.getByText('через 8 ч 47 мин')).toBeInTheDocument();
    expect(m.getByText(/затем/)).toHaveTextContent('затем 19:30 Урок языка');
    expect(m.queryAllByText(/Тренировка/)).toHaveLength(1);
  });

  it('the strip is in English too', async () => {
    const user = userEvent.setup();
    renderAt('/dashboards/work-1');
    await user.click(within(main()).getByRole('button', { name: 'EN' }));
    expect(within(main()).getByText('in 47 min')).toBeInTheDocument();
    expect(within(main()).getByText(/then/)).toHaveTextContent('then 13:00 Onboarding sync');
    expect(within(main()).getByText(/^Synced:/)).toHaveTextContent('Synced: GitHub 2 min ago');
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

  it('panel titles do not repeat the action, and the rows of a panel share one lead column', async () => {
    const user = userEvent.setup();
    renderAt('/dashboards/work-1');
    await user.click(within(main()).getByRole('tab', { name: /^Slack/ }));
    expect(within(main()).getByRole('region', { name: /Ждут ответа/ })).toBeInTheDocument();
    expect(within(main()).getByRole('region', { name: /Что спросить/ })).toBeInTheDocument();
    for (const list of main().querySelectorAll('[role=tabpanel] ul')) {
      const states = new Set([...list.querySelectorAll(':scope > li')].map((li) => li.getAttribute('data-lead')));
      expect(states.size, list.textContent ?? '').toBe(1);
    }
  });

  it('shows how fresh the sources are as a quiet footer line, and no sentence about how the page works', () => {
    renderAt('/dashboards/work-2');
    expect(within(main()).getByText(/^Синхр\.:/)).toHaveTextContent('Синхр.: вручную');
    expect(main()).not.toHaveTextContent('только ручной ввод');
  });
});

describe('the panel grid follows the panels', () => {
  beforeEach(() => {
    sessionStorage.setItem('appLoaded', 'true');
    localStorage.clear();
    resetStorageFallback();
  });

  const grid = () => main().querySelector<HTMLElement>('[role=tabpanel]')!;

  it('with more than one panel the first is the main list and the others stack beside it', async () => {
    const user = userEvent.setup();
    renderAt('/dashboards/work-1');
    expect(grid()).toHaveAttribute('data-split', 'true');
    expect(grid().style.getPropertyValue('--rows')).toBe('1');
    await user.click(within(main()).getByRole('tab', { name: /^GitHub/ }));
    expect(grid()).toHaveAttribute('data-split', 'true');
    expect(grid().children).toHaveLength(3);
    // The first panel spans the two stacked ones.
    expect(grid().style.getPropertyValue('--rows')).toBe('2');
  });

  it('a tab with a single panel is one column', async () => {
    const user = userEvent.setup();
    renderAt('/dashboards/personal');
    for (const tab of within(main()).getAllByRole('tab')) {
      await user.click(tab);
      const count = grid().children.length;
      expect(grid().hasAttribute('data-split'), tab.textContent ?? '').toBe(count > 1);
      expect(grid().style.getPropertyValue('--rows')).toBe(String(Math.max(count - 1, 1)));
    }
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

  it('has a strip of the week above the day: a button per day, the selected one pressed, a dot for events', async () => {
    const user = userEvent.setup();
    renderAt('/dashboards/calendar');
    const strip = within(main()).getByRole('group', { name: 'Дни недели' });
    const days = within(strip).getAllByRole('button');
    expect(days).toHaveLength(7);
    expect(within(strip).getByRole('button', { name: /^23 ноября/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(strip).getByRole('button', { name: /^23 ноября/ })).toHaveAttribute('aria-current', 'date');
    expect(within(strip).getByRole('button', { name: /^24 ноября.*есть конфликт/ })).toBeInTheDocument();
    await user.click(within(strip).getByRole('button', { name: /^26 ноября/ }));
    expect(within(within(main()).getByRole('table')).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Чт 26']);
    expect(within(strip).getByRole('button', { name: /^26 ноября/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(strip).getByRole('button', { name: /^23 ноября/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('the bar is the prompt, the pages and the portfolio link: the language and theme switches sit at the end of the page', () => {
    renderAt('/dashboards/personal');
    expect(within(main()).getByRole('link', { name: 'yuriodev: на сайт' })).toHaveAttribute('href', '/');
    expect(within(main()).getAllByRole('group', { name: 'Язык' })).toHaveLength(1);
    const switches = within(main()).getByRole('group', { name: 'Язык' }).parentElement!;
    expect(switches).toBe(main().querySelector('[class*="switches"]'));
    expect(within(switches).getByRole('button', { name: /тему/ })).toBeInTheDocument();
  });

  it('picking a day in the month opens that day', async () => {
    const user = userEvent.setup();
    renderAt('/dashboards/calendar');
    await user.click(within(main()).getByRole('button', { name: 'Месяц' }));
    await user.click(within(main()).getByRole('button', { name: /^3 ноября/ }));
    expect(within(within(main()).getByRole('table')).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Вт 3']);
  });
});

describe('the calendar: working days only', () => {
  beforeEach(() => {
    sessionStorage.setItem('appLoaded', 'true');
    localStorage.clear();
    resetStorageFallback();
  });

  const toggle = () => within(main()).getByRole('switch', { name: 'Показывать только рабочие дни' });
  const headers = () => within(within(main()).getByRole('table')).getAllByRole('columnheader').map((th) => th.textContent);

  it('is off to begin with: seven days, no note', () => {
    renderAt('/dashboards/calendar');
    expect(toggle()).toHaveAttribute('aria-checked', 'false');
    expect(headers()).toHaveLength(7);
    expect(within(main()).queryByRole('status')).toBeNull();
  });

  it('on: the week is Monday to Friday, and a note says how many weekend events are hidden', async () => {
    const user = userEvent.setup();
    renderAt('/dashboards/calendar');
    await user.click(toggle());
    expect(toggle()).toHaveAttribute('aria-checked', 'true');
    expect(headers()).toEqual(['Пн 23', 'Вт 24', 'Ср 25', 'Чт 26', 'Пт 27']);
    expect(within(main()).getByRole('status')).toHaveTextContent('Скрыто событий в выходные: 1.');
    // The count of conflicts is of what is shown: the same five blocks (all on weekdays).
    expect(within(main()).getByText('Конфликты: 5')).toBeInTheDocument();
    expect(localStorage.getItem(WORKDAYS_STORAGE_KEY)).toBe('true');
  });

  it("the note's button turns the option off and brings the weekend back", async () => {
    const user = userEvent.setup();
    renderAt('/dashboards/calendar');
    await user.click(toggle());
    await user.click(within(main()).getByRole('button', { name: 'Показать выходные' }));
    expect(toggle()).toHaveAttribute('aria-checked', 'false');
    expect(headers()).toHaveLength(7);
    expect(within(main()).queryByRole('status')).toBeNull();
    expect(localStorage.getItem(WORKDAYS_STORAGE_KEY)).toBe('false');
  });

  it('the choice survives a remount (a reload or a navigation)', async () => {
    const user = userEvent.setup();
    const first = renderAt('/dashboards/calendar');
    await user.click(toggle());
    first.unmount();
    renderAt('/dashboards/calendar');
    expect(toggle()).toHaveAttribute('aria-checked', 'true');
    expect(headers()).toHaveLength(5);
  });

  it('the month has five columns, Monday to Friday, and counts the hidden weekend events of the month', async () => {
    const user = userEvent.setup();
    renderAt('/dashboards/calendar');
    await user.click(toggle());
    await user.click(within(main()).getByRole('button', { name: 'Месяц' }));
    const region = within(within(main()).getByRole('region', { name: /^(Месяц, события|Month, events)/ }));
    expect(region.getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Пн', 'Вт', 'Ср', 'Чт', 'Пт']);
    // November 2026 starts on a Sunday: five working weeks, five days each.
    expect(region.getAllByRole('button')).toHaveLength(25);
    // The Nov 14 trip and the Nov 28 dinner are on weekends.
    expect(within(main()).getByRole('status')).toHaveTextContent('Скрыто событий в выходные: 2.');
  });

  it('in English the switch and the note speak English', async () => {
    const user = userEvent.setup();
    renderAt('/dashboards/calendar');
    await user.click(within(main()).getByRole('button', { name: 'EN' }));
    await user.click(within(main()).getByRole('switch', { name: 'Show working days only' }));
    expect(within(main()).getByRole('status')).toHaveTextContent('Weekend events hidden: 1.');
    expect(within(main()).getByRole('button', { name: 'Show weekends' })).toBeInTheDocument();
  });
});

describe('the calendar on a phone: working days only', () => {
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

  it('stepping over the weekend: Friday goes to Monday and Monday back to Friday', async () => {
    const user = userEvent.setup();
    renderAt('/dashboards/calendar');
    await user.click(within(main()).getByRole('switch', { name: 'Показывать только рабочие дни' }));
    const header = () => within(within(main()).getByRole('table')).getAllByRole('columnheader').map((th) => th.textContent);
    expect(header()).toEqual(['Пн 23']);
    for (let i = 0; i < 4; i++) await user.click(within(main()).getByRole('button', { name: 'Следующий день' }));
    expect(header()).toEqual(['Пт 27']);
    await user.click(within(main()).getByRole('button', { name: 'Следующий день' }));
    expect(header()).toEqual(['Пн 30']);
    await user.click(within(main()).getByRole('button', { name: 'Предыдущий день' }));
    expect(header()).toEqual(['Пт 27']);
  });
});
