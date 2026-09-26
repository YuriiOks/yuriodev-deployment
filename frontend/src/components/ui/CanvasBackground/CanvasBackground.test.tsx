import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import CanvasBackground from './CanvasBackground';
import { MIN_NODES } from './field';

const originalMatchMedia = window.matchMedia;
const originalPixelRatio = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');

function setPixelRatio(ratio: number) {
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => ratio });
}

/**
 * The element's own box (jsdom lays nothing out, so clientWidth/clientHeight
 * are 0 by default): CanvasBackground sizes its backing store from the
 * canvas's own box, not window.innerWidth/innerHeight, so a scrollbar (which
 * shrinks the box without resizing the window) never squeezes it.
 */
function setElementSize(width: number, height: number) {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: height });
}

// A ResizeObserver whose observe/disconnect calls a test can assert on.
const originalResizeObserver = window.ResizeObserver;
const resizeObserverCalls = { observe: vi.fn(), disconnect: vi.fn() };
class TrackedResizeObserver {
  observe = resizeObserverCalls.observe;
  unobserve = vi.fn();
  disconnect = resizeObserverCalls.disconnect;
}

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

/** Listeners added to `target` minus those removed again, by event type. */
function trackListeners(target: EventTarget) {
  const live = new Map<string, Set<unknown>>();
  const add = target.addEventListener.bind(target);
  const remove = target.removeEventListener.bind(target);
  vi.spyOn(target, 'addEventListener').mockImplementation((type, listener, options) => {
    if (!live.has(type)) live.set(type, new Set());
    live.get(type)!.add(listener);
    add(type, listener, options);
  });
  vi.spyOn(target, 'removeEventListener').mockImplementation((type, listener, options) => {
    live.get(type)?.delete(listener);
    remove(type, listener, options);
  });
  return () => [...live.entries()].filter(([, set]) => set.size > 0).map(([type]) => type);
}

describe('CanvasBackground', () => {
  beforeEach(() => {
    vi.mocked(window.requestAnimationFrame).mockClear();
    vi.mocked(window.cancelAnimationFrame).mockClear();
    resizeObserverCalls.observe.mockClear();
    resizeObserverCalls.disconnect.mockClear();
    window.ResizeObserver = TrackedResizeObserver as unknown as typeof ResizeObserver;
  });
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    window.ResizeObserver = originalResizeObserver;
    if (originalPixelRatio) Object.defineProperty(window, 'devicePixelRatio', originalPixelRatio);
    // clientWidth/clientHeight are not own properties of HTMLElement.prototype
    // (only of Element.prototype, further up the chain) until setElementSize
    // adds them: delete our override rather than restore a descriptor that
    // never existed there.
    if (originalClientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
    else delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    if (originalClientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight);
    else delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
    vi.restoreAllMocks();
  });

  it('starts one animation loop and releases every listener, observer and frame on unmount', () => {
    setReducedMotion(false);
    const windowListeners = trackListeners(window);
    const documentListeners = trackListeners(document);
    const rootListeners = trackListeners(document.documentElement);

    const { unmount } = render(<CanvasBackground />);
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(windowListeners()).toEqual(expect.arrayContaining(['mousemove']));
    expect(documentListeners()).toContain('visibilitychange');
    expect(rootListeners()).toContain('mouseleave');
    // Refit on the canvas's own box resizing (a scrollbar, not just the
    // window), not a window 'resize' listener.
    expect(windowListeners()).not.toContain('resize');
    expect(resizeObserverCalls.observe).toHaveBeenCalledTimes(1);

    unmount();
    expect(window.cancelAnimationFrame).toHaveBeenCalled();
    expect(resizeObserverCalls.disconnect).toHaveBeenCalledTimes(1);
    const ours = ['mousemove', 'mouseleave', 'visibilitychange'];
    expect(windowListeners().filter((type) => ours.includes(type))).toEqual([]);
    expect(documentListeners().filter((type) => ours.includes(type))).toEqual([]);
    expect(rootListeners().filter((type) => ours.includes(type))).toEqual([]);
  });

  it('draws one static frame and starts no loop under reduced motion', () => {
    setReducedMotion(true);
    setElementSize(1024, 768);
    const ctx = (HTMLCanvasElement.prototype.getContext as unknown as () => CanvasRenderingContext2D)();
    vi.mocked(ctx.arc).mockClear();

    render(<CanvasBackground />);
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    expect(ctx.arc).toHaveBeenCalled();
  });

  it('draws at the screen resolution, capped at 1.5x, with fewer nodes on a small screen', () => {
    setReducedMotion(true);
    const ctx = (HTMLCanvasElement.prototype.getContext as unknown as () => CanvasRenderingContext2D)();
    vi.mocked(ctx.arc).mockClear();
    setElementSize(375, 812);
    setPixelRatio(3);

    const { container } = render(<CanvasBackground />);
    const canvas = container.querySelector('canvas')!;
    expect(canvas.width).toBe(Math.round(375 * 1.5));
    expect(canvas.height).toBe(Math.round(812 * 1.5));
    expect(ctx.setTransform).toHaveBeenLastCalledWith(1.5, 0, 0, 1.5, 0, 0);
    // One arc per node: the 18-node floor for a phone-sized viewport.
    expect(ctx.arc).toHaveBeenCalledTimes(MIN_NODES);
  });

  it('a 1x screen gets a 1x backing store', () => {
    setReducedMotion(true);
    setElementSize(1280, 800);
    setPixelRatio(1);

    const { container } = render(<CanvasBackground />);
    const canvas = container.querySelector('canvas')!;
    expect([canvas.width, canvas.height]).toEqual([1280, 800]);
  });

  it('stamps pre-rendered glow sprites instead of blurring every dot', () => {
    setReducedMotion(true);
    setElementSize(1024, 768);
    const ctx = (HTMLCanvasElement.prototype.getContext as unknown as () => CanvasRenderingContext2D)();
    vi.mocked(ctx.drawImage).mockClear();
    vi.mocked(ctx.createRadialGradient).mockClear();
    vi.mocked(ctx.arc).mockClear();
    ctx.shadowBlur = 0;

    render(<CanvasBackground />);
    // One sprite per tone, one stamp per node (and there are nodes to stamp).
    expect(ctx.createRadialGradient).toHaveBeenCalledTimes(3);
    expect(vi.mocked(ctx.arc).mock.calls.length).toBeGreaterThan(0);
    expect(vi.mocked(ctx.drawImage).mock.calls.length).toBe(vi.mocked(ctx.arc).mock.calls.length);
    expect(ctx.shadowBlur).toBe(0);
  });
});
