import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from './context/ThemeContext';
import App from './App';
import { resetStorageFallback } from './utils/safeStorage';

const originalMatchMedia = window.matchMedia;

function setReducedMotion(reduced: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('prefers-reduced-motion: reduce') ? reduced : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia;
}

function renderApp() {
  window.history.pushState({}, '', '/');
  return render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
}

const intro = () => screen.queryByRole('button', { name: /skip intro/i });

describe('first-visit loading screen', () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetStorageFallback();
    setReducedMotion(false);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.matchMedia = originalMatchMedia;
    sessionStorage.clear();
    resetStorageFallback();
  });

  it('shows over the already-rendered page and is gone within 1.2 seconds', () => {
    const { container } = renderApp();
    expect(intro()).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Initializing systems...');
    expect(container.querySelector('main#main-content')).not.toBeNull();
    expect(document.body.style.overflow).toBe('hidden');

    act(() => {
      vi.advanceTimersByTime(1199);
    });
    expect(intro()).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(intro()).not.toBeInTheDocument();
    expect(sessionStorage.getItem('appLoaded')).toBe('true');
    expect(document.body.style.overflow).toBe('');
  });

  it('ends at once from the visible Skip button', () => {
    renderApp();
    fireEvent.click(intro()!);
    expect(intro()).not.toBeInTheDocument();
    expect(sessionStorage.getItem('appLoaded')).toBe('true');
  });

  it('ends at once on Escape, and on any other key, so focus is never held', () => {
    const { unmount } = renderApp();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(intro()).not.toBeInTheDocument();
    unmount();

    sessionStorage.clear();
    renderApp();
    fireEvent.keyDown(window, { key: 'Shift' });
    expect(intro()).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(intro()).not.toBeInTheDocument();
  });

  it('is not shown again in the same session', () => {
    sessionStorage.setItem('appLoaded', 'true');
    renderApp();
    expect(intro()).not.toBeInTheDocument();
  });

  it('is skipped entirely under reduced motion', () => {
    setReducedMotion(true);
    renderApp();
    expect(intro()).not.toBeInTheDocument();
  });

  it('never blanks the site when session storage is blocked', () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const { container } = renderApp();
    expect(container.querySelector('main#main-content')).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(intro()).not.toBeInTheDocument();
  });
});
