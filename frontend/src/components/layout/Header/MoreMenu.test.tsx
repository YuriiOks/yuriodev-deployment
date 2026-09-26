import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ThemeProvider } from '../../../context/ThemeContext';
import { SectionNavProvider } from '../../../context/SectionNavProvider';
import { OverlayProvider } from '../../../context/OverlayProvider';
import { useOverlay } from '../../../context/useOverlay';
import { minWidth } from '../../../constants/breakpoints';
import { navPages } from '../../../data/site';
import Header from './Header';

// From the sidebar breakpoint up, where the More menu lives.
const originalMatchMedia = window.matchMedia;
beforeEach(() => {
  window.matchMedia = vi.fn((query: string) => ({
    matches: query === minWidth('sidebar'),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

function HeaderAtLocation() {
  const { pathname } = useLocation();
  return (
    <>
      <Header currentPath={pathname} />
      <div data-testid="location">{pathname}</div>
    </>
  );
}

function Overlays() {
  const { active, open } = useOverlay();
  return (
    <>
      <div data-testid="overlay">{String(active)}</div>
      <button type="button" onClick={() => open('palette')}>open palette</button>
    </>
  );
}

function RoutedOverlayProvider({ children }: { children: React.ReactNode }) {
  return <OverlayProvider routeKey={useLocation().pathname}>{children}</OverlayProvider>;
}

let navigateFromOutside: (to: string) => void = () => {};
function NavigateElsewhere() {
  navigateFromOutside = useNavigate();
  return null;
}

function renderHeader(path = '/') {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <SectionNavProvider mainRef={{ current: null }}>
          <RoutedOverlayProvider>
            <Routes>
              <Route path="*" element={<HeaderAtLocation />} />
            </Routes>
            <p>outside</p>
            <Overlays />
            <NavigateElsewhere />
          </RoutedOverlayProvider>
        </SectionNavProvider>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

const moreButton = () => screen.getByRole('button', { name: '--more' });
const moreLinks = () => navPages('more').map(({ navLabel }) => screen.queryByRole('link', { name: navLabel }));

describe('Header from 88rem', () => {
  it('lists the main page inline and the others behind a More button, with no menu button', () => {
    renderHeader();
    expect(screen.getByRole('link', { name: '--portfolio' })).toBeVisible();
    expect(screen.queryByLabelText('Toggle mobile menu')).toBeNull();
    expect(moreButton()).toHaveAttribute('aria-expanded', 'false');
    // Closed: the links are not on screen (nor in the Tab order).
    expect(moreLinks()).toEqual(navPages('more').map(() => null));
  });

  it('shows the full prompt with the current page', () => {
    renderHeader('/privacy');
    expect(screen.getByText('yurii@yuriodev:~$ ./privacy')).toBeInTheDocument();
  });
});

describe('More menu', () => {
  it('is a disclosure: aria-expanded, aria-controls, plain links', async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(moreButton());

    expect(moreButton()).toHaveAttribute('aria-expanded', 'true');
    const panel = document.getElementById(moreButton().getAttribute('aria-controls')!)!;
    expect(panel).toBeVisible();
    expect(screen.queryAllByRole('menu')).toHaveLength(0);
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
    for (const link of moreLinks()) expect(panel).toContainElement(link);
    expect(screen.getByTestId('overlay')).toHaveTextContent('more');
  });

  it('closes on Escape and returns focus to its button', async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(moreButton());
    await user.tab();
    expect(moreLinks()[0]).toHaveFocus();

    await user.keyboard('{Escape}');

    expect(moreButton()).toHaveAttribute('aria-expanded', 'false');
    expect(moreButton()).toHaveFocus();
  });

  it('closes on a click outside', async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(moreButton());

    await user.click(screen.getByText('outside'));

    expect(moreButton()).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes when one of its links is followed, and the page opens', async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(moreButton());

    await user.click(screen.getByRole('link', { name: '--dashboard' }));

    expect(screen.getByTestId('location')).toHaveTextContent('/dashboard');
    expect(moreButton()).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes when the route changes from outside it', async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(moreButton());

    act(() => navigateFromOutside('/privacy'));

    expect(moreButton()).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes when Tab moves focus past its last link', async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(moreButton());
    const links = moreLinks();
    links[links.length - 1]!.focus();

    await user.tab();

    expect(moreButton()).toHaveAttribute('aria-expanded', 'false');
  });

  it('never stays open with another overlay: the palette replaces it, and it replaces the palette', async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(moreButton());

    await user.click(screen.getByRole('button', { name: 'Open command palette' }));
    expect(screen.getByTestId('overlay')).toHaveTextContent('palette');
    expect(moreButton()).toHaveAttribute('aria-expanded', 'false');

    await user.click(moreButton());
    expect(screen.getByTestId('overlay')).toHaveTextContent('more');

    await user.click(screen.getByLabelText('Show help panel'));
    expect(screen.getByTestId('overlay')).toHaveTextContent('help');
    expect(moreButton()).toHaveAttribute('aria-expanded', 'false');
  });

  it('marks the current page inside it, and its button, while that page is open', async () => {
    const user = userEvent.setup();
    renderHeader('/courses');
    expect(moreButton().className).toMatch(/current/);
    expect(screen.getByRole('link', { name: '--portfolio' })).not.toHaveAttribute('aria-current');

    await user.click(moreButton());
    expect(screen.getByRole('link', { name: '--courses' })).toHaveAttribute('aria-current', 'page');
  });

  it('on the home page marks the main link instead', () => {
    renderHeader('/');
    expect(screen.getByRole('link', { name: '--portfolio' })).toHaveAttribute('aria-current', 'page');
    expect(moreButton().className).not.toMatch(/current/);
  });
});
