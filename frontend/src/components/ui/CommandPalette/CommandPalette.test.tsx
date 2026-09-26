import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ThemeProvider } from '../../../context/ThemeContext';
import { SectionNavProvider } from '../../../context/SectionNavProvider';
import { OverlayProvider } from '../../../context/OverlayProvider';
import { ToastProvider } from '../../../context/ToastProvider';
import { useOverlay } from '../../../context/useOverlay';
import { EMAILS, NAV_PAGES, SECTIONS, socialById } from '../../../data/site';
import CommandPalette from './CommandPalette';

function LocationProbe() {
  const { pathname, hash } = useLocation();
  return <div data-testid="location">{pathname + hash}</div>;
}

/** The palette controlled the way PageLayout controls it. */
function Harness() {
  const { active, open, close } = useOverlay();
  return (
    <>
      <button type="button" onClick={() => open('palette')}>
        open palette
      </button>
      <CommandPalette open={active === 'palette'} onClose={() => close('palette')} onShowHelp={() => open('help')} />
      <div data-testid="active">{String(active)}</div>
    </>
  );
}

function renderPalette(path = '/') {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <SectionNavProvider mainRef={{ current: null }}>
          <OverlayProvider>
            <ToastProvider>
              <Harness />
              <Routes>
                <Route path="*" element={<LocationProbe />} />
              </Routes>
            </ToastProvider>
          </OverlayProvider>
        </SectionNavProvider>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

async function openPalette(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'open palette' }));
  return screen.getByRole('combobox', { name: 'Search commands' });
}

const optionTitles = () =>
  screen.getAllByRole('option').map((option) => option.querySelector('span')?.textContent);

