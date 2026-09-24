import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Unmount React trees mounted by tests between each test.
afterEach(() => {
  cleanup();
});

// jsdom does not implement matchMedia; ThemeContext reads it on first render
// to pick the system-preferred theme.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated API, some libraries still call it
    removeListener: vi.fn(), // deprecated API, some libraries still call it
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// jsdom does not implement the canvas 2D context; CanvasBackground reads it
// to draw the animated neural-network background.
const mockCanvasContext = {
  fillRect: vi.fn(),
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  closePath: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  stroke: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  translate: vi.fn(),
  scale: vi.fn(),
  rotate: vi.fn(),
  drawImage: vi.fn(),
  setTransform: vi.fn(),
  measureText: vi.fn(() => ({ width: 0 })),
  createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  shadowBlur: 0,
  shadowColor: '',
  font: '',
};
HTMLCanvasElement.prototype.getContext = vi.fn(
  () => mockCanvasContext,
) as unknown as typeof HTMLCanvasElement.prototype.getContext;

// jsdom does not run an animation pipeline; CanvasBackground's draw loop
// would otherwise recurse via requestAnimationFrame forever. Make it a
// one-shot no-op so components mount without hanging the test runner.
window.requestAnimationFrame = vi.fn(() => 0) as unknown as typeof window.requestAnimationFrame;
window.cancelAnimationFrame = vi.fn();

// jsdom does not implement scrollIntoView / scrollTo; Header, LeftSidebar
// and PageLayout call them in response to navigation and key handling.
Element.prototype.scrollIntoView = vi.fn();
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;

// jsdom does not implement IntersectionObserver; Header and LeftSidebar use
// it to track which section is currently in view.
class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin: string = '';
  readonly thresholds: ReadonlyArray<number> = [];
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn(() => []);
}
window.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;

// jsdom does not implement ResizeObserver either; stub it defensively for
// any component that measures its own size.
class MockResizeObserver implements ResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
