import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../../context/ThemeContext';
import { SECTIONS } from '../../data/site';
import { minWidth } from '../../constants/breakpoints';
import PageLayout from './PageLayout/PageLayout';

// A matchMedia whose sidebar query the test controls; every other query is false.
const SIDEBAR_QUERY = minWidth('sidebar');
let wide = false;
const listeners = new Set<() => void>();

function setWide(value: boolean) {
  wide = value;
  act(() => listeners.forEach((listener) => listener()));
}

const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  wide = false;
  listeners.clear();
  window.matchMedia = vi.fn((query: string) => ({
    get matches() {
      return query === SIDEBAR_QUERY && wide;
    },
    media: query,
    onchange: null,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

function renderPage(path = '/') {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <PageLayout currentPath={path}>
          {path === '/' && SECTIONS.map(({ id }) => <section key={id} id={id}><h2>{id}</h2></section>)}
        </PageLayout>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

const sidebar = () => screen.queryByRole('navigation', { name: 'Section navigation', hidden: true });
const menuButton = () => screen.queryByLabelText('Toggle mobile menu');
const headerSectionLinks = () =>
  document.querySelectorAll('header a[href^="#"], header a[href^="/#"]');
/** Every link to a section, whichever surface holds it. */
const linksTo = (id: string) => document.querySelectorAll(`a[href="#${id}"], a[href="/#${id}"]`);

describe('section navigation surfaces', () => {
  it('below 88rem: the header menu lists the sections and there is no sidebar', () => {
    renderPage();
    expect(sidebar()).toBeNull();
    expect(menuButton()).not.toBeNull();
    expect(headerSectionLinks()).toHaveLength(SECTIONS.length);
    for (const { id } of SECTIONS) expect(linksTo(id)).toHaveLength(1);
  });

  it('from 88rem: the sidebar lists the sections and the header has no menu', () => {
    wide = true;
    renderPage();
    expect(sidebar()).not.toBeNull();
    expect(menuButton()).toBeNull();
    expect(headerSectionLinks()).toHaveLength(0);
    for (const { id } of SECTIONS) expect(linksTo(id)).toHaveLength(1);
    // The page links stay in the header.
    expect(screen.getByRole('link', { name: '--courses', hidden: true }).closest('header')).not.toBeNull();
  });

  it('switches surfaces live as the window crosses 88rem', () => {
    renderPage();
    setWide(true);
    expect(sidebar()).not.toBeNull();
    expect(menuButton()).toBeNull();
    setWide(false);
    expect(sidebar()).toBeNull();
    expect(menuButton()).not.toBeNull();
  });

  it('keeps focus in the header when the focused menu link unmounts at 88rem', () => {
    renderPage();
    const about = document.querySelector<HTMLElement>('header a[href="#about"]')!;
    act(() => about.focus());
    setWide(true);
    expect(about.isConnected).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('link', { name: '--portfolio', hidden: true }));
  });

  it('both surfaces use the same order', () => {
    const order = SECTIONS.map(({ id }) => `#${id}`);
    renderPage();
    expect([...headerSectionLinks()].map((a) => a.getAttribute('href'))).toEqual(order);
    setWide(true);
    expect([...sidebar()!.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(order);
  });

  it('off the home page the sidebar links back to the home page sections', () => {
    wide = true;
    renderPage('/privacy');
    const hrefs = [...sidebar()!.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(SECTIONS.map(({ id }) => `/#${id}`));
  });
});
