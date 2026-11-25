import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '../context/ThemeContext';
import App from '../App';
import { resetBootstrap } from '../services/dashboards/bootstrapStore';
import { LANG_STORAGE_KEY } from '../services/dashboards/strings';
import { resetStorageFallback } from '../utils/safeStorage';
import { installFakeApi, task, type FakeApi, type FakeApiOptions } from '../test/dashboardsApiMock';

// Everything here is invented: made-up tasks, meetings and areas.

function renderAt(path: string) {
  window.history.pushState({}, '', path);
  return render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
}

const main = () => screen.getByRole('main');

function setup(options: FakeApiOptions & { lang?: 'ru' | 'en' } = {}): FakeApi {
  sessionStorage.setItem('appLoaded', 'true');
  localStorage.clear();
  localStorage.setItem(LANG_STORAGE_KEY, options.lang ?? 'en');
  resetStorageFallback();
  resetBootstrap();
  return installFakeApi(options);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const subject = (type: string, id: string, name: string) => ({ type, id, name });
const taskFacts = (extra: Record<string, unknown>) => ({ priority: false, due_date: null, days_overdue: null, days_until: null, area_id: null, source: 'manual', stage: null, source_priority: null, waiting_hours: 5, idle_days: null, ...extra });

const personal = {
  scope: 'personal',
  date: '2026-11-24',
  generated_at: '2026-11-24T08:00:00Z',
  summary: { code: 'personal', facts: { open: 12, priority: 3, overdue: 2, next_event: { title: 'Language lesson', starts_at: '2026-11-24T17:00:00Z' } } },
  queue: [
    { key: 'task:t-1', kind: 'task', subject: subject('task', 't-1', 'File the form'), facts: { reason: 'overdue', ...taskFacts({ days_overdue: 3, due_date: '2026-11-21' }) }, primary: 'mark_done', secondary: 'open_task', link: { kind: 'task', id: 't-1', url: null } },
    { key: 'task:t-2', kind: 'task', subject: subject('task', 't-2', 'Book the dentist'), facts: { reason: 'priority', ...taskFacts({ priority: true }) }, primary: 'mark_done', secondary: 'open_task', link: { kind: 'task', id: 't-2', url: null } },
  ],
  queue_total: 5,
  soon: [{ key: 'task:t-3', kind: 'task', subject: subject('task', 't-3', 'Renew the pass'), facts: taskFacts({ due_date: '2099-01-02', days_until: 9 }) }],
  stats: [
    { code: 'open_tasks', value: 12, compare: null, facts: { priority: 3, without_date: 4, overdue: 2 } },
    { code: 'closed_this_week', value: 6, compare: { code: 'closed_last_week', value: 4 }, facts: {} },
  ],
  breakdown: {
    code: 'open_by_area',
    rows: [
      { key: 'money', value: 5, label: { ru: 'Деньги', en: 'Money' }, facts: {} },
      { key: 'health-sport', value: 3, label: { ru: 'Здоровье и спорт', en: 'Health and sport' }, facts: {} },
    ],
    insight: { code: 'stale_area', facts: { area_id: 'money', count: 4, older_than_days: 30 } },
  },
  today: [{ kind: 'event', starts_at: '2026-11-24T17:00:00Z', ends_at: '2026-11-24T18:00:00Z', subject: subject('event', 'e-1', 'Language lesson'), facts: { busy_only: false, source: 'manual' } }],
  assistant: { enabled: true },
};

const work1 = {
  scope: 'work-1',
  date: '2026-11-24',
  generated_at: '2026-11-24T08:00:00Z',
  summary: { code: 'work-1', facts: { review_waiting: 2, issues_in_progress: 4, urgent: 1, next_event: null } },
  queue: [{ key: 'task:g-1', kind: 'pull_request', subject: subject('task', 'g-1', 'Fix the parser'), facts: { reason: 'review_waiting', ...taskFacts({ source: 'github', stage: 'review', waiting_hours: 70 }) }, primary: 'open_external', secondary: 'snooze', link: { kind: 'pull_request', id: 'g-1', url: 'https://github.example.com/acme/repo/pull/7' } }],
  queue_total: 1,
  soon: [{ key: 'task:g-2', kind: 'pull_request', subject: subject('task', 'g-2', 'Add retries'), facts: taskFacts({ source: 'github', stage: 'review', waiting_hours: 10 }) }],
  stats: [
    { code: 'review_waiting', value: 2, compare: null, facts: { oldest_hours: 70 } },
    { code: 'issues_in_progress', value: 4, compare: null, facts: { by_priority: { urgent: 1, high: 2 } } },
  ],
  breakdown: { code: 'issues_by_stage', rows: [{ key: 'started', value: 4, label: null, facts: {} }, { key: 'unstarted', value: 3, label: null, facts: {} }], insight: { code: 'stalled_pull_requests', facts: { count: 2, oldest_days: 3 } } },
  today: [],
  assistant: { enabled: true },
};

const work2 = {
  scope: 'work-2',
  date: '2026-11-24',
  generated_at: '2026-11-24T08:00:00Z',
  summary: { code: 'work-2', facts: { open: 3, priority: 1, next_event: null } },
  queue: [],
  queue_total: 0,
  soon: [],
  stats: [
    { code: 'open_tasks', value: 3, compare: null, facts: { priority: 1, without_date: 1, overdue: 0 } },
    { code: 'closed_this_week', value: 0, compare: { code: 'closed_last_week', value: 2 }, facts: {} },
  ],
  breakdown: { code: 'meeting_minutes_by_day', rows: [{ key: '2026-11-23', value: 90, label: null, facts: {} }, { key: '2026-11-24', value: 0, label: null, facts: {} }], insight: { code: 'freest_day', facts: { date: '2026-11-24', minutes: 0 } } },
  today: [],
  assistant: { enabled: false },
};

describe('the Today view of the spaces', () => {
  it('is the first tab and the default of Personal, worded from the server\'s codes and facts: the sentence, the queue, the figures, the breakdown with its finding, today', async () => {
    setup({ today: { personal }, tasks: [task('personal', 'File the form', { id: 't-1' })] });
    renderAt('/dashboards/personal');
    const tabs = await within(main()).findByRole('navigation', { name: 'Sources' });
    expect(within(tabs).getAllByRole('tab')[0]).toHaveTextContent('Today');
    expect(within(tabs).getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true');
    expect(await within(main()).findByText(/12 open tasks: 3 priority, 2 overdue\./)).toBeInTheDocument();
    expect(within(main()).getByRole('heading', { level: 2, name: /Good (morning|afternoon|evening)/ })).toBeInTheDocument();
    const queue = within(within(main()).getByRole('region', { name: /First this/ }));
    const cards = queue.getAllByRole('listitem').filter((entry) => entry.getAttribute('data-key'));
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText('Is “File the form” done?')).toBeInTheDocument();
    expect(within(cards[0]).getByText('3 d overdue')).toBeInTheDocument();
    expect(within(cards[0]).getByRole('button', { name: 'Done' })).toBeInTheDocument();
    expect(within(cards[1]).getByText('Take up “Book the dentist” next?')).toBeInTheDocument();
    // The count is how many qualify, not how many are shown.
    expect(queue.getByText('5')).toBeInTheDocument();
    expect(within(main()).getByText('Open tasks')).toBeInTheDocument();
    expect(within(main()).getByText('3 priority · 4 without a date · 2 overdue')).toBeInTheDocument();
    expect(within(main()).getByText('last week: 4')).toBeInTheDocument();
    const breakdown = within(within(main()).getByRole('region', { name: 'Open tasks by area' }));
    expect(breakdown.getAllByRole('listitem')).toHaveLength(2);
    expect(breakdown.getByText('Gone stale: Money')).toBeInTheDocument();
    expect(breakdown.getByText(/4 tasks without a date are older than 30 days/)).toBeInTheDocument();
    expect(within(main()).getByRole('region', { name: 'Today' })).toHaveTextContent('Language lesson');
    // Not served by the backend: not drawn.
    expect(within(main()).queryByText('Ask Claude')).toBeNull();
  });

  it('ticks a task off from its card, and opens a pull request at its own address', async () => {
    const api = setup({ today: { personal, 'work-1': work1 }, tasks: [task('personal', 'File the form', { id: 't-1' })] });
    const user = userEvent.setup();
    const first = renderAt('/dashboards/personal');
    const queue = within(await within(main()).findByRole('region', { name: /First this/ }));
    await user.click((await queue.findAllByRole('button', { name: 'Done' }))[0]);
    await waitFor(() => expect(api.callsTo('PATCH', '/tasks/t-1').length).toBeGreaterThan(0));
    // Work 1: a review request opens where it lives.
    first.unmount();
    renderAt('/dashboards/work-1');
    const reviews = within(await within(main()).findByRole('region', { name: /First this/ }));
    await waitFor(() => expect(reviews.getByText('Review “Fix the parser”?')).toBeInTheDocument());
    expect(reviews.getByText('waiting 3 d')).toBeInTheDocument();
    expect(reviews.getByRole('link', { name: 'Open' })).toHaveAttribute('href', 'https://github.example.com/acme/repo/pull/7');
    expect(within(main()).getByText(/2 reviews waiting, 4 issues in progress, 1 urgent\./)).toBeInTheDocument();
    expect(within(main()).getByText('the oldest has waited 3 d')).toBeInTheDocument();
    expect(within(main()).getByText('1 urgent · 2 high')).toBeInTheDocument();
    expect(within(main()).getByRole('region', { name: 'Issues by state' })).toHaveTextContent('In progress');
    expect(within(main()).getByText('Your pull requests are waiting')).toBeInTheDocument();
  });

  it('shows Work 2 with its own figures and its freest day, and never an Ask box', async () => {
    setup({ today: { 'work-2': work2 } });
    renderAt('/dashboards/work-2');
    expect(await within(main()).findByText(/3 open tasks, 1 priority\./)).toBeInTheDocument();
    expect(within(main()).getByText('Nothing to decide.')).toBeInTheDocument();
    const breakdown = within(within(main()).getByRole('region', { name: 'Meetings by day' }));
    expect(breakdown).toHaveTextContent('1 h 30 min');
    expect(breakdown.getByText(/No meetings on/)).toBeInTheDocument();
    expect(within(main()).queryByText(/Ask/)).toBeNull();
  });

  it('keeps the existing views behind their tabs and says so when the answer cannot be read', async () => {
    setup({ fail: ['today'], tasks: [task('personal', 'File the form', { id: 't-1' })] });
    const user = userEvent.setup();
    renderAt('/dashboards/personal');
    expect(await within(main()).findByRole('alert')).toHaveTextContent('Part of the data could not be loaded.');
    await user.click(within(main()).getByRole('tab', { name: 'Overview' }));
    expect(await within(main()).findByText('File the form')).toBeInTheDocument();
  });

  it('is in Russian too', async () => {
    setup({ lang: 'ru', today: { personal } });
    renderAt('/dashboards/personal');
    expect(await within(main()).findByText(/Открыто задач: 12, из них в приоритете 3, просрочено 2\./)).toBeInTheDocument();
    expect(within(main()).getByText('Готово ли «File the form»?')).toBeInTheDocument();
  });
});
