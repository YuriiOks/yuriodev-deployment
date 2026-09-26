import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import ScrollToTop from './ScrollToTop';

type Callback = (entries: Array<Pick<IntersectionObserverEntry, 'isIntersecting'>>) => void;

const OriginalObserver = window.IntersectionObserver;
let observed: { callback: Callback; target: Element | null } = { callback: () => {}, target: null };

class CapturingObserver {
  constructor(callback: Callback) {
    observed.callback = callback;
  }
  observe(target: Element) {
    observed.target = target;
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

function renderWithFooter(props: { suppressed?: boolean } = {}) {
  return render(
    <>
      <ScrollToTop {...props} />
      <footer>footer text</footer>
    </>,
  );
}

function scrollTo(y: number) {
  act(() => {
    Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
    window.dispatchEvent(new Event('scroll'));
  });
}

// While hidden (visibility: hidden) it has no accessible name, so find it by its label.
const button = () => screen.getByLabelText('Scroll to top');
const shown = () => button().getAttribute('data-hidden') !== 'true';

/** Whether the button's next focus counts as keyboard focus (:focus-visible). */
function focusVisible(visible: boolean) {
  const element = button();
  const matches = element.matches.bind(element);
  vi.spyOn(element, 'matches').mockImplementation((selector) =>
    selector === ':focus-visible' ? visible : matches(selector),
  );
}

describe('ScrollToTop', () => {
  afterEach(() => {
    window.IntersectionObserver = OriginalObserver;
    observed = { callback: () => {}, target: null };
    scrollTo(0);
    vi.restoreAllMocks();
  });

  it('appears once the page is scrolled and hides while the footer is on screen', () => {
    window.IntersectionObserver = CapturingObserver as unknown as typeof IntersectionObserver;
    renderWithFooter();
    expect(observed.target?.tagName).toBe('FOOTER');
    expect(shown()).toBe(false);

    scrollTo(500);
    expect(shown()).toBe(true);

    act(() => observed.callback([{ isIntersecting: true }]));
    expect(shown()).toBe(false);

    act(() => observed.callback([{ isIntersecting: false }]));
    expect(shown()).toBe(true);
  });

  it('stays on screen while it has keyboard focus, so focus is never dropped', () => {
    window.IntersectionObserver = CapturingObserver as unknown as typeof IntersectionObserver;
    renderWithFooter();
    scrollTo(500);
    focusVisible(true);
    fireEvent.focus(button());

    act(() => observed.callback([{ isIntersecting: true }]));
    expect(shown()).toBe(true);

    fireEvent.blur(button());
    expect(shown()).toBe(false);
  });

  it('does not stay on screen after a mouse click focuses it', () => {
    window.IntersectionObserver = CapturingObserver as unknown as typeof IntersectionObserver;
    renderWithFooter();
    scrollTo(500);
    focusVisible(false);
    fireEvent.focus(button());

    scrollTo(0);
    expect(shown()).toBe(false);
  });

  it('stays hidden while an overlay is open', () => {
    window.IntersectionObserver = CapturingObserver as unknown as typeof IntersectionObserver;
    renderWithFooter({ suppressed: true });
    scrollTo(500);
    expect(shown()).toBe(false);
  });
});
