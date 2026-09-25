import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_POSTS,
  POSTS_URL,
  fetchPosts,
  getPosts,
  hasEnoughPosts,
  loadPosts,
  parsePostsResponse,
  peekPosts,
  primaryVariant,
  resetPostsCache,
} from './postsApi';
import { items, linkedinVariant, payload, rawItem, stubFetch, xVariant } from '../test/postsFixtures';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetPostsCache();
});

describe('parsePostsResponse', () => {
  it('reads a version 1 payload', () => {
    const li = linkedinVariant('Long-form text');
    const x = xVariant(['part 1', 'part 2']);
    const feed = parsePostsResponse(payload([rawItem({ x, linkedin: li }, { has_media: true, pinned: true })]));
    expect(feed).not.toBeNull();
    expect(feed!.enabled).toBe(true);
    expect(feed!.status).toBe('fresh');
    expect(feed!.lastSuccessAt).toBe('2026-09-25T10:30:00Z');
    const [item] = feed!.items;
    expect(item.hasMedia).toBe(true);
    expect(item.pinned).toBe(true);
    expect(item.variants.x?.parts).toEqual(['part 1', 'part 2']);
    expect(item.variants.linkedin?.url).toBe(li.url);
    expect(primaryVariant(item).platform).toBe('linkedin');
  });

  it('treats anything but a version 1 payload as an error', () => {
    for (const body of [
      null,
      'posts',
      [],
      {},
      payload([], { version: 2 }),
      payload([], { enabled: 'yes' }),
      payload([], { items: {} }),
      payload([], { source: null }),
    ]) {
      expect(parsePostsResponse(body), JSON.stringify(body)).toBeNull();
    }
  });

  it('ignores unknown keys (the contract only grows)', () => {
    const feed = parsePostsResponse(payload([rawItem({ x: xVariant(['hi']) }, { newField: 1 })], { extra: true }));
    expect(feed!.items).toHaveLength(1);
  });

  it('drops a variant whose permalink is not an X or LinkedIn post, and an item left with none', () => {
    const bad = [
      'javascript:alert(1)',
      'https://evil.example/status/1',
      'http://x.com/example/status/1',
      'https://x.com.evil.example/example/status/1',
      'https://x.com/example/status/1/extra',
      'https://www.linkedin.com/in/someone',
    ];
    const raw = bad.map((url) => rawItem({ x: { ...xVariant(['text']), url } }));
    expect(parsePostsResponse(payload(raw))!.items).toEqual([]);

    const mixed = rawItem({ x: { ...xVariant(['text']), url: 'https://evil.example/' }, linkedin: linkedinVariant('kept') });
    const [item] = parsePostsResponse(payload([mixed]))!.items;
    expect(item.variants.x).toBeUndefined();
    expect(item.variants.linkedin?.parts).toEqual(['kept']);
  });

  it('drops malformed items and duplicates, and caps the list', () => {
    const good = rawItem({ x: xVariant(['ok']) });
    const feed = parsePostsResponse(
      payload([
        good,
        good,
        { id: 'x:1' },
        rawItem({ x: { ...xVariant(['t']), parts: [] } }),
        rawItem({ x: { ...xVariant(['t']), parts: [1, 2] } }),
        rawItem({ x: { ...xVariant(['t']), published_at: 'not a date' } }),
      ]),
    );
    expect(feed!.items).toHaveLength(1);
    expect(parsePostsResponse(payload(items(MAX_POSTS + 5)))!.items).toHaveLength(MAX_POSTS);
  });

  it('ignores a media field: version 1 carries only has_media', () => {
    const raw = rawItem({ x: xVariant(['t']) }, { has_media: true, media: [{ url: '/api/media/abc.jpg', alt: 'A diagram' }] });
    const [item] = parsePostsResponse(payload([raw]))!.items;
    expect(item.hasMedia).toBe(true);
    expect(Object.keys(item)).not.toContain('image');
    expect(Object.keys(item)).not.toContain('media');
  });

  it('hasEnoughPosts needs the feed on and at least 3 posts', () => {
    expect(hasEnoughPosts(parsePostsResponse(payload(items(3))))).toBe(true);
    expect(hasEnoughPosts(parsePostsResponse(payload(items(2))))).toBe(false);
    expect(hasEnoughPosts(parsePostsResponse(payload(items(5), { enabled: false })))).toBe(false);
    expect(hasEnoughPosts(null)).toBe(false);
  });
});

