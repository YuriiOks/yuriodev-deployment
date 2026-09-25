import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { SectionNavProvider } from './SectionNavProvider';
import { useSectionNav } from './useSectionNav';

/** An IntersectionObserver the test can drive, recording every instance. */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly observed = new Set<Element>();
  readonly callback: IntersectionObserverCallback;
  readonly options?: IntersectionObserverInit;
  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.options = options;
    FakeIntersectionObserver.instances.push(this);
  }
  observe = (el: Element) => void this.observed.add(el);
  unobserve = (el: Element) => void this.observed.delete(el);
  disconnect = () => this.observed.clear();
  takeRecords = () => [];
  /** Reports `id`'s section as crossing the middle of the viewport. */
  enter(id: string) {
    const target = [...this.observed].find((el) => el.id === id)!;
    act(() => {
      this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    });
  }
}

function Probe() {
  const nav = useSectionNav();
  const navigate = useNavigate();
  const { pathname, hash } = useLocation();
  return (
    <div>
      <output data-testid="state">
        {JSON.stringify({ present: nav.present, active: nav.activeId, onHome: nav.onHome })}
      </output>
      <output data-testid="location">{pathname + hash}</output>
      <button onClick={() => navigate('/courses')}>to courses</button>
      <button onClick={() => navigate('/')}>to home</button>
      <button onClick={() => nav.step(1)}>next</button>
      <button onClick={() => nav.step(-1)}>previous</button>
      <button onClick={() => nav.goTo('skills')}>go skills</button>
    </div>
  );
}

function Harness() {
  const mainRef = useRef<HTMLElement>(null);
  return (
    <SectionNavProvider mainRef={mainRef}>
      <Probe />
      <main ref={mainRef}>
        <Routes>
          <Route
            path="/"
            element={
              <>
                <section id="hero">hero</section>
                <section id="about">about</section>
                <section id="not-a-section">other</section>
                <section id="skills">skills</section>
              </>
            }
          />
          <Route path="/courses" element={<section id="courses">courses</section>} />
        </Routes>
      </main>
    </SectionNavProvider>
  );
}

const state = () => JSON.parse(screen.getByTestId('state').textContent!);
const scrolledTo = () =>
  (vi.mocked(Element.prototype.scrollIntoView).mock.contexts as Element[]).map((el) => el.id);

function renderAt(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Harness />
    </MemoryRouter>,
  );
}

describe('SectionNavProvider', () => {
  beforeEach(() => {
    FakeIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    vi.mocked(Element.prototype.scrollIntoView).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists the known sections mounted in <main>, in DOM order', () => {
    renderAt('/');
    expect(state()).toEqual({ present: ['hero', 'about', 'skills'], active: null, onHome: true });
  });

  it('watches with one IntersectionObserver on the viewport middle line and follows it', () => {
    renderAt('/');
    expect(FakeIntersectionObserver.instances).toHaveLength(1);
    const [observer] = FakeIntersectionObserver.instances;
    expect(observer.options?.rootMargin).toBe('-50% 0px -50% 0px');
    expect([...observer.observed].map((el) => el.id)).toEqual(['hero', 'about', 'skills']);

    observer.enter('about');
    expect(state().active).toBe('about');
  });

  it('never observes a stale section after a route change and back', async () => {
    const user = userEvent.setup();
    renderAt('/');
    const [observer] = FakeIntersectionObserver.instances;
    observer.enter('about');

    await user.click(screen.getByText('to courses'));
    expect(state()).toEqual({ present: [], active: null, onHome: false });
    expect(observer.observed.size).toBe(0);

    await user.click(screen.getByText('to home'));
    expect(FakeIntersectionObserver.instances).toHaveLength(1);
    const observed = [...observer.observed];
    expect(observed.map((el) => el.id)).toEqual(['hero', 'about', 'skills']);
    for (const el of observed) {
      expect(el.isConnected).toBe(true);
      expect(document.getElementById(el.id)).toBe(el);
    }
    // The section active before leaving is forgotten; the observer reports afresh.
    expect(state().active).toBeNull();
    observer.enter('skills');
    expect(state().active).toBe('skills');
  });

  it('J/K step from the active section and stop at either end', async () => {
    const user = userEvent.setup();
    renderAt('/');
    const [observer] = FakeIntersectionObserver.instances;

    observer.enter('about');
    await user.click(screen.getByText('next'));
    observer.enter('skills');
    await user.click(screen.getByText('next'));
    await user.click(screen.getByText('previous'));
    expect(scrolledTo()).toEqual(['skills', 'skills', 'about']);
  });

  it('goTo scrolls on the home page and opens the home page at the section elsewhere', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await user.click(screen.getByText('go skills'));
    expect(scrolledTo()).toEqual(['skills']);
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);

    await user.click(screen.getByText('to courses'));
    await user.click(screen.getByText('go skills'));
    expect(screen.getByTestId('location')).toHaveTextContent('/#skills');
  });
});
