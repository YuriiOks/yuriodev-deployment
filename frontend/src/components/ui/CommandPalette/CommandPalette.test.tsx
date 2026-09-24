import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '../../../context/ThemeContext';
import CommandPalette from './CommandPalette';

function renderPalette() {
  return render(
    <ThemeProvider>
      <CommandPalette />
    </ThemeProvider>,
  );
}

async function openPalette(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard('{Control>}k{/Control}');
}

describe('CommandPalette', () => {
  it('renders nothing until opened', () => {
    renderPalette();
    expect(screen.queryByPlaceholderText('Type a command or search...')).not.toBeInTheDocument();
  });

  it('opens on Ctrl+K and lists every command', async () => {
    const user = userEvent.setup();
    renderPalette();
    await openPalette(user);

    expect(screen.getByPlaceholderText('Type a command or search...')).toBeInTheDocument();
    expect(screen.getByText('Go to Hero')).toBeInTheDocument();
    expect(screen.getByText('Toggle Theme')).toBeInTheDocument();
    expect(screen.getByText('View GitHub')).toBeInTheDocument();
  });

  it('filters the command list as the user types', async () => {
    const user = userEvent.setup();
    renderPalette();
    await openPalette(user);

    const input = screen.getByPlaceholderText('Type a command or search...');
    await user.type(input, 'theme');

    expect(screen.getByText('Toggle Theme')).toBeInTheDocument();
    expect(screen.queryByText('Go to Hero')).not.toBeInTheDocument();
    expect(screen.queryByText('View GitHub')).not.toBeInTheDocument();
  });

  it('filters by shortcut as well as title', async () => {
    const user = userEvent.setup();
    renderPalette();
    await openPalette(user);

    const input = screen.getByPlaceholderText('Type a command or search...');
    await user.type(input, 'github');

    expect(screen.getByText('View GitHub')).toBeInTheDocument();
    expect(screen.queryByText('Toggle Theme')).not.toBeInTheDocument();
  });
});
