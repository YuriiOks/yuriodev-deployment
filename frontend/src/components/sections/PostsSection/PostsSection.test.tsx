import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import PostsSection from './PostsSection';
import { POSTS_URL, resetPostsCache } from '../../../services/postsApi';
import { items, payload, stubFetch } from '../../../test/postsFixtures';

/** An IntersectionObserver the test drives: `nearView()` reports every observed element as intersecting. */
let observed: { callback: IntersectionObserverCallback; elements: Element[]; options?: IntersectionObserverInit }[] = [];
class TestObserver {
  private readonly entry: (typeof observed)[number];
  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.entry = { callback, elements: [], options };
    observed.push(this.entry);
  }
  observe(element: Element) {
    this.entry.elements.push(element);
  }
  unobserve() {}
  disconnect() {
    this.entry.elements = [];
  }
  takeRecords() {
    return [];
  }
}

function nearView() {
  act(() => {
    for (const { callback, elements } of observed) {
      if (elements.length === 0) continue;
      const entries = elements.map((target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry);
      callback(entries, {} as IntersectionObserver);
    }
  });
}

const originalObserver = window.IntersectionObserver;

beforeEach(() => {
  observed = [];
  window.IntersectionObserver = TestObserver as unknown as typeof IntersectionObserver;
});

afterEach(() => {
  window.IntersectionObserver = originalObserver;
  vi.unstubAllGlobals();
  resetPostsCache();
});

/** Renders the section, brings it near the view and waits for the request to settle. */
async function renderAndLoad(fetchMock: ReturnType<typeof vi.fn>) {
  const view = render(
    <main>
      <section id="platform">before</section>
      <PostsSection />
      <section id="connect">after</section>
    </main>,
  );
  nearView();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  // Let the answer land.
  await act(async () => {});
  return view;
}

/** Nothing but the zero-height marker: no section, no heading, no text. */
function expectHidden(container: HTMLElement) {
  expect(container.querySelector('#posts')).toBeNull();
  expect(screen.queryByRole('heading')).toBeNull();
  const main = container.querySelector('main')!;
  expect([...main.children].map((el) => el.tagName)).toEqual(['SECTION', 'DIV', 'SECTION']);
  expect(main.children[1]).toBeEmptyDOMElement();
  expect(main.children[1]).toHaveAttribute('aria-hidden', 'true');
}

describe('PostsSection', () => {
  it('does not ask the API until its place comes near the view', async () => {
    const fetchMock = stubFetch(payload(items(3)));
    render(<PostsSection />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(observed.at(-1)?.options?.rootMargin).toBe('800px 0px');
    nearView();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(POSTS_URL, expect.anything()));
    expect(await screen.findByRole('heading', { name: 'Latest posts' })).toBeInTheDocument();
  });

  it('shows 3 or more posts as a labelled section of articles', async () => {
    const { container } = await renderAndLoad(stubFetch(payload(items(4))));
    const section = container.querySelector('section#posts')!;
    expect(section).not.toBeNull();
    expect(section).toHaveAttribute('aria-labelledby', 'posts-title');
    expect(screen.getByRole('heading', { level: 2, name: 'Latest posts' })).toHaveAttribute('id', 'posts-title');
    expect(screen.getAllByRole('article')).toHaveLength(4);
    expect(screen.getByText(/as published on X\./)).toBeInTheDocument();
    // It takes the marker's place between its neighbours.
    expect([...container.querySelector('main')!.children].map((el) => el.id)).toEqual(['platform', 'posts', 'connect']);
  });

  it('renders nothing when the feed is switched off', async () => {
    const { container } = await renderAndLoad(stubFetch(payload(items(5), { enabled: false })));
    expectHidden(container);
  });

  it('renders nothing below 3 posts', async () => {
    const { container } = await renderAndLoad(stubFetch(payload(items(2))));
    expectHidden(container);
  });

  it('renders nothing on a 404 (a backend without the route)', async () => {
    const { container } = await renderAndLoad(stubFetch({ error: 'not_found' }, 404));
    expectHidden(container);
  });

  it('renders nothing on a network error', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = await renderAndLoad(fetchMock);
    expectHidden(container);
  });

  it('renders nothing for a payload of the wrong shape', async () => {
    const { container } = await renderAndLoad(stubFetch({ posts: [1, 2, 3] }));
    expectHidden(container);
  });

  it('says when the feed was last synced if it is stale', async () => {
    await renderAndLoad(
      stubFetch(payload(items(3), {}, { status: 'stale', last_success_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString() })),
    );
    expect(screen.getByText('Synced 3 hours ago')).toBeInTheDocument();
  });

  it('asks only once, and shows the remembered answer straight away on the next mount', async () => {
    const fetchMock = stubFetch(payload(items(3)));
    const { unmount } = await renderAndLoad(fetchMock);
    nearView();
    unmount();
    render(<PostsSection />);
    expect(screen.getByRole('heading', { name: 'Latest posts' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aborts the request when it unmounts first', async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        signal = init.signal ?? undefined;
        return new Promise(() => {});
      }),
    );
    const { unmount } = render(<PostsSection />);
    nearView();
    await waitFor(() => expect(signal).toBeDefined());
    unmount();
    expect(signal!.aborted).toBe(true);
  });
});
