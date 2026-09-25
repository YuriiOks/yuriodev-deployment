import { useCallback, useEffect, useState } from 'react';
import { POSTS_FRESH_MS, loadPosts, peekPosts, type PostsFeed } from '../services/postsApi';

/** Start the request while the section's place is still this far outside the view. */
export const POSTS_NEAR_MARGIN = '800px 0px';

export interface PostsState {
  /** The last answer; null before the first one, or when the request failed. */
  readonly feed: PostsFeed | null;
  /** When that answer arrived (Date.now()): relative dates are counted from it. */
  readonly now: number;
}

export interface UsePosts extends PostsState {
  /**
   * Attach to an element that marks where the section goes while there is
   * nothing to show yet. The request starts once it comes near the view.
   */
  readonly sentinelRef: (element: Element | null) => void;
}

function fromCache(): PostsState {
  const cached = peekPosts();
  return cached ? { feed: cached.feed, now: cached.at } : { feed: null, now: 0 };
}

/**
 * The posts for the "Latest posts" section.
 *
 * - The first request waits until the sentinel element is near the view
 *   (IntersectionObserver), so a visitor who never scrolls that far costs
 *   the API nothing. Without IntersectionObserver it starts at once.
 * - Stale-while-revalidate in memory: an answer from earlier in this page's
 *   life is shown at once (on returning to the home page, say); if it is
 *   older than POSTS_FRESH_MS it is fetched again in the background.
 * - A failed request is remembered as "no posts", so it is not retried until
 *   that answer goes stale.
 * - State is only set inside the request's callback, never synchronously in
 *   the effect; unmounting aborts the request.
 */
export function usePosts(): UsePosts {
  const [state, setState] = useState<PostsState>(fromCache);
  const [sentinel, setSentinel] = useState<Element | null>(null);
  const sentinelRef = useCallback((element: Element | null) => setSentinel(element), []);

  useEffect(() => {
    const controller = new AbortController();
    let observer: IntersectionObserver | undefined;

    const load = () => {
      observer?.disconnect();
      void loadPosts(controller.signal).then((result) => {
        if (result) setState({ feed: result.feed, now: result.at });
      });
    };

    const cached = peekPosts();
    if (cached) {
      if (Date.now() - cached.at >= POSTS_FRESH_MS) load();
    } else if (sentinel) {
      if (typeof IntersectionObserver !== 'function') {
        load();
      } else {
        observer = new IntersectionObserver(
          (entries) => {
            if (entries.some((entry) => entry.isIntersecting)) load();
          },
          { rootMargin: POSTS_NEAR_MARGIN },
        );
        observer.observe(sentinel);
      }
    }

    return () => {
      observer?.disconnect();
      controller.abort();
    };
  }, [sentinel]);

  return { ...state, sentinelRef };
}
