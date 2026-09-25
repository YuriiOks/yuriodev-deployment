import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Link } from 'react-router-dom';
import { useRouteChangeFocus } from './useRouteChangeFocus';

function Harness() {
  const ref = useRef<HTMLElement>(null);
  useRouteChangeFocus(ref);
  return (
    <>
      <nav>
        <Link to="/other">other page</Link>
        <Link to="/#section">same page, new hash</Link>
        <Link to="/other#section">other page with hash</Link>
      </nav>
      <main ref={ref} tabIndex={-1}>content</main>
    </>
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Harness />
    </MemoryRouter>,
  );
}

describe('useRouteChangeFocus', () => {
  beforeEach(() => {
    vi.mocked(window.scrollTo).mockClear();
  });

  it('does nothing on the first render', () => {
    renderAt('/');
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
  });

  it('scrolls to the top and focuses main when the path changes', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await user.click(screen.getByText('other page'));
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' });
    expect(document.activeElement).toBe(screen.getByRole('main'));
  });

  it('ignores a hash-only change', async () => {
    const user = userEvent.setup();
    renderAt('/');
    const link = screen.getByText('same page, new hash');
    await user.click(link);
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(link);
  });

  it('moves focus but leaves scrolling to the hash when the new URL has one', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await user.click(screen.getByText('other page with hash'));
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('main'));
  });
});
