import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ThemeProvider } from '../../../context/ThemeContext';
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

function renderHeader(path = '/') {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="*" element={<HeaderAtLocation />} />
        </Routes>
        <p>outside</p>
        <input aria-label="outside input" />
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

  it('closes on a click outside the menu', async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(menuButton());

    await user.click(screen.getByText('outside'));

    expect(isOpen()).toBe(false);
  });
});

describe('Header section links', () => {
  it('point at in-page anchors on the home page, including an existing #terminal', () => {
    renderHeader('/');
    expect(screen.getByText('--about')).toHaveAttribute('href', '#about');
    expect(screen.getByText('--terminal')).toHaveAttribute('href', '#terminal');
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
