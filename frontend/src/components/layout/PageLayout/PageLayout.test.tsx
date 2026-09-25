import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../../../context/ThemeContext';
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
          </section>
        </PageLayout>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

const paletteInput = () => screen.queryByPlaceholderText('Type a command or search...');
// The drawer stays mounted; its "active" class slides it in.
const helpOpen = () =>
  /(^|\s|_)active(_|\s|$)/.test(document.querySelector('[class*="_helpPanel_"]')!.className);

describe('PageLayout overlays', () => {
  beforeEach(() => {
    vi.mocked(Element.prototype.scrollIntoView).mockClear();
  });

  it('never has the command palette and the help panel open together', async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.keyboard('?');
    expect(helpOpen()).toBe(true);

    // Ctrl+K replaces the help panel with the palette.
    await user.keyboard('{Control>}k{/Control}');
    expect(paletteInput()).toBeInTheDocument();
    expect(helpOpen()).toBe(false);

    // '?' typed into the palette's field is text, not a shortcut.
    await user.keyboard('?');
    expect(paletteInput()).toHaveValue('?');
    expect(helpOpen()).toBe(false);

    // Escape closes the palette.
    await user.keyboard('{Escape}');
    expect(paletteInput()).not.toBeInTheDocument();
  });

  it('opens the help panel from the palette\'s "Show Help" command', async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.keyboard('{Control>}k{/Control}');
    await user.click(screen.getByText('Show Help'));

    expect(paletteInput()).not.toBeInTheDocument();
    expect(helpOpen()).toBe(true);
  });

  it('does not treat Ctrl+K as the bare K "previous section" shortcut', async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.keyboard('{Control>}k{/Control}');
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    await user.keyboard('k');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
});
