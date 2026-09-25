import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ThemeProvider } from '../../../context/ThemeContext';
import CommandPalette from './CommandPalette';

function LocationProbe() {
  const { pathname, hash } = useLocation();
  return <div data-testid="location">{pathname + hash}</div>;
}

function renderPalette(path = '/') {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <CommandPalette />
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it.each([
    ['View LinkedIn', 'https://www.linkedin.com/in/y-oks'],
    ['View X', 'https://x.com/YuriODev'],
    ['View GitHub', 'https://github.com/YuriiOks'],
  ])('%s opens %s in a new tab without opener or referrer', async (title, url) => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const user = userEvent.setup();
    renderPalette();
    await openPalette(user);

    await user.click(screen.getByText(title));

    expect(open).toHaveBeenCalledWith(url, '_blank', 'noopener,noreferrer');
  });

  it('from another page, a section command navigates to that section on the home page', async () => {
    const user = userEvent.setup();
    renderPalette('/courses');
    await openPalette(user);

    await user.click(screen.getByText('Go to Terminal'));

    expect(screen.getByTestId('location')).toHaveTextContent('/#terminal');
  });
});
