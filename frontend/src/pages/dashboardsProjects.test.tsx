import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '../context/ThemeContext';
import App from '../App';
import { resetBootstrap } from '../services/dashboards/bootstrapStore';
import { LANG_STORAGE_KEY } from '../services/dashboards/strings';
import { resetStorageFallback } from '../utils/safeStorage';
import { dayOffset, installFakeApi, projectTask, type FakeApi, type FakeApiOptions } from '../test/dashboardsApiMock';

function renderAt(path: string) {
  window.history.pushState({}, '', path);
  return render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
}

const main = () => screen.getByRole('main');

const GARDEN = { id: 'garden', name: 'Garden' };
const SIDE = { id: 'side-project', name: 'Side project' };

function gardenTasks() {
  return [
    projectTask('garden', 'Buy seeds', { priority: true, due_date: dayOffset(-1) }),
    projectTask('garden', 'Water the beds', { due_date: dayOffset(0) }),
    projectTask('garden', 'Build a shed', { due_date: dayOffset(30) }),
    projectTask('garden', 'Sketch the layout'),
    projectTask('garden', 'Old chore', { status: 'done', done_at: '2026-11-10T10:00:00Z' }),
  ];
}

function setup(options: FakeApiOptions = {}): FakeApi {
  sessionStorage.setItem('appLoaded', 'true');
  localStorage.clear();
  resetStorageFallback();
  resetBootstrap();
  return installFakeApi({ projects: [GARDEN, SIDE], ...options, tasks: [...(options.tasks ?? []), ...gardenTasks()] });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the Projects section of the hub', () => {
  it('shows a card per project with its counters, each a link to its page, then the new-project tile', async () => {
    setup();
    renderAt('/dashboards');
    const section = await within(main()).findByRole('region', { name: 'Проекты' });
    const garden = await within(section).findByRole('region', { name: 'Garden' });
    const stat = (card: HTMLElement, label: string) => within(card).getByText(label).previousElementSibling as HTMLElement;
    // Four open tasks (the done one is not counted), one priority, one overdue.
    expect(stat(garden, 'открыто')).toHaveTextContent('4');
    expect(stat(garden, 'приоритет')).toHaveTextContent('1');
    expect(stat(garden, 'просрочено')).toHaveTextContent('1');
    expect(within(garden).getByRole('link', { name: 'Garden' })).toHaveAttribute('href', '/dashboards/projects/garden');
    const side = within(section).getByRole('region', { name: 'Side project' });
    expect(stat(side, 'открыто')).toHaveTextContent('0');
    expect(within(section).getByRole('button', { name: 'Новый проект' })).toBeInTheDocument();
    // The three spaces are still above it.
    expect(within(main()).getByRole('region', { name: 'Личное' })).toBeInTheDocument();
  });

  it('does not list an archived project', async () => {
    setup({ projects: [GARDEN, { ...SIDE, archived: true }] });
    renderAt('/dashboards');
    const section = await within(main()).findByRole('region', { name: 'Проекты' });
    await within(section).findByRole('region', { name: 'Garden' });
    expect(within(section).queryByRole('region', { name: 'Side project' })).toBeNull();
  });

  it('is in English too', async () => {
    setup();
    localStorage.setItem(LANG_STORAGE_KEY, 'en');
    renderAt('/dashboards');
    const section = await within(main()).findByRole('region', { name: 'Projects' });
    expect(await within(section).findByRole('button', { name: 'New project' })).toBeInTheDocument();
    expect(within(section).getAllByText('open').length).toBeGreaterThan(0);
  });

  it('has its own error state with a retry, and leaves the spaces alone', async () => {
    const api = setup({ fail: ['projects'] });
    const user = userEvent.setup();
    renderAt('/dashboards');
    const section = await within(main()).findByRole('region', { name: 'Проекты' });
    expect(await within(section).findByRole('alert')).toHaveTextContent('Не удалось загрузить проекты.');
    expect(await within(main()).findByRole('region', { name: 'Личное' })).toBeInTheDocument();
    api.fail.delete('projects');
    await user.click(within(section).getByRole('button', { name: 'Повторить' }));
    expect(await within(section).findByRole('region', { name: 'Garden' })).toBeInTheDocument();
  });

  it('shows a placeholder while the projects load', async () => {
    setup();
    let answer: (response: Response) => void = () => {};
    const real = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) =>
        url.endsWith('/projects') ? new Promise<Response>((resolve) => (answer = resolve)) : real(url, init),
      ),
    );
    renderAt('/dashboards');
    const section = await within(main()).findByRole('region', { name: 'Проекты' });
    expect(within(section).getByRole('status')).toHaveTextContent('Загрузка…');
    answer(new Response(JSON.stringify({ projects: [] }), { status: 200 }));
    expect(await within(section).findByRole('button', { name: 'Новый проект' })).toBeInTheDocument();
  });

  it('creates a project from a name: Enter or Create, the field closes, the card appears', async () => {
    const api = setup();
    const user = userEvent.setup();
    renderAt('/dashboards');
    const section = await within(main()).findByRole('region', { name: 'Проекты' });
    await user.click(await within(section).findByRole('button', { name: 'Новый проект' }));
    const form = within(within(section).getByRole('form', { name: 'Новый проект' }));
    expect(form.getByLabelText('Название проекта')).toHaveFocus();
    await user.type(form.getByLabelText('Название проекта'), '  Court case  {Enter}');
    await waitFor(() => expect(api.callsTo('POST', '/projects')).toHaveLength(1));
    expect(api.callsTo('POST', '/projects')[0].body).toEqual({ name: 'Court case' });
    expect(await within(section).findByRole('region', { name: 'Court case' })).toBeInTheDocument();
    expect(within(section).queryByRole('form')).toBeNull();
    expect(within(section).getByRole('button', { name: 'Новый проект' })).toBeInTheDocument();
  });

  it('says a clashing name clashes (409), keeps the form and the text, and refuses an empty name', async () => {
    const api = setup();
    const user = userEvent.setup();
    renderAt('/dashboards');
    const section = await within(main()).findByRole('region', { name: 'Проекты' });
    await user.click(await within(section).findByRole('button', { name: 'Новый проект' }));
    const form = within(within(section).getByRole('form'));
    await user.type(form.getByLabelText('Название проекта'), '   {Enter}');
    expect(api.callsTo('POST', '/projects')).toHaveLength(0);
    await user.type(form.getByLabelText('Название проекта'), 'garden{Enter}');
    expect(await form.findByRole('alert')).toHaveTextContent('Проект с таким названием уже есть.');
    expect(form.getByLabelText('Название проекта')).toHaveValue('garden');
    expect(form.getByLabelText('Название проекта')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(within(section).queryByRole('form')).toBeNull();
  });

  it('says any other failure to create in one line', async () => {
    setup({ fail: ['createProject'] });
    const user = userEvent.setup();
    renderAt('/dashboards');
    const section = await within(main()).findByRole('region', { name: 'Проекты' });
    await user.click(await within(section).findByRole('button', { name: 'Новый проект' }));
    await user.type(within(section).getByLabelText('Название проекта'), 'Another{Enter}');
    expect(await within(section).findByRole('alert')).toHaveTextContent('Не удалось создать проект. Повторите.');
  });

  it('is not there on the sample data', async () => {
    setup({ enabled: false });
    renderAt('/dashboards');
    await within(main()).findByRole('region', { name: 'Личное' });
    expect(within(main()).queryByRole('region', { name: 'Проекты' })).toBeNull();
    expect(main()).not.toHaveTextContent('Новый проект');
  });
});

