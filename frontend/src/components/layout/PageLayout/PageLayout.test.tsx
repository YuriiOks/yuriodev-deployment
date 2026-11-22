import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../../../context/ThemeContext';
import { resetStorageFallback } from '../../../utils/safeStorage';
import PageLayout from './PageLayout';

function renderLayout() {
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <PageLayout>
          <section id="hero">
            <h1>Hero</h1>
          </section>
          <section id="about">
            <h2>About</h2>
            <input aria-label="page field" />
            <div contentEditable suppressContentEditableWarning aria-label="editable">
              text
            </div>
          </section>
        </PageLayout>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

const paletteInput = () => screen.queryByRole('combobox', { name: 'Search commands' });
const helpDialog = () => screen.queryByRole('dialog', { name: 'Help' });
const openDialogs = () => document.querySelectorAll('dialog[open]');
const theme = () => document.documentElement.getAttribute('data-theme');

beforeEach(() => {
  vi.mocked(Element.prototype.scrollIntoView).mockClear();
  localStorage.clear();
  resetStorageFallback();
});

afterEach(() => {
  localStorage.clear();
  resetStorageFallback();
});

describe('PageLayout overlays', () => {
  it('never has the command palette and the help panel open together', async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.keyboard('?');
    expect(helpDialog()).toBeInTheDocument();
    expect(openDialogs()).toHaveLength(1);

    // Ctrl+K replaces the help panel with the palette.
    await user.keyboard('{Control>}k{/Control}');
    expect(paletteInput()).toHaveFocus();
    expect(helpDialog()).not.toBeInTheDocument();
    expect(openDialogs()).toHaveLength(1);

    // '?' typed into the palette's field is text, not a shortcut.
    await user.keyboard('?');
    expect(paletteInput()).toHaveValue('?');
    expect(helpDialog()).not.toBeInTheDocument();

    // Escape closes the palette.
    await user.keyboard('{Escape}');
    expect(paletteInput()).not.toBeInTheDocument();
    expect(openDialogs()).toHaveLength(0);
  });

  it('Ctrl+K and Cmd+K toggle the palette', async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.keyboard('{Meta>}k{/Meta}');
    expect(paletteInput()).toBeInTheDocument();
    await user.keyboard('{Control>}k{/Control}');
    expect(paletteInput()).not.toBeInTheDocument();
  });

  it('Ctrl+K opens the palette from inside a text field too', async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.click(screen.getByLabelText('page field'));
    await user.keyboard('{Control>}k{/Control}');

    expect(paletteInput()).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.getByLabelText('page field')).toHaveFocus();
  });

  it('opens the help panel from the palette\'s "Show help" command', async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.keyboard('{Control>}k{/Control}');
    await user.click(screen.getByText('Show help'));

    expect(paletteInput()).not.toBeInTheDocument();
    expect(helpDialog()).toBeInTheDocument();
  });

  it('the header buttons open the palette and the help panel', async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.click(screen.getByRole('button', { name: 'Open command palette' }));
    expect(paletteInput()).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Open command palette' })).toHaveFocus();

    await user.click(screen.getByLabelText('Show help panel'));
    expect(helpDialog()).toBeInTheDocument();
    // Its scrolling body, so the arrow keys scroll the drawer at once.
    expect(within(helpDialog()!).getByRole('heading', { name: 'Keyboard Shortcuts' }).closest('[tabindex="-1"]')).toHaveFocus();
  });

  it('opening the palette closes the header menu', async () => {
    const user = userEvent.setup();
    renderLayout();
    const menuButton = screen.getByLabelText('Toggle mobile menu');

    await user.click(menuButton);
    expect(menuButton).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard('{Control>}k{/Control}');
    expect(paletteInput()).toBeInTheDocument();
    expect(menuButton).toHaveAttribute('aria-expanded', 'false');
  });

  it('? closes the help panel it opened', async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.keyboard('?');
    expect(helpDialog()).toBeInTheDocument();
    await user.keyboard('?');
    expect(helpDialog()).not.toBeInTheDocument();
  });
});

