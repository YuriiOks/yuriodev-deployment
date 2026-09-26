import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useRef } from 'react';
import { SectionNavProvider } from '../../../context/SectionNavProvider';
import { minWidth } from '../../../constants/breakpoints';
import { SECTIONS } from '../../../data/site';
import SectionRail from './SectionRail';

/** The section tracker's own IntersectionObserver (rootMargin set), driven by the test. */
interface Driven {
  callback: IntersectionObserverCallback;
  options?: IntersectionObserverInit;
  targets: Element[];
}
let observers: Driven[] = [];

class DrivenObserver {
  private driven: Driven;
  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.driven = { callback, options, targets: [] };
    observers.push(this.driven);
  }
  observe(target: Element) {
    this.driven.targets.push(target);
  }
  unobserve(target: Element) {
    this.driven.targets = this.driven.targets.filter((t) => t !== target);
  }
  disconnect() {
    this.driven.targets = [];
    observers = observers.filter((o) => o !== this.driven);
  }
  takeRecords() {
    return [];
  }
}

function report(target: Element, isIntersecting: boolean) {
  const [observer] = observers;
  if (!observer) throw new Error('no section-tracking observer');
  act(() =>
    observer.callback(
      [{ target, isIntersecting } as unknown as IntersectionObserverEntry],
      observer as unknown as IntersectionObserver,
    ),
  );
}

let wide = true;
const originalMatchMedia = window.matchMedia;
const originalObserver = window.IntersectionObserver;

beforeEach(() => {
  wide = true;
  observers = [];
  window.IntersectionObserver = DrivenObserver as unknown as typeof IntersectionObserver;
  window.matchMedia = vi.fn((query: string) => ({
    get matches() {
      return query === minWidth('sidebar') && wide;
    },
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  window.IntersectionObserver = originalObserver;
});

function Page({ withSections }: { withSections: boolean }) {
  const mainRef = useRef<HTMLElement>(null);
  return (
    <SectionNavProvider mainRef={mainRef}>
      <SectionRail />
      <main ref={mainRef}>
        {withSections &&
          SECTIONS.filter(({ optional }) => !optional).map(({ id }) => (
            <section key={id} id={id}>
              <h2>{id}</h2>
            </section>
          ))}
      </main>
    </SectionNavProvider>
  );
}

function renderRail(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Page withSections={path === '/'} />
    </MemoryRouter>,
  );
}

const rail = () => screen.queryByRole('navigation', { name: 'Section navigation', hidden: true });
const section = (id: string) => document.getElementById(id)!;

describe('SectionRail', () => {
  it('is not rendered below 88rem', () => {
    wide = false;
    renderRail();
    expect(rail()).toBeNull();
  });

  it('lists every section as a link with a name, in page order', () => {
    renderRail();
    const links = within(rail()!).getAllByRole('link', { hidden: true });
    const listed = SECTIONS.filter(({ optional }) => !optional);
    expect(links.map((a) => a.getAttribute('href'))).toEqual(listed.map(({ id }) => `#${id}`));
    expect(links.map((a) => a.getAttribute('aria-label'))).toEqual(
      listed.map(({ label }) => `Go to ${label.toLowerCase()} section`),
    );
    expect(within(rail()!).getByRole('list', { hidden: true })).toBeInTheDocument();
  });

  it('is visible on the hero from the very first paint, labels included', () => {
    // No report(...) call here: this is the state a real first paint would
    // show, before any observer has reported. Unlike the old hero-hiding
    // rail, there is no scroll-driven state to wait for.
    renderRail();
    expect(rail()).toHaveStyle({ opacity: '1' });
    for (const link of within(rail()!).getAllByRole('link', { hidden: true })) {
      const label = link.querySelector('span:last-child')!;
      expect(label).toHaveStyle({ opacity: '1' });
      expect(getComputedStyle(label).display).not.toBe('none');
    }
  });

  it('is shown at once on another page, where there is no hero', () => {
    renderRail('/privacy');
    expect(rail()).toHaveStyle({ opacity: '1' });
    expect(within(rail()!).getAllByRole('link', { hidden: true })[1]).toHaveAttribute('href', '/#about');
  });

  it('marks the section in view and fills the track down to it', () => {
    renderRail();
    report(section('skills'), true);

    const current = within(rail()!).getByRole('link', { name: 'Go to skills section', hidden: true });
    expect(current).toHaveAttribute('aria-current', 'location');
    expect(within(rail()!).getAllByRole('link', { hidden: true }).filter((a) => a.hasAttribute('aria-current'))).toHaveLength(1);

    const listed = SECTIONS.filter(({ optional }) => !optional);
    const index = listed.findIndex(({ id }) => id === 'skills');
    expect(rail()!.style.getPropertyValue('--rail-progress')).toBe(String(index / (listed.length - 1)));

    report(section('connect'), true);
    expect(rail()!.style.getPropertyValue('--rail-progress')).toBe('1');
  });
});
