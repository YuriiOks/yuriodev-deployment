/**
 * Test data for the posts feed: GET /api/posts payloads in the version 1
 * shape, and a fetch stub that answers with them. Synthetic: the handle and
 * ids are made up.
 */
import { vi } from 'vitest';

export const HANDLE = 'example';

let next = 1000;

export interface RawVariant {
  id: string;
  url: string;
  published_at: string;
  parts: string[];
  truncated: boolean;
}

export function xVariant(parts: string[], publishedAt = '2026-09-24T08:00:00Z'): RawVariant {
  const id = String(next++);
  return { id: `x:${id}`, url: `https://x.com/${HANDLE}/status/${id}`, published_at: publishedAt, parts, truncated: false };
}

export function linkedinVariant(text: string, publishedAt = '2026-09-24T08:00:00Z'): RawVariant {
  const id = String(next++);
  return {
    id: `li:share:${id}`,
    url: `https://www.linkedin.com/feed/update/urn:li:share:${id}`,
    published_at: publishedAt,
    parts: [text],
    truncated: false,
  };
}

export function rawItem(
  variants: { x?: RawVariant; linkedin?: RawVariant },
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const first = variants.x ?? variants.linkedin!;
  return {
    id: first.id,
    published_at: first.published_at,
    origin: 'typefully',
    pinned: false,
    featured: false,
    has_media: false,
    variants,
    ...extra,
  };
}

export function payload(
  items: unknown[],
  overrides: Record<string, unknown> = {},
  source: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: 1,
    enabled: true,
    generated_at: '2026-09-25T10:30:00Z',
    source: { provider: 'fixture', status: 'fresh', last_success_at: '2026-09-25T10:30:00Z', ...source },
    items,
    ...overrides,
  };
}

/** `n` simple X-only items, newest first. */
export function items(n: number): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => rawItem({ x: xVariant([`Post number ${i + 1}`]) }));
}

/** Stubs fetch to answer every request with `body` (JSON) and `status`. */
export function stubFetch(body: unknown, status = 200) {
  const mock = vi.fn(() =>
    Promise.resolve(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  vi.stubGlobal('fetch', mock);
  return mock;
}
