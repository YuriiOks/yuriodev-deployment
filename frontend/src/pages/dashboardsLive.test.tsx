import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '../context/ThemeContext';
import App from '../App';
import { resetBootstrap } from '../services/dashboards/bootstrapStore';
import { LANG_STORAGE_KEY } from '../services/dashboards/strings';
import { resetStorageFallback } from '../utils/safeStorage';
import { BASE, dayOffset, event, installFakeApi, task, type FakeApi, type FakeApiOptions } from '../test/dashboardsApiMock';

function renderAt(path: string) {
  window.history.pushState({}, '', path);
  return render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
}

const main = () => screen.getByRole('main');

/** Starts every test with the bootstrap not yet asked, English off (Russian, the default), and a fake API. */
function setup(options: FakeApiOptions = {}): FakeApi {
  sessionStorage.setItem('appLoaded', 'true');
  localStorage.clear();
  resetStorageFallback();
  resetBootstrap();
  return installFakeApi(options);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the switch between real data and the sample data', () => {
  beforeEach(() => {
    sessionStorage.setItem('appLoaded', 'true');
  });

  it('asks the bootstrap once, with no auth header, and runs on the API when it says enabled', async () => {
    const api = setup();
    renderAt('/dashboards/personal');
    expect(await within(main()).findByRole('region', { name: 'Приоритет' })).toBeInTheDocument();
    expect(within(main()).getByText('Pay the bill')).toBeInTheDocument();
    expect(within(main()).queryByText('Оплатить счёт за электричество')).toBeNull();
    const bootstrap = api.calls.filter((call) => call.path === '/bootstrap');
    expect(bootstrap).toHaveLength(1);
    expect(bootstrap[0].url).toBe(`${BASE}/bootstrap`);
    expect(Object.keys(bootstrap[0].headers).map((h) => h.toLowerCase())).not.toContain('authorization');
  });

  it('asks only once while the visitor moves between dashboards pages', async () => {
    const api = setup();
    const user = userEvent.setup();
    renderAt('/dashboards');
    await within(main()).findByRole('region', { name: 'Личное' });
    await user.click(within(main()).getByRole('link', { name: 'Работа 1' }));
    await within(main()).findByText('Review the pull request');
    expect(api.calls.filter((call) => call.path === '/bootstrap')).toHaveLength(1);
  });

  it('keeps the sample data when the bootstrap says disabled', async () => {
    const api = setup({ enabled: false });
    renderAt('/dashboards/personal');
    expect(await within(main()).findByText('Оплатить счёт за электричество')).toBeInTheDocument();
    expect(api.calls.map((call) => call.path)).toEqual(['/bootstrap']);
    // Every sample tab is still there, with its counter.
    expect(within(main()).getByRole('tab', { name: /^Почта/ })).toHaveTextContent('8');
  });

  it.each([
    ['a failing answer', { fail: ['bootstrap'] } as FakeApiOptions],
  ])('keeps the sample data on %s', async (_name, options) => {
    setup(options);
    renderAt('/dashboards/personal');
    expect(await within(main()).findByText('Оплатить счёт за электричество')).toBeInTheDocument();
  });

  it('keeps the sample data on a network error and on a non-JSON answer', async () => {
    setup();
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))));
    const first = renderAt('/dashboards/personal');
    expect(await within(main()).findByText('Оплатить счёт за электричество')).toBeInTheDocument();
    first.unmount();

    resetBootstrap();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('<html>nginx</html>', { status: 200 }))));
    renderAt('/dashboards/work-1');
    expect(await within(main()).findByText('Ревью #123: пример изменения')).toBeInTheDocument();
  });

  it('shows a quiet placeholder, not the sample data, while the answer is on its way', async () => {
    setup();
    let answer: (response: Response) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))));
    renderAt('/dashboards/personal');
    expect(within(main()).getByRole('status')).toHaveTextContent('Загрузка…');
    expect(within(main()).queryByText('Оплатить счёт за электричество')).toBeNull();
    answer(new Response(JSON.stringify({ enabled: false }), { status: 200 }));
    expect(await within(main()).findByText('Оплатить счёт за электричество')).toBeInTheDocument();
  });
});

