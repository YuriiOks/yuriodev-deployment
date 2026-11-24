import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../../../context/ThemeContext';
import { DashboardLangProvider } from '../../../context/DashboardLangProvider';
import type { AttentionItem } from '../../../services/dashboards/recurringApi';
import AttentionScroller from './AttentionScroller';

// Invented items only.
const item = (key: string): AttentionItem => ({
  key,
  kind: 'overdraft',
  severity: 'high',
  title: key,
  subjectType: 'account',
  subjectId: key,
  subjectName: `Account ${key}`,
  provider: null,
  dueDate: null,
  amount: 1000,
  currency: 'GBP',
  display: null,
  converted: false,
  facts: {},
  state: 'active',
  snoozedUntil: null,
});

afterEach(() => vi.unstubAllGlobals());

describe('the attention row', () => {
  it('never writes scrollLeft: a refetch (new item objects, same keys) and a resize leave the row where the person put it', () => {
    const resizes: (() => void)[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resizes.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    const writes: number[] = [];
    const wrap = (items: AttentionItem[]) => (
      <ThemeProvider>
        <DashboardLangProvider>
          <MemoryRouter>
            <AttentionScroller items={items} allHref="?view=attention" recurring={[]} accounts={[]} logos={{}} mode="native" onOpen={() => undefined} />
          </MemoryRouter>
        </DashboardLangProvider>
      </ThemeProvider>
    );
    const first = render(wrap([item('a'), item('b'), item('c')]));
    const scroller = first.container.querySelector('[data-key]')!.parentElement as HTMLElement;
    let left = 37.5;
    Object.defineProperty(scroller, 'scrollLeft', { configurable: true, get: () => left, set: (value: number) => void writes.push(value) });
    const cards = Array.from(scroller.querySelectorAll('[data-key]'));
    // A refetch: the same items as new objects.
    first.rerender(wrap([item('a'), item('b'), item('c')]));
    act(() => resizes.forEach((callback) => callback()));
    first.rerender(wrap([item('a'), item('b'), item('c')]));
    expect(writes).toEqual([]);
    expect(scroller.scrollLeft).toBe(37.5);
    // The cards were kept, not re-mounted (the same elements, by key).
    expect(Array.from(scroller.querySelectorAll('[data-key]'))).toEqual(cards);
    left = 0;
    expect(scroller.scrollLeft).toBe(0);
  });

  it('keeps both arrows in the row at every position (hidden, never removed), so the scroller\'s box never changes', () => {
    const { container } = render(
      <ThemeProvider>
        <DashboardLangProvider>
          <MemoryRouter>
            <AttentionScroller items={[item('a')]} allHref="?view=attention" recurring={[]} accounts={[]} logos={{}} mode="native" onOpen={() => undefined} />
          </MemoryRouter>
        </DashboardLangProvider>
      </ThemeProvider>,
    );
    expect(container.querySelectorAll('button[data-edge]')).toHaveLength(2);
  });
});
