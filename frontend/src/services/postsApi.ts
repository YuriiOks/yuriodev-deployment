/**
 * The client for GET /api/posts: Yurii's own posts as published on LinkedIn
 * and X, served by the backend from one allow-listed snapshot.
 *
 * Contract (version 1; only additive changes, so unknown keys are ignored):
 *   { version: 1, enabled, generated_at,
 *     source: { provider: typefully | fixture | none, status: fresh | stale | error | disabled, last_success_at },
 *     items: [{ id, published_at, origin, pinned, featured, has_media,
 *               variants: { x?: Variant, linkedin?: Variant } }] }
 *   Variant = { id, url, published_at, parts: string[], truncated }
 *
 * Nothing here throws: a network error, a timeout, a 404 (a backend without
 * the route) or a payload of the wrong shape all come back as null, and the
 * page simply shows no posts. Every item is checked on arrival; a variant
 * whose permalink is not an x.com or www.linkedin.com post URL is dropped,
 * and an item left with no variant goes with it.
 */

/** Same origin: the proxy routes /api/ to the backend in every environment. */
export const POSTS_URL = '/api/posts';

/** Give up on the request after this long. */
export const POSTS_TIMEOUT_MS = 8000;

/** A cached answer this young is used as it is; an older one is shown and fetched again. */
export const POSTS_FRESH_MS = 5 * 60 * 1000;

/** The most items the page shows, whatever the API sends. */
export const MAX_POSTS = 12;

/** A thread longer than this is cut here (the permalink has the rest). */
const MAX_PARTS = 30;

export type PostPlatform = 'x' | 'linkedin';

/** Card order when an item was published on both. */
export const PLATFORMS: readonly PostPlatform[] = ['linkedin', 'x'];

export const PLATFORM_LABELS: Readonly<Record<PostPlatform, string>> = {
  linkedin: 'LinkedIn',
  x: 'X',
};

export type SourceStatus = 'fresh' | 'stale' | 'error' | 'disabled';

export interface PostVariant {
  readonly id: string;
  readonly url: string;
  readonly publishedAt: string;
  readonly parts: readonly string[];
  /** The text or the thread was cut short; the permalink has the rest. */
  readonly truncated: boolean;
}

export interface PostItem {
  readonly id: string;
  readonly publishedAt: string;
  readonly pinned: boolean;
  /** The original has images or video (not carried by version 1: the card says so and links out). */
  readonly hasMedia: boolean;
  readonly variants: Readonly<Partial<Record<PostPlatform, PostVariant>>>;
}

export interface PostsFeed {
  readonly enabled: boolean;
  readonly generatedAt: string;
  readonly status: SourceStatus;
  readonly lastSuccessAt: string | null;
  readonly items: readonly PostItem[];
}

/** The only permalinks a card may link to (the backend applies the same patterns). */
const PERMALINK: Readonly<Record<PostPlatform, RegExp>> = {
  x: /^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}\/status\/\d{1,25}$/,
  linkedin: /^https:\/\/www\.linkedin\.com\/feed\/update\/urn:li:(?:share|activity|ugcPost):\d{1,25}\/?$/,
};

const STATUSES: readonly SourceStatus[] = ['fresh', 'stale', 'error', 'disabled'];

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isDate = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value));

function parseVariant(platform: PostPlatform, raw: unknown): PostVariant | null {
  if (!isObject(raw)) return null;
  const { id, url, published_at: publishedAt, parts, truncated } = raw;
  if (typeof id !== 'string' || typeof url !== 'string' || !PERMALINK[platform].test(url)) return null;
  if (!isDate(publishedAt) || !Array.isArray(parts)) return null;
  if (!parts.every((part) => typeof part === 'string')) return null;
  const texts = (parts as string[]).filter((part) => part.trim() !== '');
  if (texts.length === 0) return null;
  return {
    id,
    url,
    publishedAt,
    parts: texts.slice(0, MAX_PARTS),
    truncated: truncated === true || texts.length > MAX_PARTS,
  };
}

function parseItem(raw: unknown): PostItem | null {
  if (!isObject(raw)) return null;
  const { id, published_at: publishedAt, pinned, has_media: hasMedia, variants } = raw;
  if (typeof id !== 'string' || !isDate(publishedAt) || !isObject(variants)) return null;
  const parsed: Partial<Record<PostPlatform, PostVariant>> = {};
  for (const platform of PLATFORMS) {
    const variant = parseVariant(platform, variants[platform]);
    if (variant) parsed[platform] = variant;
  }
  if (Object.keys(parsed).length === 0) return null;
  return {
    id,
    publishedAt,
    pinned: pinned === true,
    hasMedia: hasMedia === true,
    variants: parsed,
  };
}

