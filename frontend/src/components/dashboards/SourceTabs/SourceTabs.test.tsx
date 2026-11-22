import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DashboardLangProvider } from '../../../context/DashboardLangProvider';
import { resetStorageFallback } from '../../../utils/safeStorage';
import SourceTabs from './SourceTabs';

function renderTabs(current: 'overview' | 'github' | 'jira' = 'github', onSelect = vi.fn()) {
  render(
    <DashboardLangProvider>
      <SourceTabs
        tabs={['overview', 'github', 'jira']}
        current={current}
        counts={{ github: 4, jira: 0 }}
        onSelect={onSelect}
        idPrefix="demo"
      />
    </DashboardLangProvider>,
  );
  return onSelect;
}

describe('SourceTabs', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStorageFallback();
  });

  it('is a tab list: each tab with its counter, the current one selected, and a pick reported', async () => {
    const onSelect = renderTabs();
    expect(screen.getByRole('navigation', { name: 'Источники' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Источники' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /GitHub/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /GitHub/ })).toHaveTextContent('4');
    expect(screen.getByRole('tab', { name: 'Jira' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: 'Обзор' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /GitHub/ })).toHaveAttribute('aria-controls', 'demo-panel');

    await userEvent.click(screen.getByRole('tab', { name: 'Jira' }));
    expect(onSelect).toHaveBeenCalledWith('jira');
  });

  it('only the selected tab is a tab stop; the arrow keys, Home and End move and select', async () => {
    const user = userEvent.setup();
    const onSelect = renderTabs('github');
    expect(screen.getByRole('tab', { name: /GitHub/ })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Jira' })).toHaveAttribute('tabindex', '-1');

    screen.getByRole('tab', { name: /GitHub/ }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onSelect).toHaveBeenLastCalledWith('jira');
    expect(screen.getByRole('tab', { name: 'Jira' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(onSelect).toHaveBeenLastCalledWith('overview');
    await user.keyboard('{ArrowLeft}');
    expect(onSelect).toHaveBeenLastCalledWith('jira');
    await user.keyboard('{Home}');
    expect(onSelect).toHaveBeenLastCalledWith('overview');
    await user.keyboard('{End}');
    expect(onSelect).toHaveBeenLastCalledWith('jira');
  });
});
