import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import CanvasBackground from './CanvasBackground';

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
  });
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
  });

  it('starts one animation loop and releases every listener and frame on unmount', () => {
    setReducedMotion(false);
    const windowListeners = trackListeners(window);
    const documentListeners = trackListeners(document);

    const { unmount } = render(<CanvasBackground />);
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(windowListeners()).toEqual(expect.arrayContaining(['resize', 'mousemove']));
    expect(documentListeners()).toContain('visibilitychange');

    unmount();
    expect(window.cancelAnimationFrame).toHaveBeenCalled();
    const ours = ['resize', 'mousemove', 'mouseleave', 'visibilitychange'];
    expect(windowListeners().filter((type) => ours.includes(type))).toEqual([]);
    expect(documentListeners().filter((type) => ours.includes(type))).toEqual([]);
  });

  it('draws one static frame and starts no loop under reduced motion', () => {
    setReducedMotion(true);
    const ctx = (HTMLCanvasElement.prototype.getContext as unknown as () => CanvasRenderingContext2D)();
    vi.mocked(ctx.arc).mockClear();

    render(<CanvasBackground />);
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    expect(ctx.arc).toHaveBeenCalled();
  });

  it('uses a low-resolution backing store and fewer nodes on a small screen', () => {
    setReducedMotion(true);
    const ctx = (HTMLCanvasElement.prototype.getContext as unknown as () => CanvasRenderingContext2D)();
    vi.mocked(ctx.arc).mockClear();
    const width = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(375);
    const height = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(812);

    const { container } = render(<CanvasBackground />);
    const canvas = container.querySelector('canvas')!;
    expect(canvas.width).toBe(131);
    expect(canvas.height).toBe(284);
    // One arc per node: the 20-node floor for a phone-sized viewport.
    expect(ctx.arc).toHaveBeenCalledTimes(20);

    width.mockRestore();
    height.mockRestore();
  });
});
