import type React from 'react';
import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ThemeProvider } from '../../../context/ThemeContext';
import { SectionNavProvider } from '../../../context/SectionNavProvider';
import { OverlayProvider } from '../../../context/OverlayProvider';
import { useOverlay } from '../../../context/useOverlay';
import { SECTIONS } from '../../../data/site';
import Header from './Header';

// Header is rendered outside <Routes> in the app and receives the path as a
// prop; mirror that here.
function HeaderAtLocation() {
  const { pathname, hash } = useLocation();
  return (
    <>
      <Header currentPath={pathname} />
      <div data-testid="location">{pathname + hash}</div>
    </>
  );
}

function ActiveOverlay() {
  return <div data-testid="overlay">{String(useOverlay().active)}</div>;
}

/** As PageLayout does: the overlays are keyed to the current route. */
function RoutedOverlayProvider({ children }: { children: React.ReactNode }) {
  return <OverlayProvider routeKey={useLocation().pathname}>{children}</OverlayProvider>;
}

/** Route changes from outside the header (the browser's Back button, a script). */
let navigateFromOutside: (to: string) => void = () => {};
function NavigateElsewhere() {
  const navigate = useNavigate();
  navigateFromOutside = navigate;
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
            <input aria-label="outside input" />
            <NavigateElsewhere />
            <ActiveOverlay />
          </RoutedOverlayProvider>
        </SectionNavProvider>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

// jsdom applies the stylesheet but not its media queries, so the menu button
// counts as hidden there (no accessible name); find it by its label instead.
const menuButton = () => screen.getByLabelText('Toggle mobile menu');
const menuList = () => document.getElementById('navMenu')!;
const isOpen = () => /(^|\s|_)active(_|\s|$)/.test(menuList().className);

describe('Header mobile menu', () => {
  it('uses plain navigation semantics and reports its state', async () => {
    const user = userEvent.setup();
    renderHeader();

    expect(screen.queryByRole('menubar')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
    expect(menuButton()).toHaveAttribute('aria-controls', 'navMenu');
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false');

    await user.click(menuButton());
    expect(menuButton()).toHaveAttribute('aria-expanded', 'true');
    expect(isOpen()).toBe(true);
  });

  it('closes after a section link is followed', async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(menuButton());

    await user.click(screen.getByText('--about'));

    expect(isOpen()).toBe(false);
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes after a page link is followed', async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(menuButton());

    await user.click(screen.getByText('--courses'));

    expect(screen.getByTestId('location')).toHaveTextContent('/courses');
    expect(isOpen()).toBe(false);
  });

  it('closes when the route changes from outside the menu, and opens again with one click', async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(menuButton());

    // Focus stays on the menu button: neither a click outside nor Tab closes it.
    act(() => navigateFromOutside('/privacy'));

    expect(screen.getByTestId('location')).toHaveTextContent('/privacy');
    expect(isOpen()).toBe(false);
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false');

    await user.click(menuButton());
    expect(isOpen()).toBe(true);
  });

  it('closes on Escape and returns focus to the menu button', async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(menuButton());

    await user.keyboard('{Escape}');

    expect(isOpen()).toBe(false);
    expect(menuButton()).toHaveFocus();
  });

  it('leaves focus alone on Escape when another overlay holds it', async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(menuButton());
    const input = screen.getByLabelText('outside input');
    input.focus();

    await user.keyboard('{Escape}');

    expect(isOpen()).toBe(false);
    expect(input).toHaveFocus();
  });

  it('closes when Tab moves focus past its last link', async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(menuButton());
    const links = menuList().querySelectorAll('a');
    links[links.length - 1].focus();

    await user.tab();

    expect(screen.getByLabelText('outside input')).toHaveFocus();
    expect(isOpen()).toBe(false);
  });

  it('stays open while Tab moves between its own links', async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(menuButton());

    await user.tab();

    expect(menuList()).toContainElement(document.activeElement as HTMLElement);
    expect(isOpen()).toBe(true);
  });

  it('closes on a click outside the menu', async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(menuButton());

    await user.click(screen.getByText('outside'));

    expect(isOpen()).toBe(false);
  });
});

describe('Header section links', () => {
  it('point at in-page anchors on the home page', () => {
    renderHeader('/');
    expect(screen.getByText('--about')).toHaveAttribute('href', '#about');
  });

  it('list every section once, in page order, as site.ts does', () => {
    renderHeader('/');
    const anchors = [...menuList().querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute('href'));
    // An optional section (posts) only while it is on the page; there is no page here.
    expect(anchors).toEqual(SECTIONS.filter(({ optional }) => !optional).map(({ id }) => `#${id}`));
  });

  it('lead back to the home page section from another page', async () => {
    const user = userEvent.setup();
    renderHeader('/courses');

    expect(screen.getByText('--skills')).toHaveAttribute('href', '/#skills');
    await user.click(screen.getByText('--skills'));

    expect(screen.getByTestId('location')).toHaveTextContent('/#skills');
  });
});

describe('Header theme toggle', () => {
  it('names the theme it switches to, and updates after a toggle', async () => {
    localStorage.clear();
    const user = userEvent.setup();
    renderHeader();

    const toggle = screen.getByRole('button', { name: 'Switch to light theme' });
    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBe(toggle);
    localStorage.clear();
  });
});

describe('Header overlay buttons', () => {
  it('the search button opens the command palette, and says how to open it from the keyboard', async () => {
    const user = userEvent.setup();
    renderHeader();

    const button = screen.getByRole('button', { name: 'Open command palette' });
    expect(button).toHaveAttribute('aria-keyshortcuts', 'Control+K Meta+K');
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    await user.click(button);

    expect(screen.getByTestId('overlay')).toHaveTextContent('palette');
  });

  it('the help button opens the help panel', async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.click(screen.getByLabelText('Show help panel'));

    expect(screen.getByTestId('overlay')).toHaveTextContent('help');
  });

  it('opening the palette from the open menu closes the menu', async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(menuButton());
    expect(screen.getByTestId('overlay')).toHaveTextContent('menu');

    await user.click(screen.getByRole('button', { name: 'Open command palette' }));

    expect(screen.getByTestId('overlay')).toHaveTextContent('palette');
    expect(isOpen()).toBe(false);
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false');
  });
});
