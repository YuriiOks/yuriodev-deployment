import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ErrorBoundary from './ErrorBoundary';

function Thrower({ fail }: { fail: boolean }) {
  if (fail) throw new Error('boom');
  return <p>content</p>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // React reports caught render errors through console.error; keep the
    // output clean for these expected failures.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders its children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <Thrower fail={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('content')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a friendly fallback with a reload link instead of a blank page', async () => {
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload, href: 'http://localhost/' });
    const user = userEvent.setup();

    render(
      <ErrorBoundary>
        <Thrower fail />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Something went wrong' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the home page' })).toHaveAttribute('href', '/');

    await user.click(screen.getByRole('link', { name: 'Reload the page' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('clears the fallback when the reset key changes (a new route)', () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="/broken">
        <Thrower fail />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();

    rerender(
      <ErrorBoundary resetKey="/fine">
        <Thrower fail={false} />
      </ErrorBoundary>,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('content')).toBeInTheDocument();
  });
});
