import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from './context/ThemeContext';
import App from './App';

function renderAppAt(path: string) {
  window.history.pushState({}, '', path);
  return render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
}

describe('App routing', () => {
  beforeEach(() => {
    // Skip the animated LoadingScreen so routes render immediately.
    sessionStorage.setItem('appLoaded', 'true');
  });

  it.each(['/', '/courses', '/community', '/dashboard'])(
    'renders %s without crashing',
    (path) => {
      const { container } = renderAppAt(path);
      expect(container.querySelector('main')).not.toBeNull();
    },
  );

  it('shows portfolio content on the home route', () => {
    renderAppAt('/');
    expect(screen.getAllByText(/yuriodev/i).length).toBeGreaterThan(0);
  });

  it('shows "coming soon" placeholder content on /courses', () => {
    renderAppAt('/courses');
    expect(screen.getByText('Courses')).toBeInTheDocument();
  });

  it('shows "coming soon" placeholder content on /community', () => {
    renderAppAt('/community');
    expect(screen.getByText('Community')).toBeInTheDocument();
  });

  it('shows "coming soon" placeholder content on /dashboard', () => {
    renderAppAt('/dashboard');
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });
});