describe('the entrance on real data', () => {
  it('shows the counters and the next event from the summary', async () => {
    setup();
    renderAt('/dashboards');
    const personal = await within(main()).findByRole('region', { name: 'Личное' });
    // Personal: 5 open (the done one is not counted), 1 priority, 1 overdue.
    const stat = (card: HTMLElement, label: string) => within(card).getByText(label).previousElementSibling as HTMLElement;
    await waitFor(() => expect(stat(personal, 'открыто')).toHaveTextContent('5'));
    expect(stat(personal, 'приоритет')).toHaveTextContent('1');
    expect(stat(personal, 'просрочено')).toHaveTextContent('1');
    expect(within(personal).getByText('Ближайших событий нет')).toBeInTheDocument();
    const work = within(main()).getByRole('region', { name: 'Работа 1' });
    expect(work).toHaveTextContent('Дальше:');
    expect(work).toHaveTextContent('Team stand-up');
    expect(within(work).getByRole('link', { name: 'Работа 1' })).toHaveAttribute('href', '/dashboards/work-1');
  });

  it('says so, with a retry, when the summary fails, and recovers', async () => {
    const api = setup({ fail: ['summary'] });
    const user = userEvent.setup();
    renderAt('/dashboards');
    const alert = await within(main()).findByRole('alert');
    expect(alert).toHaveTextContent('Не удалось загрузить сводку.');
    api.fail.delete('summary');
    await user.click(within(alert).getByRole('button', { name: 'Повторить' }));
    expect(await within(main()).findByRole('region', { name: 'Личное' })).toBeInTheDocument();
    expect(within(main()).queryByRole('alert')).toBeNull();
  });
});

describe('a space on real data: the overview', () => {
  it('groups the tasks: Priority, due and overdue, this week, later, no date; the done one is only under Done', async () => {
    setup();
    renderAt('/dashboards/personal');
    const m = within(main());
    const names = ['Приоритет', 'Сегодня и просрочено', 'На этой неделе', 'Позже', 'Без даты'];
    for (const name of names) expect(await m.findByRole('region', { name })).toBeInTheDocument();
    expect(within(m.getByRole('region', { name: 'Приоритет' })).getByText('Pay the bill')).toBeInTheDocument();
    // The overdue task is in Priority, so Due holds only the one due today.
    expect(within(m.getByRole('region', { name: 'Сегодня и просрочено' })).getAllByRole('checkbox')).toHaveLength(1);
    expect(within(m.getByRole('region', { name: 'На этой неделе' })).getByText('Book a table')).toBeInTheDocument();
    expect(within(m.getByRole('region', { name: 'Позже' })).getByText('Collect the papers')).toBeInTheDocument();
    expect(within(m.getByRole('region', { name: 'Без даты' })).getByText('Plan a trip')).toBeInTheDocument();
    expect(m.queryByText('Old chore')).toBeNull();

    await userEvent.setup().click(m.getByRole('button', { name: 'Готово: 1' }));
    expect(within(m.getByRole('region', { name: 'Готово' })).getByText('Old chore')).toBeInTheDocument();
  });

  it('says overdue and today in words, with the area for the personal space', async () => {
    setup();
    renderAt('/dashboards/personal');
    const priority = await within(main()).findByRole('region', { name: 'Приоритет' });
    const row = within(priority).getByText('Pay the bill').closest('li')!;
    expect(within(row).getByText('просрочено')).toHaveAttribute('data-tone', 'danger');
    expect(within(row).getByText('Деньги')).toBeInTheDocument();
    const due = within(main()).getByRole('region', { name: 'Сегодня и просрочено' });
    expect(within(due).getByText('сегодня')).toHaveAttribute('data-tone', 'warn');
  });

  it('a space with no tasks says so in the Priority panel, and shows nothing else', async () => {
    setup({ tasks: [] });
    renderAt('/dashboards/work-2');
    const panel = await within(main()).findByRole('region', { name: 'Приоритет' });
    expect(panel).toHaveTextContent('Задач пока нет.');
    expect(within(main()).queryByRole('region', { name: 'Позже' })).toBeNull();
    expect(within(main()).queryByRole('button', { name: /^Готово:/ })).toBeNull();
  });

  it('never mixes spaces: each page asks for its own space only', async () => {
    const api = setup();
    renderAt('/dashboards/work-1');
    await within(main()).findByText('Review the pull request');
    expect(within(main()).queryByText('Pay the bill')).toBeNull();
    expect(api.calls.filter((call) => call.path.includes('/tasks')).every((call) => call.path === '/spaces/work-1/tasks')).toBe(true);
  });

  it('shows the next event from the summary in the strip, in whole minutes', async () => {
    setup();
    renderAt('/dashboards/work-1');
    expect(await within(main()).findByText('Team stand-up')).toBeInTheDocument();
    expect(within(main()).getByText(/^через 4[67] мин$/)).toBeInTheDocument();
    expect(within(main()).queryByRole('button', { name: 'Подключиться' })).toBeNull();
  });

  it('shows the group names in English too', async () => {
    setup();
    localStorage.setItem(LANG_STORAGE_KEY, 'en');
    renderAt('/dashboards/personal');
    for (const name of ['Priority', 'Due and overdue', 'This week', 'Later', 'No date']) {
      expect(await within(main()).findByRole('region', { name })).toBeInTheDocument();
    }
    expect(within(main()).getByRole('button', { name: 'Done: 1' })).toBeInTheDocument();
  });

  it('shows a loading block while the tasks come, and an error with a retry when they do not', async () => {
    const api = setup({ fail: ['tasks'] });
    const user = userEvent.setup();
    renderAt('/dashboards/personal');
    // The page around the failure stays usable: tabs and the field are there.
    expect(await within(main()).findByText('Не удалось загрузить.')).toBeInTheDocument();
    expect(within(main()).getByRole('textbox', { name: 'Добавить задачу' })).toBeInTheDocument();
    expect(within(main()).getByRole('tab', { name: 'Обзор' })).toBeInTheDocument();
    api.fail.delete('tasks');
    await user.click(within(main()).getByRole('button', { name: 'Повторить' }));
    expect(await within(main()).findByText('Pay the bill')).toBeInTheDocument();
  });
});