describe('CommandPalette', () => {
  it('renders nothing until opened', () => {
    renderPalette();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens as a modal dialog with focus in the search field', async () => {
    const user = userEvent.setup();
    renderPalette();
    const input = await openPalette(user);

    expect(screen.getByRole('dialog', { name: 'Command palette' })).toHaveAttribute('open');
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('aria-controls', screen.getByRole('listbox').id);
  });

  it('lists the sections in page order, then the terminal, the pages, email, profiles, theme and help', async () => {
    const user = userEvent.setup();
    renderPalette();
    await openPalette(user);

    expect(optionTitles()).toEqual([
      ...SECTIONS.filter(({ optional }) => !optional).map(({ label }) => `Go to ${label}`),
      'Go to Terminal',
      ...NAV_PAGES.map(({ label }) => `Go to ${label} page`),
      'Copy email address',
      'Send email',
      'Open LinkedIn',
      'Open X',
      'Open GitHub',
      'Toggle theme',
      'Show help',
    ]);
  });

  it('shows the full list under named groups, and a filtered list without them', async () => {
    const user = userEvent.setup();
    renderPalette();
    const input = await openPalette(user);

    const names = ['Navigate', 'Pages', 'Connect', 'Settings', 'Help'];
    expect(screen.getAllByRole('group')).toEqual(names.map((name) => screen.getByRole('group', { name })));
    expect(screen.getByRole('group', { name: 'Settings' })).toContainElement(
      screen.getByRole('option', { name: /Toggle theme/ }),
    );

    await user.type(input, 'theme');
    expect(screen.queryAllByRole('group')).toHaveLength(0);
  });

  it('opens a page the header keeps in its More menu', async () => {
    const user = userEvent.setup();
    renderPalette();
    const input = await openPalette(user);

    await user.type(input, 'dashboard{Enter}');

    expect(screen.getByTestId('location')).toHaveTextContent('/dashboard');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the list out of the Tab order: the field drives it', async () => {
    const user = userEvent.setup();
    renderPalette();
    await openPalette(user);

    expect(screen.getByRole('listbox')).toHaveAttribute('tabindex', '-1');
  });

  it('names each option after its command, so the active id changes with the results', async () => {
    const user = userEvent.setup();
    renderPalette();
    const input = await openPalette(user);

    const before = input.getAttribute('aria-activedescendant');
    await user.type(input, 'github');
    const after = input.getAttribute('aria-activedescendant');

    expect(before).not.toBe(after);
    expect(document.getElementById(after!)).toHaveTextContent('Open GitHub');
  });

  it('ranks the best match first as the user types', async () => {
    const user = userEvent.setup();
    renderPalette();
    const input = await openPalette(user);

    await user.type(input, 'theme');
    expect(optionTitles()[0]).toBe('Toggle theme');
    expect(optionTitles()).not.toContain('Go to Hero');

    await user.clear(input);
    await user.type(input, 'git');
    expect(optionTitles()[0]).toBe('Open GitHub');
  });

  it('ArrowDown moves the active option and Enter runs it', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const user = userEvent.setup();
    renderPalette();
    const input = await openPalette(user);

    await user.type(input, 'open');
    expect(optionTitles()).toEqual(['Open LinkedIn', 'Open X', 'Open GitHub']);
    const [first, second] = screen.getAllByRole('option');
    expect(input).toHaveAttribute('aria-activedescendant', first.id);
    expect(first).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', second.id);
    expect(second).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{Enter}');
    expect(open).toHaveBeenCalledWith(socialById('x').url, '_blank', 'noopener,noreferrer');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('ArrowUp from the first option wraps to the last', async () => {
    const user = userEvent.setup();
    renderPalette();
    const input = await openPalette(user);

    await user.keyboard('{ArrowUp}');

    const options = screen.getAllByRole('option');
    expect(input).toHaveAttribute('aria-activedescendant', options[options.length - 1].id);
  });

  it('shows an empty state when nothing matches', async () => {
    const user = userEvent.setup();
    renderPalette();
    const input = await openPalette(user);

    await user.type(input, 'qqqq');

    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('No commands match "qqqq"')).toBeInTheDocument();
  });

  it('Escape closes it and returns focus to the button that opened it', async () => {
    const user = userEvent.setup();
    renderPalette();
    await openPalette(user);

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'open palette' })).toHaveFocus();
  });

  it('starts with an empty query every time it opens', async () => {
    const user = userEvent.setup();
    renderPalette();
    const input = await openPalette(user);
    await user.type(input, 'theme');
    await user.keyboard('{Escape}');

    expect(await openPalette(user)).toHaveValue('');
  });

  it.each([
    ['Open LinkedIn', socialById('linkedin').url],
    ['Open X', socialById('x').url],
    ['Open GitHub', socialById('github').url],
  ])('%s opens %s in a new tab without opener or referrer', async (title, url) => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const user = userEvent.setup();
    renderPalette();
    await openPalette(user);

    await user.click(screen.getByText(title));

    expect(open).toHaveBeenCalledWith(url, '_blank', 'noopener,noreferrer');
  });

  it('"Show help" closes the palette and opens the help panel', async () => {
    const user = userEvent.setup();
    renderPalette();
    await openPalette(user);

    await user.click(screen.getByText('Show help'));

    expect(screen.getByTestId('active')).toHaveTextContent('help');
  });

  it('"Copy email address" copies the address and confirms it after the palette closes', async () => {
    const user = userEvent.setup();
    // user-event installs its own clipboard stub in setup().
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    renderPalette();
    await openPalette(user);

    await user.click(screen.getByText('Copy email address'));

    expect(writeText).toHaveBeenCalledWith(EMAILS.personal);
    await expect(navigator.clipboard.readText()).resolves.toBe(EMAILS.personal);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(`Copied ${EMAILS.personal}`));
  });

  it('"Copy email address" shows the address when the clipboard refuses', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('denied'));
    renderPalette();
    await openPalette(user);

    await user.click(screen.getByText('Copy email address'));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(`Could not copy. The address is ${EMAILS.personal}`),
    );
  });

  it('from another page, a section command navigates to that section on the home page', async () => {
    const user = userEvent.setup();
    renderPalette('/courses');
    await openPalette(user);

    await user.click(screen.getByText('Go to Terminal'));

    expect(screen.getByTestId('location')).toHaveTextContent('/#terminal');
  });
});
