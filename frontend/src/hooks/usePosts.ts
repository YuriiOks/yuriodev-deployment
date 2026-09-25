import { useEffect, useState } from 'react';
import { getPosts, peekPosts, type PostsFeed } from '../services/postsApi';

export interface PostsState {
  /** The last answer; null before the first one, or when the request failed. */
  readonly feed: PostsFeed | null;
  /** When that answer arrived (Date.now()): relative dates are counted from it. */
  readonly now: number;
}

function fromCache(): PostsState {
  const cached = peekPosts();
  return cached ? { feed: cached.feed, now: cached.at } : { feed: null, now: 0 };
}

/**
 * The posts for the "Latest posts" section.
 *
 * - Asked for on mount: the payload is a few KB from the same origin and the
 *   section sits far below the fold, so it is in place before a visitor can
 *   scroll or jump past its slot (a section that appeared mid-jump would push
 *   the jump's target down).
 * - Stale-while-revalidate in memory: an answer from earlier in this page's
 *   life is shown at once (on returning to the home page, say); if it is
 *   older than POSTS_FRESH_MS it is fetched again in the background. A
 *   request already in flight (the terminal's `posts`, say) is shared.
 * - A failed request is remembered as "no posts", so it is not retried until
 *   that answer goes stale.
 * - State is only set inside the request's callback, never synchronously in
 *   the effect; unmounting stops waiting for the request.
 */
export function usePosts(): PostsState {
  const [state, setState] = useState<PostsState>(fromCache);

  useEffect(() => {
    const controller = new AbortController();
    void getPosts(controller.signal).then((result) => {
      if (!result) return;
      setState((previous) =>
        previous.feed === result.feed && previous.now === result.at ? previous : { feed: result.feed, now: result.at },
      );
    });
    return () => controller.abort();
  }, []);

  return state;
}
