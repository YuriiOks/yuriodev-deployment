import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import CanvasBackground from './CanvasBackground';
import { MIN_NODES } from './field';

const originalMatchMedia = window.matchMedia;
const originalPixelRatio = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');

function setPixelRatio(ratio: number) {
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => ratio });
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
  });
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    if (originalPixelRatio) Object.defineProperty(window, 'devicePixelRatio', originalPixelRatio);
    vi.restoreAllMocks();
  });

  it('starts one animation loop and releases every listener and frame on unmount', () => {
    setReducedMotion(false);
    const windowListeners = trackListeners(window);
    const documentListeners = trackListeners(document);
    const rootListeners = trackListeners(document.documentElement);

    const { unmount } = render(<CanvasBackground />);
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(windowListeners()).toEqual(expect.arrayContaining(['resize', 'mousemove']));
    expect(documentListeners()).toContain('visibilitychange');
    expect(rootListeners()).toContain('mouseleave');

    unmount();
    expect(window.cancelAnimationFrame).toHaveBeenCalled();
    const ours = ['resize', 'mousemove', 'mouseleave', 'visibilitychange'];
    expect(windowListeners().filter((type) => ours.includes(type))).toEqual([]);
    expect(documentListeners().filter((type) => ours.includes(type))).toEqual([]);
    expect(rootListeners().filter((type) => ours.includes(type))).toEqual([]);
  });

  it('draws one static frame and starts no loop under reduced motion', () => {
    setReducedMotion(true);
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
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(375);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(812);
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
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
    setPixelRatio(1);

    const { container } = render(<CanvasBackground />);
    const canvas = container.querySelector('canvas')!;
    expect([canvas.width, canvas.height]).toEqual([1280, 800]);
  });

  it('stamps pre-rendered glow sprites instead of blurring every dot', () => {
    setReducedMotion(true);
    const ctx = (HTMLCanvasElement.prototype.getContext as unknown as () => CanvasRenderingContext2D)();
    vi.mocked(ctx.drawImage).mockClear();
    vi.mocked(ctx.createRadialGradient).mockClear();
    vi.mocked(ctx.arc).mockClear();
    ctx.shadowBlur = 0;

    render(<CanvasBackground />);
    // One sprite per tone, one stamp per node.
    expect(ctx.createRadialGradient).toHaveBeenCalledTimes(3);
    expect(vi.mocked(ctx.drawImage).mock.calls.length).toBe(vi.mocked(ctx.arc).mock.calls.length);
    expect(ctx.shadowBlur).toBe(0);
  });
});
