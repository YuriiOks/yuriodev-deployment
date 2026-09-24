import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from './ThemeContext';
import { useTheme } from './useTheme';

function ThemeProbe() {
  const { theme, toggleTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme-value">{theme}</span>
      <button onClick={toggleTheme}>toggle</button>
    </div>
  );
}

describe('ThemeContext / useTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('defaults to dark when nothing is stored and the system prefers dark', () => {
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme-value').textContent).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('flips the theme each time toggleTheme is called', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('theme-value').textContent).toBe('dark');

    await user.click(screen.getByText('toggle'));
    expect(screen.getByTestId('theme-value').textContent).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('theme')).toBe('light');

    await user.click(screen.getByText('toggle'));
    expect(screen.getByTestId('theme-value').textContent).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  it('throws when useTheme is called outside a ThemeProvider', () => {
    function Bare() {
      useTheme();
      return null;
    }
    // React logs the thrown error to console.error; silence it for this
    // expected-failure assertion only.
    const original = console.error;
    console.error = () => {};
    try {
      expect(() => render(<Bare />)).toThrow('useTheme must be used within a ThemeProvider');
    } finally {
      console.error = original;
    }
  });
});
