import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from './ThemeContext';
import { useTheme } from './useTheme';
import { resetStorageFallback } from '../utils/safeStorage';

// The pre-paint script, as shipped from public/.
const themeInitSource = Object.values(
  import.meta.glob('/public/theme-init.js', { query: '?raw', import: 'default', eager: true }),
)[0] as string;

function ThemeProbe() {
  const { theme, toggleTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme-value">{theme}</span>
      <button onClick={toggleTheme}>toggle</button>
    </div>
  );
}

function renderProbe() {
  return render(
    <ThemeProvider>
      <ThemeProbe />
    </ThemeProvider>,
  );
}

const themeValue = () => screen.getByTestId('theme-value').textContent;

/** A matchMedia whose prefers-color-scheme answer the test can change. */
function mockColorScheme(initiallyLight: boolean) {
  let light = initiallyLight;
  const listeners = new Set<() => void>();
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query.includes('prefers-color-scheme: light') ? light : false;
    },
    media: query,
    onchange: null,
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
    addListener: (cb: () => void) => listeners.add(cb),
    removeListener: (cb: () => void) => listeners.delete(cb),
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia;
  return {
    setLight(next: boolean) {
      light = next;
      act(() => listeners.forEach((cb) => cb()));
    },
    restore() {
      window.matchMedia = original;
    },
  };
}

function addThemeColorMetas() {
  for (const media of ['(prefers-color-scheme: dark)', '(prefers-color-scheme: light)']) {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.media = media;
    meta.content = 'unset';
    document.head.appendChild(meta);
  }
}
const themeColors = () =>
  [...document.head.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute('content'));

describe('ThemeContext / useTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStorageFallback();
    document.documentElement.removeAttribute('data-theme');
    document.head.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to dark when nothing is stored and the system prefers dark', () => {
    renderProbe();
    expect(themeValue()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    // Following the system is not a choice: nothing is written.
    expect(localStorage.getItem('theme')).toBeNull();
  });

  it('flips the theme each time toggleTheme is called', async () => {
    const user = userEvent.setup();
    renderProbe();

    expect(themeValue()).toBe('dark');

    await user.click(screen.getByText('toggle'));
    expect(themeValue()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('theme')).toBe('light');

    await user.click(screen.getByText('toggle'));
    expect(themeValue()).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  it('uses a saved choice and ignores an invalid stored value', () => {
    localStorage.setItem('theme', 'light');
    const { unmount } = renderProbe();
    expect(themeValue()).toBe('light');
    unmount();

    localStorage.setItem('theme', 'purple');
    renderProbe();
    expect(themeValue()).toBe('dark');
  });

  it('follows OS changes until the visitor chooses a theme explicitly', async () => {
    const scheme = mockColorScheme(false);
    try {
      const user = userEvent.setup();
      renderProbe();
      expect(themeValue()).toBe('dark');

      scheme.setLight(true);
      expect(themeValue()).toBe('light');
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');

      scheme.setLight(false);
      expect(themeValue()).toBe('dark');

      // An explicit choice wins over the OS from now on.
      await user.click(screen.getByText('toggle'));
      expect(themeValue()).toBe('light');
      scheme.setLight(false);
      expect(themeValue()).toBe('light');
    } finally {
      scheme.restore();
    }
  });

  it('keeps the browser theme-color in step with the theme', async () => {
    addThemeColorMetas();
    const user = userEvent.setup();
    renderProbe();
    expect(themeColors()).toEqual(['#0a0f1c', '#0a0f1c']);

    await user.click(screen.getByText('toggle'));
    expect(themeColors()).toEqual(['#f8fafc', '#f8fafc']);
  });

  it('still renders and toggles when site data is blocked', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const user = userEvent.setup();
    renderProbe();
    expect(themeValue()).toBe('dark');

    await user.click(screen.getByText('toggle'));
    expect(themeValue()).toBe('light');
  });

  it('throws when useTheme is called outside a ThemeProvider', () => {
    function Bare() {
      useTheme();
      return null;
    }
    // React logs the thrown error to console.error; silence it for this
    // expected-failure assertion only.
    const silenced = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<Bare />)).toThrow('useTheme must be used within a ThemeProvider');
    } finally {
      silenced.mockRestore();
    }
  });
});

describe('public/theme-init.js (pre-paint theme)', () => {
  const runInit = () => new Function(themeInitSource)();

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.head.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies the saved choice and sets theme-color to match', () => {
    addThemeColorMetas();
    localStorage.setItem('theme', 'light');
    runInit();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(themeColors()).toEqual(['#f8fafc', '#f8fafc']);
  });

  it('falls back to the system preference without a valid saved choice', () => {
    const scheme = mockColorScheme(true);
    try {
      runInit();
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');

      localStorage.setItem('theme', 'purple');
      scheme.setLight(false);
      runInit();
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    } finally {
      scheme.restore();
    }
  });

  it('never throws when site data is blocked', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(runInit).not.toThrow();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
