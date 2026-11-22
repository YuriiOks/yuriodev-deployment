import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DashboardLangProvider } from '../../../context/DashboardLangProvider';
import type { Row, TabId } from '../../../services/dashboards/types';
import { resetStorageFallback } from '../../../utils/safeStorage';
import PanelRow from './PanelRow';
import styles from './PanelRow.module.css';

const title = { ru: 'Заголовок', en: 'A title' };

function renderRow(row: Row, props: { done?: boolean; tinted?: boolean; tab?: TabId; onToggle?: (id: string) => void } = {}) {
  return render(
    <DashboardLangProvider>
      <ul>
        <PanelRow row={row} tab={props.tab ?? 'github'} done={props.done ?? false} onToggle={props.onToggle ?? (() => {})} tinted={props.tinted} />
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

  it('a done task is checked and struck through', () => {
    renderRow({ kind: 'task', id: 't1', title }, { done: true });
    expect(screen.getByRole('checkbox', { name: 'Заголовок' })).toBeChecked();
    expect(screen.getByText('Заголовок')).toHaveClass(styles.done);
  });

  it('a priority task carries a flag the screen reader can hear', () => {
    renderRow({ kind: 'task', id: 't1', title, priority: true });
    expect(screen.getByText('Приоритет')).toHaveClass('sr-only');
  });

  it('a pull request has no checkbox and says its CI state in words', () => {
    renderRow({ kind: 'pr', id: 'p1', title, ref: '#9', refHref: 'https://github.com/example/repo/pull/9', ci: 'pass' });
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText('CI проходит')).toHaveClass('sr-only');
    expect(screen.getByRole('link', { name: /#9/ })).toHaveAttribute('href', 'https://github.com/example/repo/pull/9');
  });

  it('an information row has neither checkbox nor CI state', () => {
    renderRow({ kind: 'info', id: 'i1', title, meta: { ru: 'мета', en: 'meta' } });
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByText('CI проходит')).toBeNull();
    expect(screen.getByText('мета')).toBeInTheDocument();
  });

  it('one trailing element: an action wins, and the badge and the due chip move into the source line', () => {
    const { container } = renderRow({
      kind: 'info',
      id: 'i1',
      title,
      meta: { ru: 'мета', en: 'meta' },
      badge: { ru: 'мусор', en: 'junk' },
      due: { label: { ru: 'сегодня', en: 'today' }, tone: 'warn' },
      action: { verb: 'restore', tool: 'mail' },
    });
    expect(screen.getByRole('button', { name: /Вернуть · Почта/ })).toHaveAttribute('title', 'Пример: источник не подключён');
    const source = container.querySelector(`.${styles.source}`)!;
    expect(within(source).getByText('мета')).toBeInTheDocument();
    expect(within(source).getByText('мусор')).toBeInTheDocument();
    expect(within(source).getByText('сегодня')).toHaveAttribute('data-tone', 'warn');
    expect(container.querySelectorAll(`.${styles.trail}`)).toHaveLength(1);
  });

  it('without an action the badge is the trailing element and the due chip joins the source line', () => {
    const { container } = renderRow({
      kind: 'info',
      id: 'i1',
      title,
      badge: { ru: 'Ждёт ревью', en: 'Needs review' },
      due: { label: { ru: 'сегодня', en: 'today' } },
    });
    const trail = container.querySelector(`.${styles.trail}`)!;
    expect(within(trail as HTMLElement).getByText('Ждёт ревью')).toBeInTheDocument();
    expect(within(container.querySelector(`.${styles.source}`) as HTMLElement).getByText('сегодня')).toBeInTheDocument();
    expect(container.querySelectorAll(`.${styles.trail}`)).toHaveLength(1);
  });

  it('with only a due chip, that is the trailing element and there is no source line', () => {
    const { container } = renderRow({ kind: 'task', id: 't1', title, due: { label: { ru: 'сегодня', en: 'today' }, tone: 'danger' } });
    expect(within(container.querySelector(`.${styles.trail}`) as HTMLElement).getByText('сегодня')).toHaveAttribute('data-tone', 'danger');
    expect(container.querySelector(`.${styles.source}`)).toBeNull();
  });

  it('every kind of row has a leading column that is never empty, so titles line up', () => {
    for (const row of [
      { kind: 'task', id: 'a', title },
      { kind: 'pr', id: 'b', title, ci: 'pass' },
      { kind: 'info', id: 'c', title },
    ] as const) {
      const { container, unmount } = renderRow(row);
      const lead = container.querySelectorAll(`.${styles.lead}`);
      expect(lead).toHaveLength(1);
      expect(lead[0].children.length, row.kind).toBeGreaterThan(0);
      unmount();
    }
  });

  it('an information row is marked with its source icon, or a bullet on the overview', () => {
    const icon = renderRow({ kind: 'info', id: 'c', title }, { tab: 'mail' });
    expect(icon.container.querySelector(`.${styles.lead} svg[data-icon="mail"]`)).not.toBeNull();
    icon.unmount();
    const bullet = renderRow({ kind: 'info', id: 'c', title }, { tab: 'overview' });
    expect(bullet.container.querySelector(`.${styles.lead} .${styles.bullet}`)).not.toBeNull();
  });

  it('the title is one line with the whole title in its tooltip', () => {
    renderRow({ kind: 'pr', id: 'p', title, ref: '#9', refHref: 'https://github.com/example/repo/pull/9', ci: 'pass' });
    expect(screen.getByText('Заголовок').closest('span[id]')).toHaveAttribute('title', '#9 Заголовок');
  });

  it('a done task drops its tint and its urgency', () => {
    const row: Row = { kind: 'task', id: 't', title, priority: true, due: { label: { ru: 'сегодня', en: 'today' }, tone: 'danger' } };
    const open = renderRow(row, { tinted: true });
    expect(open.container.querySelector('li')).toHaveClass(styles.tinted);
    expect(screen.getByText('сегодня')).toHaveAttribute('data-tone', 'danger');
    open.unmount();
    const done = renderRow(row, { tinted: true, done: true });
    expect(done.container.querySelector('li')).not.toHaveClass(styles.tinted);
    expect(screen.getByText('сегодня')).toHaveAttribute('data-tone', 'neutral');
  });

  it('an action with its own href is a link that opens in a new tab', () => {
    renderRow({ kind: 'info', id: 'i1', title, action: { verb: 'open', tool: 'notion', href: 'https://example.com/doc' } });
    const link = screen.getByRole('link', { name: /Открыть · Notion/ });
    expect(link).toHaveAttribute('href', 'https://example.com/doc');
    expect(link).toHaveAttribute('target', '_blank');
  });
});