/** The payload as the page uses it, or null when it is not a version 1 answer. */
export function parsePostsResponse(body: unknown): PostsFeed | null {
  if (!isObject(body) || body.version !== 1 || typeof body.enabled !== 'boolean') return null;
  if (!Array.isArray(body.items) || !isObject(body.source)) return null;
  const { status, last_success_at: lastSuccessAt } = body.source;
  const seen = new Set<string>();
  const items: PostItem[] = [];
  for (const raw of body.items) {
    const item = parseItem(raw);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
    if (items.length === MAX_POSTS) break;
  }
  return {
    enabled: body.enabled,
    generatedAt: isDate(body.generated_at) ? body.generated_at : '',
    status: STATUSES.includes(status as SourceStatus) ? (status as SourceStatus) : 'fresh',
    lastSuccessAt: isDate(lastSuccessAt) ? lastSuccessAt : null,
    items,
  };
}

/**
 * Asks the API once. Resolves to null on any failure (never rejects); aborts
 * after `timeoutMs`, or when `signal` aborts.
 */
export async function fetchPosts(signal?: AbortSignal, timeoutMs = POSTS_TIMEOUT_MS): Promise<PostsFeed | null> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) return null;
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    const response = await fetch(POSTS_URL, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return parsePostsResponse(await response.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

// ---------------------------------------------------------------------------
// In-memory cache, shared by the posts section and the terminal
// ---------------------------------------------------------------------------

export interface CachedPosts {
  /** Null when the last request failed. */
  readonly feed: PostsFeed | null;
  /** Date.now() when the answer arrived. */
  readonly at: number;
}

let cached: CachedPosts | null = null;

/** The request in flight, shared by every caller until it settles. */
interface Inflight {
  readonly promise: Promise<CachedPosts | null>;
  readonly controller: AbortController;
  /** Callers still waiting; the request is aborted when the last one leaves. */
  waiting: number;
}

let inflight: Inflight | null = null;

/** The last answer this page received, if any. */
export function peekPosts(): CachedPosts | null {
  return cached;
}

function startRequest(): Inflight {
  const controller = new AbortController();
  const request: Inflight = {
    controller,
    waiting: 0,
    promise: fetchPosts(controller.signal).then((feed) => {
      if (inflight === request) inflight = null;
      if (controller.signal.aborted) return null;
      cached = { feed, at: Date.now() };
      return cached;
    }),
  };
  return request;
}

/**
 * Asks the API and remembers the answer (a failure too, so a page that could
 * not reach it does not keep retrying). Callers that ask while a request is
 * in flight share it. Resolves to null only when `signal` aborted, in which
 * case this caller stops waiting; the request itself is aborted, and nothing
 * remembered, only once no caller is left waiting for it.
 */
export function loadPosts(signal?: AbortSignal): Promise<CachedPosts | null> {
  if (signal?.aborted) return Promise.resolve(null);
  const request = inflight ?? (inflight = startRequest());
  request.waiting += 1;

  return new Promise((resolve) => {
    let settled = false;
    const leave = (result: CachedPosts | null) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      request.waiting -= 1;
      resolve(result);
    };
    const onAbort = () => {
      leave(null);
      if (request.waiting === 0) {
        if (inflight === request) inflight = null;
        request.controller.abort();
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    void request.promise.then(leave);
  });
}

/** The cached answer while it is fresh, otherwise a new one. */
export async function getPosts(signal?: AbortSignal): Promise<CachedPosts | null> {
  if (cached && Date.now() - cached.at < POSTS_FRESH_MS) return cached;
  return loadPosts(signal);
}

/** Test helper: forget the cached answer. */
export function resetPostsCache(): void {
  cached = null;
  inflight?.controller.abort();
  inflight = null;
}

// ---------------------------------------------------------------------------
// Reading an item
// ---------------------------------------------------------------------------

/** The section needs at least this many posts; below it the page shows none. */
export const MIN_POSTS_SHOWN = 3;

/** True when the feed is on and has enough posts for the section. */
export function hasEnoughPosts(feed: PostsFeed | null): feed is PostsFeed {
  return feed !== null && feed.enabled && feed.items.length >= MIN_POSTS_SHOWN;
}

/** The platforms an item was published on, LinkedIn first. */
export function platformsOf(item: PostItem): PostPlatform[] {
  return PLATFORMS.filter((platform) => item.variants[platform] !== undefined);
}

/** The version a card shows: the LinkedIn text when there is one, else the X thread. */
export function primaryVariant(item: PostItem): { platform: PostPlatform; variant: PostVariant } {
  const platform = platformsOf(item)[0];
  return { platform, variant: item.variants[platform]! };
}