describe('source tabs on real data', () => {
  it('say "not connected yet" instead of showing sample rows, and carry no counters', async () => {
    setup();
    const user = userEvent.setup();
    renderAt('/dashboards/personal');
    await within(main()).findByRole('region', { name: 'Приоритет' });
    const tabs = within(main()).getByRole('navigation', { name: 'Источники' });
    // No tab shows a number.
    for (const tab of within(tabs).getAllByRole('tab')) expect(tab.textContent).not.toMatch(/\d/);
    await user.click(within(tabs).getByRole('tab', { name: 'Почта' }));
    const panel = within(main()).getByRole('region', { name: 'Почта' });
    expect(panel).toHaveTextContent('Пока не подключено');
    expect(panel).toHaveTextContent('Этот источник ещё не подключён');
    expect(within(main()).queryByText('Счёт за электричество')).toBeNull();
    expect(within(main()).queryAllByRole('checkbox')).toHaveLength(0);
    // Nothing to add a task to here.
    expect(within(main()).queryByRole('textbox')).toBeNull();
  });

  it('are the same in English, and also on a work space', async () => {
    setup();
    localStorage.setItem(LANG_STORAGE_KEY, 'en');
    const user = userEvent.setup();
    renderAt('/dashboards/work-1');
    await within(main()).findByRole('region', { name: 'Priority' });
    await user.click(within(main()).getByRole('tab', { name: 'GitHub' }));
    expect(within(main()).getByRole('region', { name: 'GitHub' })).toHaveTextContent('Not connected yet');
  });
});

