import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from './context/ThemeContext';
import App from './App';
import { SECTIONS, TERMINAL_ANCHOR } from './data/site';

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

  it('every in-page link on the home page points at an element that exists', () => {
    const { container } = renderAppAt('/');
    const targets = [...container.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')]
      .map((a) => a.getAttribute('href')!.slice(1))
      .filter(Boolean);

    expect(targets).toEqual(expect.arrayContaining(SECTIONS.map(({ id }) => id)));
    // The palette's "Go to Terminal" target.
    expect(document.getElementById(TERMINAL_ANCHOR)).not.toBeNull();
    for (const id of targets) {
      expect(document.getElementById(id), `#${id}`).not.toBeNull();
    }
  });

  it('home page states 10+ years of experience and shows no phone number', async () => {
    const user = userEvent.setup();
    const { container } = renderAppAt('/');

    expect(container).toHaveTextContent('"10+ years in production AI"');

    // The About story is collapsed by default; open it so its text counts too.
    for (const button of screen.getAllByRole('button', { hidden: true })) {
      if (/story/i.test(button.textContent ?? '')) await user.click(button);
    }
    expect(container).toHaveTextContent('10+ years in the trenches');

    const text = container.textContent ?? '';
    expect(text).not.toMatch(/\b8\+ years/);
    expect(text).not.toMatch(/phone|\+44|\d{4} ?\d{6}/i);
    expect(container.querySelector('a[href^="tel:"]')).toBeNull();
  });

  it.each([
    ['/', 'Yurii Oksamytnyi — AI/ML Systems Engineer'],
    ['/privacy', 'Privacy | Yurii Oksamytnyi'],
    ['/courses', 'Courses | Yurii Oksamytnyi'],
    ['/community', 'Community | Yurii Oksamytnyi'],
    ['/dashboard', 'Dashboard | Yurii Oksamytnyi'],
    ['/does-not-exist', 'Page not found | Yurii Oksamytnyi'],
  ])('sets the document title on %s', (path, title) => {
    renderAppAt(path);
    expect(document.title).toBe(title);
  });

  it.each([
    ['/', 'https://yuriodev.co.uk/'],
    ['/privacy', 'https://yuriodev.co.uk/privacy'],
    ['/privacy/', 'https://yuriodev.co.uk/privacy'],
    ['/courses', 'https://yuriodev.co.uk/'],
    ['/does-not-exist', 'https://yuriodev.co.uk/'],
  ])('sets the canonical URL and og:url on %s', (path, url) => {
    renderAppAt(path);
    expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute('href', url);
    expect(document.head.querySelector('meta[property="og:url"]')).toHaveAttribute('content', url);
  });

  it('points the canonical URL back at the home page after leaving /privacy', async () => {
    const user = userEvent.setup();
    renderAppAt('/privacy');
    await user.click(screen.getByRole('link', { name: '--portfolio', hidden: true }));
    expect(window.location.pathname).toBe('/');
    expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute(
      'href',
      'https://yuriodev.co.uk/',
    );
  });

  it('renders a not-found page with a link home and a noindex tag for unknown paths', () => {
    renderAppAt('/does-not-exist');
    expect(screen.getByRole('heading', { level: 1, name: /page not found/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to the home page/i })).toHaveAttribute('href', '/');
    expect(screen.getByText(/cd: \/does-not-exist: No such file or directory/)).toBeInTheDocument();
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  });

  it('drops the noindex tag once the visitor leaves the not-found page', async () => {
    const user = userEvent.setup();
    renderAppAt('/does-not-exist');
    await user.click(screen.getByRole('link', { name: /back to the home page/i }));
    expect(window.location.pathname).toBe('/');
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
  });

  it('does not mark real pages noindex', () => {
    renderAppAt('/privacy');
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
  });

  it('renders the privacy notice on /privacy', () => {
    renderAppAt('/privacy');
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy notice' })).toBeInTheDocument();
    expect(screen.getByText(/25 September 2026/)).toHaveAttribute('dateTime', '2026-09-25');
    expect(screen.getByText(/sets no cookies of its own/)).toBeInTheDocument();
    expect(screen.getByText(/Fira Code, is served from this site itself/)).toBeInTheDocument();
    expect(screen.queryByText(/loaded from Google Fonts/)).not.toBeInTheDocument();
    expect(screen.getByText(/only if you pick one with the theme button/)).toBeInTheDocument();
  });

  it('starts the tab order with a skip link that moves focus to main', async () => {
    const user = userEvent.setup();
    const { container } = renderAppAt('/');

    await user.tab();
    const skip = screen.getByRole('link', { name: 'Skip to main content' });
    expect(document.activeElement).toBe(skip);
    expect(skip).toHaveAttribute('href', '#main-content');

    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(container.querySelector('main#main-content'));
  });

  it('has exactly one banner and one main landmark', () => {
    renderAppAt('/');
    expect(screen.getAllByRole('banner')).toHaveLength(1);
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('announces terminal output politely and keeps the typewriter quiet for screen readers', () => {
    const { container } = renderAppAt('/');
    const log = screen.getByRole('log', { name: 'Terminal output' });
    expect(log).toHaveAttribute('aria-live', 'polite');

    expect(container.querySelector('#typewriter')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(/Architecting agentic AI systems \(LangGraph, MCP\)\. Building production RAG/)).toHaveClass(
      'sr-only',
    );
  });

  it('keeps the closed help panel and palette out of the page (and the tab order)', () => {
    renderAppAt('/');
    expect(document.querySelector('dialog')).toBeNull();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('links the privacy notice from the footer, then starts the new page at the top with focus on main', async () => {
    const user = userEvent.setup();
    const { container } = renderAppAt('/');
    vi.mocked(window.scrollTo).mockClear();

    await user.click(screen.getByRole('link', { name: 'Privacy notice' }));

    expect(window.location.pathname).toBe('/privacy');
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' });
    expect(document.activeElement).toBe(container.querySelector('main'));
  });
});
