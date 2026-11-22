import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DashboardLangProvider } from '../../../context/DashboardLangProvider';
import type { Row } from '../../../services/dashboards/types';
import { resetStorageFallback } from '../../../utils/safeStorage';
import PanelRow from './PanelRow';
import styles from './PanelRow.module.css';

const title = { ru: 'Заголовок', en: 'A title' };

function renderRow(row: Row, props: { done?: boolean; tinted?: boolean; onToggle?: (id: string) => void } = {}) {
  return render(
    <DashboardLangProvider>
      <ul>
        <PanelRow row={row} done={props.done ?? false} onToggle={props.onToggle ?? (() => {})} tinted={props.tinted} />
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

  it('shows the badge and the due chip, and an action as a link to its tool', () => {
    renderRow({
      kind: 'info',
      id: 'i1',
      title,
      badge: { ru: 'мусор', en: 'junk' },
      due: { label: { ru: 'сегодня', en: 'today' }, tone: 'warn' },
      action: { verb: 'restore', tool: 'mail' },
    });
    expect(screen.getByText('мусор')).toBeInTheDocument();
    expect(screen.getByText('сегодня')).toHaveAttribute('data-tone', 'warn');
    expect(screen.getByRole('link', { name: /Вернуть · Почта/ })).toHaveAttribute('href', 'https://mail.google.com');
  });

  it('an action with an explicit href uses it', () => {
    renderRow({ kind: 'info', id: 'i1', title, action: { verb: 'open', tool: 'notion', href: 'https://example.com/doc' } });
    expect(screen.getByRole('link', { name: /Открыть · Notion/ })).toHaveAttribute('href', 'https://example.com/doc');
  });
});
