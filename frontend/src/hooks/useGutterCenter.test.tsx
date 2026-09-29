import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { useRef } from 'react';
import { useGutterCenter } from './useGutterCenter';

/*
 * Regression coverage for the stale-gutter bug: SectionRail only renders its
 * <nav>/probe once `wide` is true, but useGutterCenter's setup effect used to
 * depend on the `railRef` object (a useRef, whose identity never changes), so
 * if the component's first render happened while `wide` was false - refs
 * still null - the effect's guard exited and neither the ResizeObserver nor
 * the window 'resize' listener was ever attached, for the component's whole
 * lifetime. `left` then stayed stuck at its useState(16) default even after
 * `wide` became true and the nodes actually mounted.
 *
 * jsdom lays nothing out, so getBoundingClientRect is stubbed by hand (the
 * probe standing in for the content-column probe, the rail for the nav) -
 * the same technique CanvasBackground.test.tsx uses for clientWidth/Height.
 */

const originalInnerWidth = window.innerWidth;

function setInnerWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
}

function stubRects() {
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const testId = this.getAttribute('data-testid');
    const width = testId === 'probe' ? 800 : testId === 'rail' ? 200 : 0;
    return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON() {} } as DOMRect;
  });
}

function Harness({ wide }: { wide: boolean }) {
  const railRef = useRef<HTMLElement>(null);
  const { probeRef, left } = useGutterCenter(railRef, wide);
  return (
    <div>
      <div data-testid="left">{left}</div>
      {wide && (
        <>
          <div ref={probeRef} data-testid="probe" />
          <nav ref={railRef} data-testid="rail" />
        </>
      )}
    </div>
  );
}

describe('useGutterCenter', () => {
  beforeEach(() => {
    setInnerWidth(1600);
    stubRects();
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
    vi.restoreAllMocks();
  });

  it('mounted from the very first render, centres the rail in the gutter', () => {
    // gutter = (1600 - 800) / 2 = 400; left = max(16, (400 - 200) / 2) = 100.
    const { getByTestId } = render(<Harness wide={true} />);
    expect(getByTestId('left').textContent).toBe('100');
  });

  it('recomputes left once the rail and probe mount, even when the first render happened narrower than the sidebar breakpoint', () => {
    const { rerender, getByTestId } = render(<Harness wide={false} />);
    expect(getByTestId('left').textContent).toBe('16');

    rerender(<Harness wide={true} />);
    expect(getByTestId('left').textContent).toBe('100');
  });

  it('still recomputes on a later width change once mounted this way', () => {
    const { rerender, getByTestId } = render(<Harness wide={false} />);
    rerender(<Harness wide={true} />);
    expect(getByTestId('left').textContent).toBe('100');

    // A wider window: gutter = (2000 - 800) / 2 = 600; left = max(16, (600-200)/2) = 200.
    setInnerWidth(2000);
    act(() => window.dispatchEvent(new Event('resize')));
    expect(getByTestId('left').textContent).toBe('200');
  });
});