describe('fetchPosts', () => {
  it('asks the same-origin endpoint for JSON', async () => {
    const mock = stubFetch(payload(items(3)));
    const feed = await fetchPosts();
    expect(feed!.items).toHaveLength(3);
    expect(mock).toHaveBeenCalledWith(POSTS_URL, expect.objectContaining({ headers: { Accept: 'application/json' } }));
  });

  it('resolves to null, never rejects, on 404, 5xx, a network error or a body that is not JSON', async () => {
    stubFetch({ error: 'not_found' }, 404);
    await expect(fetchPosts()).resolves.toBeNull();
    stubFetch('bad gateway', 502);
    await expect(fetchPosts()).resolves.toBeNull();
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(fetchPosts()).resolves.toBeNull();
    stubFetch('<html></html>');
    await expect(fetchPosts()).resolves.toBeNull();
  });

  it('gives up after the timeout', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        signal = init.signal ?? undefined;
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      }),
    );
    const pending = fetchPosts(undefined, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toBeNull();
    expect(signal?.aborted).toBe(true);
  });

  it('stops when the caller aborts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      ),
    );
    const controller = new AbortController();
    const pending = fetchPosts(controller.signal);
    controller.abort();
    await expect(pending).resolves.toBeNull();
  });
});

describe('cache', () => {
  it('remembers the answer, a failure too, and reuses it while fresh', async () => {
    const mock = stubFetch(payload(items(3)));
    expect(peekPosts()).toBeNull();
    const first = await getPosts();
    expect(first!.feed!.items).toHaveLength(3);
    expect(peekPosts()).toBe(first);
    await getPosts();
    expect(mock).toHaveBeenCalledTimes(1);

    resetPostsCache();
    stubFetch({}, 404);
    const failed = await loadPosts();
    expect(failed).toEqual({ feed: null, at: expect.any(Number) });
  });

  it('asks again once the answer is stale', async () => {
    vi.useFakeTimers();
    const mock = stubFetch(payload(items(3)));
    await getPosts();
    vi.advanceTimersByTime(5 * 60 * 1000);
    await getPosts();
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('shares a request in flight between callers', async () => {
    const mock = stubFetch(payload(items(3)));
    const [a, b] = await Promise.all([loadPosts(), getPosts()]);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(a!.feed!.items).toHaveLength(3);
  });

  it('keeps a shared request going while another caller still waits, and aborts it when none is left', async () => {
    let signal: AbortSignal | undefined;
    let answer: (response: Response) => void = () => {};
    const mock = vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Promise<Response>((resolve, reject) => {
        answer = resolve;
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    });
    vi.stubGlobal('fetch', mock);

    const first = new AbortController();
    const second = new AbortController();
    const leaving = loadPosts(first.signal);
    const staying = loadPosts(second.signal);
    first.abort();
    await expect(leaving).resolves.toBeNull();
    expect(signal?.aborted).toBe(false);

    answer(new Response(JSON.stringify(payload(items(3))), { status: 200 }));
    const result = await staying;
    expect(result!.feed!.items).toHaveLength(3);
    expect(peekPosts()).toBe(result);
    expect(mock).toHaveBeenCalledTimes(1);

    // Once every caller has left, the request is aborted and nothing is remembered.
    resetPostsCache();
    const only = new AbortController();
    const alone = loadPosts(only.signal);
    only.abort();
    await expect(alone).resolves.toBeNull();
    expect(signal?.aborted).toBe(true);
    expect(peekPosts()).toBeNull();
  });

  it('remembers nothing when the caller aborted', async () => {
    stubFetch(payload(items(3)));
    const controller = new AbortController();
    controller.abort();
    await expect(loadPosts(controller.signal)).resolves.toBeNull();
    expect(peekPosts()).toBeNull();
  });
});