describe('the life areas tab', () => {
  it('counts open tasks per area and filters the list by the chosen one', async () => {
    setup();
    const user = userEvent.setup();
    renderAt('/dashboards/personal');
    await within(main()).findByRole('region', { name: 'Приоритет' });
    await user.click(within(main()).getByRole('tab', { name: 'Сферы' }));
    const filter = within(main()).getByRole('region', { name: 'Фильтр по сфере' });
    // 5 open tasks: three have an area, two have none.
    expect(within(filter).getByRole('button', { name: /^Все сферы/ })).toHaveTextContent('5');
    expect(within(filter).getByRole('button', { name: /^Деньги/ })).toHaveTextContent('1');
    expect(within(filter).getByRole('button', { name: /^Романтические/ })).toHaveTextContent('1');
    expect(within(filter).getByRole('button', { name: /^Без сферы/ })).toHaveTextContent('2');

    await user.click(within(filter).getByRole('button', { name: /^Здоровье и спорт/ }));
    const list = within(main()).getByRole('region', { name: 'Здоровье и спорт' });
    expect(within(list).getAllByRole('checkbox')).toHaveLength(1);
    expect(within(list).getByText('Call the clinic')).toBeInTheDocument();
    expect(within(filter).getByRole('button', { name: /^Здоровье и спорт/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('puts a task added on a chosen area into that area', async () => {
    const api = setup();
    const user = userEvent.setup();
    renderAt('/dashboards/personal');
    await within(main()).findByRole('region', { name: 'Приоритет' });
    await user.click(within(main()).getByRole('tab', { name: 'Сферы' }));
    await user.click(within(main()).getByRole('button', { name: /^Деньги/ }));
    await user.type(within(main()).getByRole('textbox', { name: 'Добавить задачу' }), 'Pay rent{Enter}');
    await waitFor(() => expect(api.callsTo('POST', '/tasks')).toHaveLength(1));
    expect(api.callsTo('POST', '/tasks')[0].body).toEqual({ title: 'Pay rent', area_id: 'money' });
  });
});

describe('quick-add on real data', () => {
  it('creates a task in this space from plain text, clears the field, keeps the focus, and shows the task', async () => {
    const api = setup();
    const user = userEvent.setup();
    renderAt('/dashboards/work-1');
    const field = await within(main()).findByRole('textbox', { name: 'Добавить задачу' });
    await user.type(field, '  Buy milk tomorrow at 5 !!  {Enter}');
    await waitFor(() => expect(field).toHaveValue(''));
    // Plain text, trimmed: no parsing of "tomorrow" or "!!".
    expect(api.callsTo('POST', '/spaces/work-1/tasks')[0].body).toEqual({ title: 'Buy milk tomorrow at 5 !!' });
    expect(field).toHaveFocus();
    expect(within(main()).getByText('Buy milk tomorrow at 5 !!')).toBeInTheDocument();
  });

  it('does nothing for an empty field', async () => {
    const api = setup();
    const user = userEvent.setup();
    renderAt('/dashboards/work-1');
    const field = await within(main()).findByRole('textbox', { name: 'Добавить задачу' });
    await user.type(field, '   {Enter}');
    expect(api.callsTo('POST', '/tasks')).toHaveLength(0);
  });

  it('on failure keeps the text and the focus and shows one error line, which goes away when typing again', async () => {
    const api = setup({ fail: ['create'] });
    const user = userEvent.setup();
    renderAt('/dashboards/work-1');
    const field = await within(main()).findByRole('textbox', { name: 'Добавить задачу' });
    await user.type(field, 'Will fail{Enter}');
    expect(await within(main()).findByRole('alert')).toHaveTextContent('Не удалось добавить задачу. Повторите.');
    expect(field).toHaveValue('Will fail');
    expect(field).toHaveFocus();
    expect(within(main()).queryByText('Will fail', { selector: 'span' })).toBeNull();
    await user.type(field, '!');
    expect(within(main()).queryByRole('alert')).toBeNull();
    api.fail.delete('create');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(field).toHaveValue(''));
    expect(within(main()).getByText('Will fail!')).toBeInTheDocument();
  });
});

describe('ticking a task on real data', () => {
  it('completes it at once, before the answer, and tells the API', async () => {
    const api = setup();
    let release!: () => void;
    api.gate = new Promise<void>((resolve) => (release = resolve));
    const user = userEvent.setup();
    renderAt('/dashboards/personal');
    const box = await within(main()).findByRole('checkbox', { name: 'Plan a trip' });
    await user.click(box);
    // Optimistic: checked and struck through while the request is still held.
    expect(box).toBeChecked();
    expect(within(main()).getByText('Plan a trip').closest('li')).toHaveAttribute('data-done', 'true');
    await waitFor(() => expect(api.callsTo('PATCH', '/tasks/')).toHaveLength(1));
    expect(api.callsTo('PATCH', '/tasks/')[0].body).toEqual({ status: 'done' });
    release();
    await waitFor(() => expect(api.tasks.find((t) => t.title === 'Plan a trip')?.status).toBe('done'));
    expect(box).toBeChecked();
  });

  it('keeps a done task where it was, struck through, until the next load; then it is only under Done', async () => {
    const api = setup();
    const user = userEvent.setup();
    const first = renderAt('/dashboards/personal');
    const box = await within(main()).findByRole('checkbox', { name: 'Plan a trip' });
    await user.click(box);
    await waitFor(() => expect(api.tasks.find((t) => t.title === 'Plan a trip')?.status).toBe('done'));
    expect(within(within(main()).getByRole('region', { name: 'Без даты' })).getByText('Plan a trip')).toBeInTheDocument();
    first.unmount();

    renderAt('/dashboards/personal');
    await within(main()).findByRole('region', { name: 'Приоритет' });
    expect(within(main()).queryByText('Plan a trip')).toBeNull();
    await user.click(within(main()).getByRole('button', { name: 'Готово: 2' }));
    expect(within(within(main()).getByRole('region', { name: 'Готово' })).getByText('Plan a trip')).toBeInTheDocument();
  });

  it('reopens a done task from the Done list', async () => {
    const api = setup();
    const user = userEvent.setup();
    renderAt('/dashboards/personal');
    await user.click(await within(main()).findByRole('button', { name: 'Готово: 1' }));
    await user.click(within(main()).getByRole('checkbox', { name: 'Old chore' }));
    await waitFor(() => expect(api.callsTo('PATCH', '/tasks/')[0]?.body).toEqual({ status: 'open' }));
  });

  it('rolls back with an inline error when the request fails, and can try again', async () => {
    const api = setup({ fail: ['patch'] });
    const user = userEvent.setup();
    renderAt('/dashboards/personal');
    const box = await within(main()).findByRole('checkbox', { name: 'Plan a trip' });
    await user.click(box);
    const alert = await within(main()).findByRole('alert');
    expect(alert).toHaveTextContent('Не удалось сохранить: задача возвращена как была.');
    expect(box).not.toBeChecked();
    expect(within(main()).getByText('Plan a trip').closest('li')).not.toHaveAttribute('data-done');
    api.fail.delete('patch');
    await user.click(within(alert).getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(box).toBeChecked());
    expect(within(main()).queryByRole('alert')).toBeNull();
  });
});

/** The task editor (the quick-add field is a form too, so the editor is found by its name). */
const editor = () => within(main()).queryByRole('form', { name: /^Изменить:/ });

describe('editing a task on real data', () => {
  async function openEditor(title: string) {
    const user = userEvent.setup();
    const m = within(main());
    await user.click(await m.findByRole('button', { name: `Изменить: ${title}` }));
    return { user, form: m.getByRole('form', { name: `Изменить: ${title}` }) };
  }

  it('opens under the row with the title focused, and the area field for the personal space only', async () => {
    setup();
    const { form } = await openEditor('Plan a trip');
    const f = within(form);
    expect(f.getByLabelText('Название')).toHaveFocus();
    expect(f.getByLabelText('Заметки')).toBeInTheDocument();
    expect(f.getByLabelText('Сфера')).toBeInTheDocument();
    expect(f.getByLabelText('Срок')).toBeInTheDocument();
    expect(f.getByRole('checkbox', { name: 'Приоритет' })).not.toBeChecked();
    expect(within(main()).getByRole('button', { name: 'Изменить: Plan a trip' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('has no area field on a work space', async () => {
    setup();
    const { form } = await openEditor('Review the pull request');
    expect(within(form).queryByLabelText('Сфера')).toBeNull();
  });

  it('saves only what changed, through PATCH, and the row follows', async () => {
    const api = setup();
    const { user, form } = await openEditor('Plan a trip');
    const f = within(form);
    await user.clear(f.getByLabelText('Название'));
    await user.type(f.getByLabelText('Название'), 'Plan the trip');
    await user.type(f.getByLabelText('Заметки'), 'Check visas');
    await user.selectOptions(f.getByLabelText('Сфера'), 'romantic');
    await user.click(f.getByRole('checkbox', { name: 'Приоритет' }));
    fireEvent.change(f.getByLabelText('Срок'), { target: { value: dayOffset(1) } });
    await user.click(f.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(api.callsTo('PATCH', '/tasks/')).toHaveLength(1));
    expect(api.callsTo('PATCH', '/tasks/')[0].body).toEqual({
      title: 'Plan the trip',
      notes: 'Check visas',
      area_id: 'romantic',
      priority: true,
      due_date: dayOffset(1),
    });
    // The editor closes and the task is now a priority one.
    await waitFor(() => expect(editor()).toBeNull());
    expect(within(within(main()).getByRole('region', { name: 'Приоритет' })).getByText('Plan the trip')).toBeInTheDocument();
  });

  it('can clear a date, sending null', async () => {
    const api = setup();
    const { user, form } = await openEditor('Call the clinic');
    await user.click(within(form).getByRole('button', { name: 'Убрать срок' }));
    await user.click(within(form).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(api.callsTo('PATCH', '/tasks/')[0]?.body).toEqual({ due_date: null }));
  });

  it('refuses an empty title without sending anything, and sends nothing when nothing changed', async () => {
    const api = setup();
    const { user, form } = await openEditor('Plan a trip');
    await user.clear(within(form).getByLabelText('Название'));
    await user.click(within(form).getByRole('button', { name: 'Сохранить' }));
    expect(within(form).getByRole('alert')).toHaveTextContent('Укажите название.');
    await user.type(within(form).getByLabelText('Название'), 'Plan a trip');
    await user.click(within(form).getByRole('button', { name: 'Сохранить' }));
    expect(api.callsTo('PATCH', '/tasks/')).toHaveLength(0);
    expect(editor()).toBeNull();
  });

  it('keeps the editor open with the typed text and an error line when the save fails', async () => {
    const api = setup({ fail: ['patch'] });
    const { user, form } = await openEditor('Plan a trip');
    await user.type(within(form).getByLabelText('Заметки'), 'kept');
    await user.click(within(form).getByRole('button', { name: 'Сохранить' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Не удалось сохранить. Повторите.');
    expect(within(form).getByLabelText('Заметки')).toHaveValue('kept');
    api.fail.delete('patch');
    await user.click(within(form).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(editor()).toBeNull());
  });

  it('closes on Escape and on Cancel without sending anything', async () => {
    const api = setup();
    const { user, form } = await openEditor('Plan a trip');
    await user.type(within(form).getByLabelText('Название'), 'x');
    await user.keyboard('{Escape}');
    expect(editor()).toBeNull();
    await user.click(within(main()).getByRole('button', { name: 'Изменить: Plan a trip' }));
    await user.click(within(editor()!).getByRole('button', { name: 'Отмена' }));
    expect(editor()).toBeNull();
    expect(api.callsTo('PATCH', '/tasks/')).toHaveLength(0);
  });

  it('deletes after a second, confirming click, and the row goes', async () => {
    const api = setup();
    const { user, form } = await openEditor('Plan a trip');
    await user.click(within(form).getByRole('button', { name: 'Удалить' }));
    expect(api.callsTo('DELETE', '/tasks/')).toHaveLength(0);
    await user.click(within(form).getByRole('button', { name: 'Подтвердить удаление' }));
    await waitFor(() => expect(api.callsTo('DELETE', '/tasks/')).toHaveLength(1));
    await waitFor(() => expect(within(main()).queryByText('Plan a trip')).toBeNull());
  });

  it('keeps the task and says so when the delete fails', async () => {
    setup({ fail: ['delete'] });
    const { user, form } = await openEditor('Plan a trip');
    await user.click(within(form).getByRole('button', { name: 'Удалить' }));
    await user.click(within(form).getByRole('button', { name: 'Подтвердить удаление' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Не удалось удалить. Повторите.');
    expect(within(main()).getByText('Plan a trip', { selector: 'span[title]' })).toBeInTheDocument();
  });

  it('speaks English too', async () => {
    setup();
    localStorage.setItem(LANG_STORAGE_KEY, 'en');
    const user = userEvent.setup();
    renderAt('/dashboards/personal');
    await user.click(await within(main()).findByRole('button', { name: 'Edit: Plan a trip' }));
    const f = within(main().querySelector('form[aria-label^="Edit"]') as HTMLElement);
    for (const label of ['Title', 'Notes', 'Area', 'Due date']) expect(f.getByLabelText(label)).toBeInTheDocument();
    expect(f.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(f.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });
});

describe('the calendar on real data', () => {
  const dateOf = (url: string, name: 'from' | 'to') => new URL(url, 'http://x').searchParams.get(name)!;
  const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);

  it('reads the events of the visible week, and the next week when stepped', async () => {
    const api = setup({ events: [event('work-1', 'Planning', dayOffset(0), '10:00', '11:00')] });
    const user = userEvent.setup();
    renderAt('/dashboards/calendar');
    expect(await within(main()).findByText('Planning')).toBeInTheDocument();
    const first = api.callsTo('GET', '/events')[0];
    expect(days(dateOf(first.url, 'from'), dateOf(first.url, 'to'))).toBe(6);
    expect(dayOffset(0) >= dateOf(first.url, 'from') && dayOffset(0) <= dateOf(first.url, 'to')).toBe(true);

    await user.click(within(main()).getByRole('button', { name: 'Следующая неделя' }));
    await waitFor(() => expect(api.callsTo('GET', '/events')).toHaveLength(2));
    const second = api.callsTo('GET', '/events')[1];
    expect(days(dateOf(first.url, 'to'), dateOf(second.url, 'to'))).toBe(7);
    // Never asks for more than the contract allows.
    expect(days(dateOf(second.url, 'from'), dateOf(second.url, 'to'))).toBeLessThanOrEqual(62);
  });

  it('reads the weeks of the month in the month view (at most 62 days)', async () => {
    const api = setup();
    const user = userEvent.setup();
    renderAt('/dashboards/calendar');
    await within(main()).findByRole('table');
    await user.click(within(main()).getByRole('button', { name: 'Месяц' }));
    await waitFor(() => expect(api.callsTo('GET', '/events')).toHaveLength(2));
    const call = api.callsTo('GET', '/events')[1];
    const span = days(dateOf(call.url, 'from'), dateOf(call.url, 'to')) + 1;
    expect(span % 7).toBe(0);
    expect(span).toBeLessThanOrEqual(42);
  });

  it('shows a busy-only event as Focus time, and the legend as before', async () => {
    setup({ events: [event('personal', 'Doctor', dayOffset(0), '11:00', '12:00', { busy_only: true })] });
    renderAt('/dashboards/calendar');
    const block = (await within(main()).findByText('Doctor')).closest('li')!;
    expect(block).toHaveAttribute('data-note', 'true');
    expect(within(block).getByText('Фокус-время')).toHaveClass('sr-only');
    expect(within(main()).getByText('Занято, без деталей')).toBeInTheDocument();
  });

  it('shows an error with a retry when the events fail, and the page stays usable', async () => {
    const api = setup({ fail: ['events'] });
    const user = userEvent.setup();
    renderAt('/dashboards/calendar');
    const alert = await within(main()).findByRole('alert');
    expect(alert).toHaveTextContent('Не удалось загрузить события.');
    expect(within(main()).getByRole('table')).toBeInTheDocument();
    expect(within(main()).getByRole('button', { name: 'Месяц' })).toBeEnabled();
    api.fail.delete('events');
    await user.click(within(alert).getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(within(main()).queryByRole('alert')).toBeNull());
  });

  it('adds an event from a simple form: title, date, times, space, Focus time; then reads again', async () => {
    const api = setup();
    const user = userEvent.setup();
    renderAt('/dashboards/calendar');
    await within(main()).findByRole('table');
    expect(within(main()).queryByRole('form')).toBeNull();
    await user.click(within(main()).getByRole('button', { name: 'Новое событие' }));
    const form = within(within(main()).getByRole('form', { name: 'Новое событие' }));
    expect(form.getByLabelText('Название')).toHaveFocus();
    await user.type(form.getByLabelText('Название'), 'Dentist');
    fireEvent.change(form.getByLabelText('Дата'), { target: { value: dayOffset(1) } });
    fireEvent.change(form.getByLabelText('Начало'), { target: { value: '14:00' } });
    fireEvent.change(form.getByLabelText('Конец'), { target: { value: '15:30' } });
    await user.selectOptions(form.getByLabelText('Пространство'), 'work-2');
    await user.click(form.getByRole('checkbox', { name: /Фокус-время/ }));
    const before = api.callsTo('GET', '/events').length;
    await user.click(form.getByRole('button', { name: 'Добавить событие' }));
    await waitFor(() => expect(api.callsTo('POST', '/spaces/work-2/events')).toHaveLength(1));
    const body = api.callsTo('POST', '/events')[0].body!;
    expect(body.title).toBe('Dentist');
    expect(body.starts_at).toMatch(new RegExp(`^${dayOffset(1)}T14:00:00[+-]\\d{2}:\\d{2}$`));
    expect(body.ends_at).toMatch(new RegExp(`^${dayOffset(1)}T15:30:00[+-]\\d{2}:\\d{2}$`));
    expect(body.busy_only).toBe(true);
    await waitFor(() => expect(api.callsTo('GET', '/events').length).toBeGreaterThan(before));
    await waitFor(() => expect(within(main()).queryByRole('form')).toBeNull());
    expect(within(main()).getByRole('status')).toHaveTextContent('Событие добавлено');
  });

  it('refuses an end before the start, and a missing title, without sending anything; keeps the form on a failure', async () => {
    const api = setup({ fail: ['createEvent'] });
    const user = userEvent.setup();
    renderAt('/dashboards/calendar');
    await user.click(await within(main()).findByRole('button', { name: 'Новое событие' }));
    const form = within(within(main()).getByRole('form'));
    await user.click(form.getByRole('button', { name: 'Добавить событие' }));
    expect(form.getByRole('alert')).toHaveTextContent('Укажите название.');
    await user.type(form.getByLabelText('Название'), 'Backwards');
    fireEvent.change(form.getByLabelText('Конец'), { target: { value: '09:00' } });
    await user.click(form.getByRole('button', { name: 'Добавить событие' }));
    expect(form.getByRole('alert')).toHaveTextContent('Конец должен быть позже начала.');
    expect(api.callsTo('POST', '/events')).toHaveLength(0);
    fireEvent.change(form.getByLabelText('Конец'), { target: { value: '12:00' } });
    await user.click(form.getByRole('button', { name: 'Добавить событие' }));
    expect(await form.findByRole('alert')).toHaveTextContent('Не удалось добавить событие. Повторите.');
    expect(within(main()).getByRole('form')).toBeInTheDocument();
  });

  it('is in English too, and the form closes on Escape', async () => {
    setup();
    localStorage.setItem(LANG_STORAGE_KEY, 'en');
    const user = userEvent.setup();
    renderAt('/dashboards/calendar');
    await user.click(await within(main()).findByRole('button', { name: 'New event' }));
    const form = within(within(main()).getByRole('form', { name: 'New event' }));
    for (const label of ['Title', 'Date', 'Start', 'End', 'Space']) expect(form.getByLabelText(label)).toBeInTheDocument();
    expect(form.getByRole('checkbox', { name: /Focus time/ })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(within(main()).queryByRole('form')).toBeNull();
  });

  it('has no New event button on the sample data', async () => {
    setup({ enabled: false });
    renderAt('/dashboards/calendar');
    await within(main()).findByRole('table');
    expect(within(main()).queryByRole('button', { name: 'Новое событие' })).toBeNull();
  });
});

describe('task rows are rows', () => {
  it('have the one-line structure of every row: a checkbox, the title, plain meta, one button', async () => {
    setup({ tasks: [task('personal', 'Plain row', { due_date: dayOffset(5), area_id: 'money' })] });
    renderAt('/dashboards/personal');
    const row = (await within(main()).findByText('Plain row')).closest('li')!;
    expect(row).toHaveAttribute('data-lead', 'true');
    expect(within(row).getAllByRole('button')).toHaveLength(1);
    expect(row.querySelectorAll('[class*="badge"], [class*="chip"]')).toHaveLength(0);
  });
});
