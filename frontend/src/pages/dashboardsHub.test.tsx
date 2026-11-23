import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '../context/ThemeContext';
import App from '../App';
import { resetBootstrap } from '../services/dashboards/bootstrapStore';
import { weekdayIndex } from '../services/dashboards/calendarDates';
import { dateLabel } from '../services/dashboards/calendarLabels';
import { localDate } from '../services/dashboards/liveTime';
import { SPACES } from '../services/dashboards/spaces';
import { getSpace } from '../services/dashboards/source';
import { STRINGS } from '../services/dashboards/strings';
import { summarize } from '../services/dashboards/summary';
import { resetStorageFallback } from '../utils/safeStorage';
import { installFakeApi, projectTask, type FakeApiOptions } from '../test/dashboardsApiMock';

function renderHub() {
  window.history.pushState({}, '', '/dashboards');
  return render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
}

const main = () => screen.getByRole('main');

function liveSetup(options: FakeApiOptions = {}) {
  sessionStorage.setItem('appLoaded', 'true');
  localStorage.clear();
  resetStorageFallback();
  resetBootstrap();
  return installFakeApi(options);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const today = localDate(new Date());
const expectedDate = `${STRINGS.ru.weekdaysShort[weekdayIndex(today)]}, ${dateLabel(today, STRINGS.ru)}`;

describe('the hub header', () => {
  it('is a card of its own with the title (the h1), today\'s date and the totals, on the sample data', () => {
    sessionStorage.setItem('appLoaded', 'true');
    localStorage.clear();
    resetStorageFallback();
    renderHub();
    const header = screen.getByRole('heading', { level: 1, name: 'Дашборды' }).closest('[data-scheme]') as HTMLElement;
    expect(header).toHaveAttribute('data-scheme', 'site');
    expect(within(header).getByText(expectedDate)).toBeInTheDocument();
    const open = SPACES.reduce((sum, id) => sum + summarize(getSpace(id)).open, 0);
    expect(within(header).getByText(`Открыто задач: ${open}`)).toBeInTheDocument();
    // The nearest sample event is Work 1's 10:00 stand-up (47 minutes away).
    expect(header).toHaveTextContent('Дальше: 10:00 Стендап команды');
  });

  it('says its lines in English too', () => {
    sessionStorage.setItem('appLoaded', 'true');
    localStorage.clear();
    localStorage.setItem('dashboards-lang', 'en');
    resetStorageFallback();
    renderHub();
    const header = screen.getByRole('heading', { level: 1, name: 'Dashboards' }).closest('[data-scheme]') as HTMLElement;
    expect(header).toHaveTextContent(/Open tasks: \d+/);
    expect(header).toHaveTextContent('Next: 10:00 Team stand-up');
  });

  it('on real data totals the open tasks of the three spaces and names the nearest next event, from the summary alone', async () => {
    const api = liveSetup();
    renderHub();
    const header = (await screen.findByRole('heading', { level: 1, name: 'Дашборды' })).closest('[data-scheme]') as HTMLElement;
    // The fake API's spaces hold 5 + 1 + 0 open tasks; only Work 1 has a next event.
    await waitFor(() => expect(header).toHaveTextContent('Открыто задач: 6'));
    expect(header).toHaveTextContent('Дальше:');
    expect(header).toHaveTextContent('Team stand-up');
    expect(within(header).getByText(expectedDate)).toBeInTheDocument();
    // It asks for nothing of its own: bootstrap, summary and the projects the section below needs.
    expect(api.calls.map((call) => call.path).sort()).toEqual(['/bootstrap', '/projects', '/summary']);
  });

  it('keeps the title and the date, and leaves the totals out, while the summary is not there', async () => {
    liveSetup({ fail: ['summary'] });
    renderHub();
    const header = (await screen.findByRole('heading', { level: 1, name: 'Дашборды' })).closest('[data-scheme]') as HTMLElement;
    await screen.findByRole('alert');
    expect(within(header).getByText(expectedDate)).toBeInTheDocument();
    expect(header).not.toHaveTextContent('Открыто задач');
  });
});

describe('the hub cards carry their colour scheme', () => {
  it('each space card names its scheme (its own colour), on the sample data', () => {
    sessionStorage.setItem('appLoaded', 'true');
    localStorage.clear();
    resetStorageFallback();
    renderHub();
    for (const [name, scheme] of [['Личное', 'personal'], ['Работа 1', 'work-1'], ['Работа 2', 'work-2']]) {
      expect(within(main()).getByRole('region', { name })).toHaveAttribute('data-scheme', scheme);
    }
  });

  it('each space card names its scheme on real data too, and every project card the one project scheme', async () => {
    liveSetup({ projects: [{ id: 'garden', name: 'Garden' }, { id: 'side-project', name: 'Side project' }], tasks: [projectTask('garden', 'Seeds')] });
    renderHub();
    for (const [name, scheme] of [['Личное', 'personal'], ['Работа 1', 'work-1'], ['Работа 2', 'work-2']]) {
      expect(await within(main()).findByRole('region', { name })).toHaveAttribute('data-scheme', scheme);
    }
    const garden = await within(main()).findByRole('region', { name: 'Garden' });
    expect(garden).toHaveAttribute('data-scheme', 'project');
    expect(within(main()).getByRole('region', { name: 'Side project' })).toHaveAttribute('data-scheme', 'project');
  });

  it('a space card is one real link (one tab stop, no other interactive element) that the stretched anchor makes the whole card\'s target', async () => {
    liveSetup({ projects: [{ id: 'garden', name: 'Garden' }] });
    renderHub();
    for (const [name, href] of [['Личное', '/dashboards/personal'], ['Работа 1', '/dashboards/work-1'], ['Работа 2', '/dashboards/work-2'], ['Garden', '/dashboards/projects/garden']]) {
      const card = await within(main()).findByRole('region', { name });
      const links = within(card).getAllByRole('link');
      expect(links).toHaveLength(1);
      expect(links[0]).toHaveAttribute('href', href);
      expect(within(card).queryAllByRole('button')).toHaveLength(0);
      expect(card.querySelectorAll('[onclick]')).toHaveLength(0);
    }
  });

  it('the new-project tile and its form carry no scheme', async () => {
    liveSetup();
    renderHub();
    const tile = await within(main()).findByRole('button', { name: 'Новый проект' });
    expect(tile.closest('[data-scheme]')).toBeNull();
  });
});
