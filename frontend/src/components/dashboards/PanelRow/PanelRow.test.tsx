import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DashboardLangProvider } from '../../../context/DashboardLangProvider';
import type { Row } from '../../../services/dashboards/types';
import { resetStorageFallback } from '../../../utils/safeStorage';
import PanelRow from './PanelRow';
import styles from './PanelRow.module.css';

const title = { ru: 'Заголовок', en: 'A title' };
const WARN = { label: { ru: 'сегодня', en: 'today' }, tone: 'warn' } as const;
const DANGER = { label: { ru: 'просрочено', en: 'overdue' }, tone: 'danger' } as const;

function renderRow(row: Row, props: { done?: boolean; lead?: boolean; onToggle?: (id: string) => void } = {}) {
  return render(
    <DashboardLangProvider>
      <ul>
        <PanelRow row={row} lead={props.lead ?? true} done={props.done ?? false} onToggle={props.onToggle ?? (() => {})} />
      </ul>
    </DashboardLangProvider>,
  );
}

describe('PanelRow', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStorageFallback();
  });

  it('a task is a checkbox named by its title, and reports its id when toggled', async () => {
    const onToggle = vi.fn();
    renderRow({ kind: 'task', id: 't1', title }, { onToggle });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Заголовок' }));
    expect(onToggle).toHaveBeenCalledWith('t1');
  });

  it('a done task is checked, struck through, and shows the tick', () => {
    const { container } = renderRow({ kind: 'task', id: 't1', title }, { done: true });
    expect(screen.getByRole('checkbox', { name: 'Заголовок' })).toBeChecked();
    expect(screen.getByText('Заголовок')).toHaveClass(styles.done);
    expect(container.querySelector('svg[data-icon="check"]')).not.toBeNull();
  });

  it('a priority task carries a flag the screen reader can hear, and looks like any other row', () => {
    const { container } = renderRow({ kind: 'task', id: 't1', title, priority: true });
    expect(screen.getByText('Приоритет')).toHaveClass('sr-only');
    expect(container.querySelector('li')!.className).toBe(styles.row + ' ' + styles.task);
  });

  it('a pull request has no checkbox and says its CI state with an icon and in words', () => {
    const { container, rerender } = renderRow({ kind: 'pr', id: 'p1', title, ref: '#9', refHref: 'https://github.com/example/repo/pull/9', ci: 'pass' });
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText('CI проходит')).toHaveClass('sr-only');
    expect(container.querySelector('svg[data-icon="circle-check"]')).not.toBeNull();
    expect(screen.getByRole('link', { name: /#9/ })).toHaveAttribute('href', 'https://github.com/example/repo/pull/9');
    rerender(
      <DashboardLangProvider>
        <ul>
          <PanelRow row={{ kind: 'pr', id: 'p1', title, ci: 'fail' }} lead done={false} onToggle={() => {}} />
        </ul>
      </DashboardLangProvider>,
    );
    expect(container.querySelector('svg[data-icon="circle-x"]')).not.toBeNull();
    expect(screen.getByText('CI падает')).toHaveClass('sr-only');
  });

  it('an information row has neither checkbox nor CI state, and reserves the lead column only if the panel has one', () => {
    const { container, unmount } = renderRow({ kind: 'info', id: 'i1', title, meta: { ru: 'мета', en: 'meta' } }, { lead: false });
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByText('CI проходит')).toBeNull();
    expect(screen.getByText('мета')).toBeInTheDocument();
    expect(container.querySelector(`.${styles.lead}`)).toBeNull();
    unmount();
    const aligned = renderRow({ kind: 'info', id: 'i1', title }, { lead: true });
    expect(aligned.container.querySelector(`.${styles.lead}`)).not.toBeNull();
    expect(aligned.container.querySelector('li')).toHaveAttribute('data-lead', 'true');
  });

  it('meta, status and due are plain text in one group, with the one button beside it', () => {
    const { container } = renderRow({
      kind: 'info',
      id: 'i1',
      title,
      meta: { ru: 'мета', en: 'meta' },
      badge: { ru: 'мусор', en: 'junk' },
      due: WARN,
      action: { verb: 'restore', tool: 'mail' },
    });
    const meta = container.querySelector(`.${styles.meta}`) as HTMLElement;
    expect(within(meta).getByText('мета')).toBeInTheDocument();
    expect(within(meta).getByText('мусор')).toHaveAttribute('data-tone', 'neutral');
    expect(within(meta).getByText('сегодня')).toHaveAttribute('data-tone', 'warn');
    const button = screen.getByRole('button', { name: /Вернуть · Почта/ });
    expect(button).toHaveAttribute('title', 'Пример: источник не подключён');
    expect(button).toHaveTextContent(/^Вернуть$/);
    expect(button.querySelector('svg')).toBeNull();
    expect(meta).not.toContainElement(button);
  });

  it('overdue is danger text with an alert icon, today is warn, a later date is plain', () => {
    const overdue = renderRow({ kind: 'task', id: 't1', title, due: DANGER });
    expect(screen.getByText('просрочено')).toHaveAttribute('data-tone', 'danger');
    expect(overdue.container.querySelector(`.${styles.due} svg[data-icon="alert"]`)).not.toBeNull();
    overdue.unmount();
    const today = renderRow({ kind: 'task', id: 't1', title, due: WARN });
    expect(screen.getByText('сегодня')).toHaveAttribute('data-tone', 'warn');
    expect(today.container.querySelector('svg')).toBeNull();
    today.unmount();
    renderRow({ kind: 'task', id: 't1', title, due: { label: { ru: 'чт 26 ноя', en: 'Thu 26 Nov' } } });
    expect(screen.getByText('чт 26 ноя')).toHaveAttribute('data-tone', 'neutral');
  });

  it('a failing status is danger text; nothing in a row is a capsule', () => {
    const { container } = renderRow({ kind: 'pr', id: 'p', title, ci: 'fail', badge: { ru: 'CI красный', en: 'CI failing' }, badgeTone: 'danger' });
    expect(screen.getByText('CI красный')).toHaveAttribute('data-tone', 'danger');
    expect(container.querySelectorAll('[class*="badge"], [class*="chip"]')).toHaveLength(0);
  });

  it('the title is one line with the whole title in its tooltip', () => {
    renderRow({ kind: 'pr', id: 'p', title, ref: '#9', refHref: 'https://github.com/example/repo/pull/9', ci: 'pass' });
    expect(screen.getByText('Заголовок').closest('span[id]')).toHaveAttribute('title', '#9 Заголовок');
  });

  it('a done task drops its urgency', () => {
    const row: Row = { kind: 'task', id: 't', title, priority: true, due: DANGER };
    const open = renderRow(row);
    expect(screen.getByText('просрочено')).toHaveAttribute('data-tone', 'danger');
    open.unmount();
    const done = renderRow(row, { done: true });
    expect(screen.getByText('просрочено')).toHaveAttribute('data-tone', 'neutral');
    expect(done.container.querySelector(`.${styles.due} svg`)).toBeNull();
  });

  it('an action with its own href is a link that opens in a new tab', () => {
    renderRow({ kind: 'info', id: 'i1', title, action: { verb: 'open', tool: 'notion', href: 'https://example.com/doc' } });
    const link = screen.getByRole('link', { name: /Открыть · Notion/ });
    expect(link).toHaveAttribute('href', 'https://example.com/doc');
    expect(link).toHaveAttribute('target', '_blank');
  });
});