describe('PageLayout keyboard shortcuts', () => {
  it('does not treat Ctrl+K as the bare K "previous section" shortcut', async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.keyboard('{Control>}k{/Control}');
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    await user.keyboard('k');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('ignores single keys pressed with Alt, Ctrl or Cmd', async () => {
    const user = userEvent.setup();
    renderLayout();
    const before = theme();

    await user.keyboard('{Alt>}t{/Alt}{Control>}t{/Control}{Meta>}j{/Meta}');

    expect(theme()).toBe(before);
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it('single keys typed into a field or an editable element are text, not shortcuts', async () => {
    const user = userEvent.setup();
    renderLayout();
    const before = theme();

    await user.click(screen.getByLabelText('page field'));
    await user.keyboard('tjk?');
    await user.click(screen.getByLabelText('editable'));
    await user.keyboard('tjk?');

    expect(theme()).toBe(before);
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(openDialogs()).toHaveLength(0);
  });

  it('T toggles the theme', async () => {
    const user = userEvent.setup();
    renderLayout();
    const before = theme();

    await user.keyboard('t');

    expect(theme()).not.toBe(before);
  });

  it('the help panel switch turns single-key shortcuts off (remembered), while Ctrl+K keeps working', async () => {
    const user = userEvent.setup();
    const { unmount } = renderLayout();

    await user.keyboard('?');
    const toggle = screen.getByRole('switch', { name: 'Single-key shortcuts' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(localStorage.getItem('shortcuts')).toBe('off');
    await user.keyboard('{Escape}');

    const before = theme();
    await user.keyboard('t?jk');
    expect(theme()).toBe(before);
    expect(openDialogs()).toHaveLength(0);
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();

    await user.keyboard('{Control>}k{/Control}');
    expect(paletteInput()).toBeInTheDocument();
    await user.keyboard('{Escape}');

    // Still off after a reload.
    unmount();
    renderLayout();
    await user.keyboard('?');
    expect(helpDialog()).not.toBeInTheDocument();

    // And back on from the palette's help command.
    await user.keyboard('{Control>}k{/Control}');
    await user.click(screen.getByText('Show help'));
    await user.click(screen.getByRole('switch', { name: 'Single-key shortcuts' }));
    await user.keyboard('{Escape}');
    await user.keyboard('?');
    expect(helpDialog()).toBeInTheDocument();
  });
});

describe('PageLayout on a page with no site chrome (the dashboards)', () => {
  const renderAt = (path: string) =>
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={[path]}>
          <PageLayout currentPath={path}>
            <p>page</p>
          </PageLayout>
        </MemoryRouter>
      </ThemeProvider>,
    );

  it('a site page has the full frame: header, footer, canvas, main', () => {
    renderAt('/privacy');
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(document.querySelector('canvas')).not.toBeNull();
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it.each(['/dashboards', '/dashboards/personal', '/dashboards/work-1', '/dashboards/work-2', '/dashboards/calendar'])(
    '%s has only the skip link and main: no header, footer, canvas, rail, scroll-to-top or overlays',
    (path) => {
      renderAt(path);
      expect(screen.queryByRole('banner')).toBeNull();
      expect(screen.queryByRole('contentinfo')).toBeNull();
      expect(document.querySelector('canvas')).toBeNull();
      expect(document.querySelector('header')).toBeNull();
      expect(document.getElementById('sectionRail')).toBeNull();
      expect(screen.queryByLabelText('Scroll to top')).toBeNull();
      expect(document.querySelector('dialog')).toBeNull();
      expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
      const skip = screen.getByRole('link', { name: 'Skip to main content' });
      expect(skip).toHaveAttribute('href', '#main-content');
    },
  );

  it('the skip link on a chrome-less page moves focus to main', async () => {
    const user = userEvent.setup();
    renderAt('/dashboards');
    await user.tab();
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('the site shortcuts do nothing there: Ctrl+K opens no palette', async () => {
    const user = userEvent.setup();
    renderAt('/dashboards');
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.queryByRole('combobox', { name: 'Search commands' })).toBeNull();
  });
});
