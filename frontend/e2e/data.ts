/*
 * API answers for the browser tests, in the backend's version 1 shapes.
 * Synthetic: the handle, ids and texts are made up.
 */

const HANDLE = 'example';

function item(n: number, publishedAt: string, text: string, platforms: ReadonlyArray<'x' | 'linkedin'>) {
  const variants: Record<string, unknown> = {};
  if (platforms.includes('x')) {
    variants.x = {
      id: `x:19000000000000000${n}`,
      url: `https://x.com/${HANDLE}/status/19000000000000000${n}`,
      published_at: publishedAt,
      parts: [text, `${n}/ A second part of the thread, with a link: https://example.com/notes/${n}`],
      truncated: false,
    };
  }
  if (platforms.includes('linkedin')) {
    variants.linkedin = {
      id: `li:share:73000000000000000${n}`,
      url: `https://www.linkedin.com/feed/update/urn:li:share:73000000000000000${n}`,
      published_at: publishedAt,
      parts: [`${text}\n\nA longer paragraph for LinkedIn, with a #hashtag and a mention of @example.`],
      truncated: false,
    };
  }
  return {
    id: `post-${n}`,
    published_at: publishedAt,
    origin: 'typefully',
    pinned: n === 1,
    featured: false,
    has_media: n === 2,
    variants,
  };
}

export const POSTS_FEED = {
  version: 1,
  enabled: true,
  generated_at: '2026-09-25T10:30:00Z',
  source: { provider: 'fixture', status: 'fresh', last_success_at: '2026-09-25T10:30:00Z' },
  items: [
    item(1, '2026-09-24T08:00:00Z', 'Notes on evaluating a retrieval pipeline before changing the model.', ['x', 'linkedin']),
    item(2, '2026-09-20T12:00:00Z', 'A short thread about testing layouts in a real browser.', ['x']),
    item(3, '2026-09-12T09:30:00Z', 'What a small VPS taught me about resource limits.', ['linkedin']),
    item(4, '2026-08-30T17:45:00Z', 'Release tags, image promotion and a cron deploy agent.', ['x', 'linkedin']),
  ],
};

export const HEALTH = {
  status: 'healthy',
  service: 'backend',
  environment: 'local',
  revision: '0123456789abcdef0123456789abcdef01234567',
};
