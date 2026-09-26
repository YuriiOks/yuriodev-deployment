import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useRef } from 'react';
import { SectionNavProvider } from '../../../context/SectionNavProvider';
import { minWidth } from '../../../constants/breakpoints';
import { SECTIONS } from '../../../data/site';
import SectionRail from './SectionRail';

/*
 * An IntersectionObserver the test drives: each instance is kept with its
 * callback and options, so a test can report entries for the observer it
 * means (the section tracker's, with a rootMargin, or the rail's hero
 * observer, with thresholds).
 */
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

function report(which: 'hero' | 'sections', target: Element, isIntersecting: boolean, intersectionRatio = isIntersecting ? 1 : 0) {
  const observer = observers.find((o) =>
    which === 'hero' ? Array.isArray(o.options?.threshold) : o.options?.rootMargin !== undefined,
  );
  if (!observer) throw new Error(`no ${which} observer`);
  act(() =>
    observer.callback(
      [{ target, isIntersecting, intersectionRatio } as unknown as IntersectionObserverEntry],
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

  it('stays away while most of the hero is on screen, and comes in once it is not', () => {
    renderRail();
    expect(rail()).toHaveAttribute('data-state', 'away');

    report('hero', section('hero'), true, 0.39);
    expect(rail()).toHaveAttribute('data-state', 'shown');

    report('hero', section('hero'), true, 0.6);
    expect(rail()).toHaveAttribute('data-state', 'away');

    report('hero', section('hero'), false);
    expect(rail()).toHaveAttribute('data-state', 'shown');
  });

  it('keeps its links in the Tab order while away (focusing one brings it back, in CSS)', () => {
    renderRail();
    expect(rail()).toHaveAttribute('data-state', 'away');
    for (const link of within(rail()!).getAllByRole('link', { hidden: true })) {
      expect(link).not.toHaveAttribute('tabindex', '-1');
      expect(link.closest('[hidden], [inert], [aria-hidden="true"]')).toBeNull();
    }
  });

  it('is shown at once on another page, where there is no hero', () => {
    renderRail('/privacy');
    expect(rail()).toHaveAttribute('data-state', 'shown');
    expect(within(rail()!).getAllByRole('link', { hidden: true })[1]).toHaveAttribute('href', '/#about');
  });

  it('marks the section in view and fills the track down to it', () => {
    renderRail();
    report('sections', section('skills'), true);

    const current = within(rail()!).getByRole('link', { name: 'Go to skills section', hidden: true });
    expect(current).toHaveAttribute('aria-current', 'location');
    expect(within(rail()!).getAllByRole('link', { hidden: true }).filter((a) => a.hasAttribute('aria-current'))).toHaveLength(1);

    const listed = SECTIONS.filter(({ optional }) => !optional);
    const index = listed.findIndex(({ id }) => id === 'skills');
    expect(rail()!.style.getPropertyValue('--rail-progress')).toBe(String(index / (listed.length - 1)));

    report('sections', section('connect'), true);
    expect(rail()!.style.getPropertyValue('--rail-progress')).toBe('1');
  });

  it('stops watching the hero when it unmounts', () => {
    const { unmount } = renderRail();
    expect(observers.some((o) => Array.isArray(o.options?.threshold))).toBe(true);
    unmount();
    expect(observers).toEqual([]);
  });
});