describe('a project page', () => {
  it('has no site chrome, takes its title from the project, and has no source tabs, areas or meetings', async () => {
    setup();
    renderAt('/dashboards/projects/garden');
    expect(await within(main()).findByRole('heading', { level: 1, name: 'Garden' })).toBeInTheDocument();
    expect(document.title).toBe('Garden | Yurii Oksamytnyi');
    expect(screen.queryByRole('banner')).toBeNull();
    expect(screen.queryByRole('contentinfo')).toBeNull();
    expect(within(main()).queryByRole('tablist')).toBeNull();
    expect(within(main()).queryByRole('region', { name: 'Фильтр по сфере' })).toBeNull();
    expect(within(main()).queryByText('Сегодня')).toBeNull();
  });

  it('groups the project\'s tasks: Priority, due, later, no date, and Done behind its disclosure', async () => {
    setup();
    renderAt('/dashboards/projects/garden');
    const m = within(main());
    expect(within(await m.findByRole('region', { name: 'Приоритет' })).getByText('Buy seeds')).toBeInTheDocument();
    expect(within(m.getByRole('region', { name: 'Сегодня и просрочено' })).getByText('Water the beds')).toBeInTheDocument();
    expect(within(m.getByRole('region', { name: 'Позже' })).getByText('Build a shed')).toBeInTheDocument();
    expect(within(m.getByRole('region', { name: 'Без даты' })).getByText('Sketch the layout')).toBeInTheDocument();
    expect(m.queryByText('Old chore')).toBeNull();
    await userEvent.setup().click(m.getByRole('button', { name: 'Готово: 1' }));
    expect(within(m.getByRole('region', { name: 'Готово' })).getByText('Old chore')).toBeInTheDocument();
  });

  it('never shows a space\'s tasks, and asks only for its own', async () => {
    const api = setup({ tasks: [{ ...projectTask('side-project', 'Not mine') }] });
    renderAt('/dashboards/projects/garden');
    await within(main()).findByText('Buy seeds');
    expect(within(main()).queryByText('Not mine')).toBeNull();
    expect(api.calls.filter((call) => call.path.includes('/tasks')).every((call) => call.path === '/projects/garden/tasks')).toBe(true);
  });

  it('adds a task from the quick-add field to this project', async () => {
    const api = setup();
    const user = userEvent.setup();
    renderAt('/dashboards/projects/garden');
    const field = await within(main()).findByRole('textbox', { name: 'Добавить задачу' });
    await user.type(field, 'Order compost{Enter}');
    await waitFor(() => expect(field).toHaveValue(''));
    expect(api.callsTo('POST', '/projects/garden/tasks')[0].body).toEqual({ title: 'Order compost' });
    expect(field).toHaveFocus();
    expect(within(main()).getByText('Order compost')).toBeInTheDocument();
  });

  it('keeps the text and says so when adding fails', async () => {
    setup({ fail: ['create'] });
    const user = userEvent.setup();
    renderAt('/dashboards/projects/garden');
    const field = await within(main()).findByRole('textbox', { name: 'Добавить задачу' });
    await user.type(field, 'Will fail{Enter}');
    expect(await within(main()).findByRole('alert')).toHaveTextContent('Не удалось добавить задачу. Повторите.');
    expect(field).toHaveValue('Will fail');
  });

  it('ticks a task through the project\'s own URL, and rolls back with an error when refused', async () => {
    const api = setup();
    const user = userEvent.setup();
    renderAt('/dashboards/projects/garden');
    const box = await within(main()).findByRole('checkbox', { name: 'Sketch the layout' });
    await user.click(box);
    expect(box).toBeChecked();
    await waitFor(() => expect(api.callsTo('PATCH', '/projects/garden/tasks/')).toHaveLength(1));
    expect(api.callsTo('PATCH', '/projects/garden/tasks/')[0].body).toEqual({ status: 'done' });

    api.fail.add('patch');
    const other = within(main()).getByRole('checkbox', { name: 'Build a shed' });
    await user.click(other);
    expect(await within(main()).findByRole('alert')).toHaveTextContent('Не удалось сохранить: задача возвращена как была.');
    expect(other).not.toBeChecked();
  });

  it('edits a task (no area field) and deletes one, by the project\'s URLs', async () => {
    const api = setup();
    const user = userEvent.setup();
    renderAt('/dashboards/projects/garden');
    await user.click(await within(main()).findByRole('button', { name: 'Изменить: Sketch the layout' }));
    const form = within(within(main()).getByRole('form', { name: 'Изменить: Sketch the layout' }));
    expect(form.queryByLabelText('Сфера')).toBeNull();
    await user.type(form.getByLabelText('Заметки'), 'Pencil first');
    fireEvent.change(form.getByLabelText('Срок'), { target: { value: dayOffset(2) } });
    await user.click(form.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(api.callsTo('PATCH', '/projects/garden/tasks/')).toHaveLength(1));
    expect(api.callsTo('PATCH', '/projects/garden/tasks/')[0].body).toEqual({ notes: 'Pencil first', due_date: dayOffset(2) });

    await user.click(await within(main()).findByRole('button', { name: 'Изменить: Build a shed' }));
    const second = within(within(main()).getByRole('form', { name: 'Изменить: Build a shed' }));
    await user.click(second.getByRole('button', { name: 'Удалить' }));
    await user.click(second.getByRole('button', { name: 'Подтвердить удаление' }));
    await waitFor(() => expect(api.callsTo('DELETE', '/projects/garden/tasks/')).toHaveLength(1));
    await waitFor(() => expect(within(main()).queryByText('Build a shed')).toBeNull());
  });

  it('shows a loading block and an error with a retry for its tasks', async () => {
    const api = setup({ fail: ['tasks'] });
    const user = userEvent.setup();
    renderAt('/dashboards/projects/garden');
    expect(await within(main()).findByText('Не удалось загрузить.')).toBeInTheDocument();
    expect(within(main()).getByRole('heading', { level: 1, name: 'Garden' })).toBeInTheDocument();
    api.fail.delete('tasks');
    await user.click(within(main()).getByRole('button', { name: 'Повторить' }));
    expect(await within(main()).findByText('Buy seeds')).toBeInTheDocument();
  });

  it('renames the project, and the heading and the title follow', async () => {
    const api = setup();
    const user = userEvent.setup();
    renderAt('/dashboards/projects/garden');
    await user.click(await within(main()).findByRole('button', { name: 'Переименовать' }));
    const form = within(within(main()).getByRole('form', { name: 'Переименовать' }));
    const field = form.getByLabelText('Название проекта');
    expect(field).toHaveFocus();
    await user.clear(field);
    await user.type(field, 'Allotment{Enter}');
    await waitFor(() => expect(api.callsTo('PATCH', '/projects/garden')).toHaveLength(1));
    expect(api.callsTo('PATCH', '/projects/garden')[0].body).toEqual({ name: 'Allotment' });
    expect(await within(main()).findByRole('heading', { level: 1, name: 'Allotment' })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('Allotment | Yurii Oksamytnyi'));
  });

  it('keeps the rename form with an error when it fails, and Escape leaves the name as it was', async () => {
    setup({ fail: ['patchProject'] });
    const user = userEvent.setup();
    renderAt('/dashboards/projects/garden');
    await user.click(await within(main()).findByRole('button', { name: 'Переименовать' }));
    const form = within(within(main()).getByRole('form', { name: 'Переименовать' }));
    await user.type(form.getByLabelText('Название проекта'), ' 2{Enter}');
    expect(await within(main()).findByRole('alert')).toHaveTextContent('Не удалось переименовать. Повторите.');
    await user.keyboard('{Escape}');
    expect(within(main()).getByRole('heading', { level: 1, name: 'Garden' })).toBeInTheDocument();
  });

  it('archives behind a confirming click, then goes back to the hub, where it is gone', async () => {
    const api = setup();
    const user = userEvent.setup();
    renderAt('/dashboards/projects/garden');
    await user.click(await within(main()).findByRole('button', { name: 'В архив' }));
    expect(api.callsTo('PATCH', '/projects/garden')).toHaveLength(0);
    await user.click(within(main()).getByRole('button', { name: 'Подтвердить архивацию' }));
    await waitFor(() => expect(api.callsTo('PATCH', '/projects/garden')[0]?.body).toEqual({ archived: true }));
    await waitFor(() => expect(window.location.pathname).toBe('/dashboards'));
    const section = await within(main()).findByRole('region', { name: 'Проекты' });
    await within(section).findByRole('region', { name: 'Side project' });
    expect(within(section).queryByRole('region', { name: 'Garden' })).toBeNull();
  });

  it('does not archive on a first click that is abandoned, and says so when archiving fails', async () => {
    const api = setup({ fail: ['patchProject'] });
    const user = userEvent.setup();
    renderAt('/dashboards/projects/garden');
    const archive = await within(main()).findByRole('button', { name: 'В архив' });
    await user.click(archive);
    await user.click(within(main()).getByRole('button', { name: 'Переименовать' }));
    await user.keyboard('{Escape}');
    expect(within(main()).getByRole('button', { name: 'В архив' })).toBeInTheDocument();
    await user.click(within(main()).getByRole('button', { name: 'В архив' }));
    await user.click(within(main()).getByRole('button', { name: 'Подтвердить архивацию' }));
    expect(await within(main()).findByRole('alert')).toHaveTextContent('Не удалось архивировать. Повторите.');
    expect(api.projects[0].archived).toBe(false);
    expect(window.location.pathname).toBe('/dashboards/projects/garden');
  });

  it('speaks English', async () => {
    setup();
    localStorage.setItem(LANG_STORAGE_KEY, 'en');
    renderAt('/dashboards/projects/garden');
    expect(await within(main()).findByRole('button', { name: 'Rename' })).toBeInTheDocument();
    expect(within(main()).getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    expect(within(main()).getByRole('region', { name: 'Priority' })).toBeInTheDocument();
  });
});

describe('a project that is not there', () => {
  it('says so, with a link back to the hub, for an unknown id', async () => {
    setup();
    renderAt('/dashboards/projects/nope');
    const panel = await within(main()).findByRole('region', { name: 'Проект не найден' });
    expect(panel).toHaveTextContent('Такого проекта нет, или он в архиве.');
    expect(within(panel).getByRole('link', { name: 'К дашбордам' })).toHaveAttribute('href', '/dashboards');
    expect(document.title).toBe('Проект не найден | Yurii Oksamytnyi');
    expect(within(main()).queryByRole('textbox')).toBeNull();
  });

  it('says so for an archived project, and the link leads back', async () => {
    setup({ projects: [{ ...GARDEN, archived: true }] });
    const user = userEvent.setup();
    renderAt('/dashboards/projects/garden');
    const panel = await within(main()).findByRole('region', { name: 'Проект не найден' });
    await user.click(within(panel).getByRole('link', { name: 'К дашбордам' }));
    expect(window.location.pathname).toBe('/dashboards');
    expect(await within(main()).findByRole('region', { name: 'Проекты' })).toBeInTheDocument();
  });

  it('says it in English, and shows an error with a retry when the list cannot be read', async () => {
    const api = setup({ fail: ['projects'] });
    localStorage.setItem(LANG_STORAGE_KEY, 'en');
    const user = userEvent.setup();
    renderAt('/dashboards/projects/garden');
    const alert = await within(main()).findByRole('alert');
    expect(alert).toHaveTextContent('Could not load the projects.');
    api.fail.delete('projects');
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await within(main()).findByRole('heading', { level: 1, name: 'Garden' })).toBeInTheDocument();
  });

  it('is not available on the sample data: the same state, a link back, no projects', async () => {
    const api = setup({ enabled: false });
    renderAt('/dashboards/projects/garden');
    const panel = await within(main()).findByRole('region', { name: 'Проект не найден' });
    expect(panel).toHaveTextContent('Проекты доступны только на реальных данных.');
    expect(within(panel).getByRole('link', { name: 'К дашбордам' })).toBeInTheDocument();
    expect(api.calls.map((call) => call.path)).toEqual(['/bootstrap']);
  });
});
