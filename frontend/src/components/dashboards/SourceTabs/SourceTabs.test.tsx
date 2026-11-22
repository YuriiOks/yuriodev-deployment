import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DashboardLangProvider } from '../../../context/DashboardLangProvider';
import { resetStorageFallback } from '../../../utils/safeStorage';
import SourceTabs from './SourceTabs';

describe('SourceTabs', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStorageFallback();
  });

  it('shows each tab with its counter, marks the current one and reports a pick', async () => {
    const onSelect = vi.fn();
    render(
      <DashboardLangProvider>
        <SourceTabs tabs={['overview', 'github', 'jira']} current="github" counts={{ github: 4, jira: 0 }} onSelect={onSelect} />
      </DashboardLangProvider>,
    );
    const nav = screen.getByRole('navigation', { name: 'Источники' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /GitHub/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /GitHub/ })).toHaveTextContent('4');
    expect(screen.getByRole('button', { name: 'Jira' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Обзор' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Jira' }));
    expect(onSelect).toHaveBeenCalledWith('jira');
  });
});
