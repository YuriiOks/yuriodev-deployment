import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import PostsSection from './PostsSection';
import { POSTS_URL, resetPostsCache } from '../../../services/postsApi';
import { noteJump } from '../../../utils/scroll';
import { items, payload, stubFetch } from '../../../test/postsFixtures';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetPostsCache();
});

/** Renders the section between two neighbours and waits for the request to settle. */
async function renderAndLoad(fetchMock: ReturnType<typeof vi.fn>) {
  const view = render(
    <main>
      <section id="platform">before</section>
      <PostsSection />
      <section id="connect">after</section>
    </main>,
  );
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  // Let the answer land.
  await act(async () => {});
  return view;
}

/** Nothing at all: no section, no heading, no placeholder element. */
function expectHidden(container: HTMLElement) {
  expect(container.querySelector('#posts')).toBeNull();
  expect(screen.queryByRole('heading')).toBeNull();
  const main = container.querySelector('main')!;
  expect([...main.children].map((el) => el.id)).toEqual(['platform', 'connect']);
}

describe('PostsSection', () => {
  it('asks the API on mount, before the visitor gets anywhere near it', async () => {
    const fetchMock = stubFetch(payload(items(3)));
    render(<PostsSection />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(POSTS_URL, expect.anything()));
    expect(await screen.findByRole('heading', { name: 'Latest posts' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    await waitFor(() => expect(signal).toBeDefined());
    unmount();
    expect(signal!.aborted).toBe(true);
  });

  describe('a jump that its arrival pushed off target', () => {
    const scrolls: string[] = [];
    function trackScrolls() {
      scrolls.length = 0;
      vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) {
        scrolls.push(this.id);
      });
    }
    function renderPage() {
      return render(
        <main>
          <section id="about">before</section>
          <PostsSection />
          <section id="connect">
            <div id="terminal">terminal</div>
          </section>
        </main>,
      );
    }

    it.each(['connect', 'terminal', 'posts'])('is repeated for #%s, at or below the section', async (target) => {
      trackScrolls();
      stubFetch(payload(items(3)));
      noteJump(target);
      renderPage();
      expect(await screen.findByRole('heading', { name: 'Latest posts' })).toBeInTheDocument();
      expect(scrolls).toEqual([target]);
    });

    it('is left alone for a place above the section, or a jump long past', async () => {
      trackScrolls();
      stubFetch(payload(items(3)));
      noteJump('about');
      const { unmount } = renderPage();
      expect(await screen.findByRole('heading', { name: 'Latest posts' })).toBeInTheDocument();
      expect(scrolls).toEqual([]);
      unmount();
      resetPostsCache();

      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);
      renderPage();
      expect(await screen.findByRole('heading', { name: 'Latest posts' })).toBeInTheDocument();
      expect(scrolls).toEqual([]);
    });

    it('is not repeated when the section was already there on mount', async () => {
      const fetchMock = stubFetch(payload(items(3)));
      const { unmount } = renderPage();
      await screen.findByRole('heading', { name: 'Latest posts' });
      unmount();
      trackScrolls();
      noteJump('connect');
      renderPage();
      expect(screen.getByRole('heading', { name: 'Latest posts' })).toBeInTheDocument();
      await act(async () => {});
      expect(scrolls).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
