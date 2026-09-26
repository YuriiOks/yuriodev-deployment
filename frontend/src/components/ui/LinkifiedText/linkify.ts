/**
 * Splits post text into plain text and links, for LinkifiedText.
 *
 * - Only http: and https: URLs become links. Anything else that looks like
 *   a link (javascript:, data:, a bare domain) stays text.
 * - In X text only, an @handle links to that X profile. LinkedIn's mention
 *   syntax is unknown, so there an @word stays text.
 * - #hashtags always stay text.
 * The text itself is never changed: styled Unicode, emoji and line breaks
 * come through exactly as written.
 */

export type LinkifyPlatform = 'x' | 'linkedin';

/** Links inside post text: never endorsed, never given the page's referrer. */
export const UGC_REL = 'nofollow ugc noopener noreferrer';

export type TextToken =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'url' | 'mention'; readonly text: string; readonly href: string };

const URL_CANDIDATE = /https?:\/\/[^\s<>"'`]+/gi;

/** An @handle as X allows it (1-15 letters, digits, underscores), not inside a word or an address. */
const MENTION = /(^|[^A-Za-z0-9_@./])@([A-Za-z0-9_]{1,15})(?![A-Za-z0-9_@])/g;

const TRAILING = /[.,;:!?'"’”)\]}>…]$/;

/** Trailing punctuation belongs to the sentence, not the URL; a ")" stays when it closes a "(" in the URL. */
function trimUrl(candidate: string): string {
  let url = candidate;
  while (TRAILING.test(url)) {
    if (url.endsWith(')') && (url.match(/\(/g)?.length ?? 0) >= (url.match(/\)/g)?.length ?? 0)) break;
    url = url.slice(0, -1);
  }
  return url;
}

/** The URL to link to, or null when it is not a well-formed http(s) URL. */
export function safeHref(text: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!parsed.hostname || parsed.username || parsed.password) return null;
  return parsed.href;
}

function pushText(tokens: TextToken[], text: string): void {
  if (!text) return;
  const last = tokens[tokens.length - 1];
  if (last?.kind === 'text') {
    tokens[tokens.length - 1] = { kind: 'text', text: last.text + text };
  } else {
    tokens.push({ kind: 'text', text });
  }
}

function mentions(tokens: TextToken[], text: string): void {
  let index = 0;
  for (const match of text.matchAll(MENTION)) {
    const start = match.index + match[1].length;
    pushText(tokens, text.slice(index, start));
    const handle = match[2];
    tokens.push({ kind: 'mention', text: `@${handle}`, href: `https://x.com/${handle}` });
    index = start + handle.length + 1;
  }
  pushText(tokens, text.slice(index));
}

export function linkify(text: string, platform: LinkifyPlatform): TextToken[] {
  const tokens: TextToken[] = [];
  const plain = (segment: string) => (platform === 'x' ? mentions(tokens, segment) : pushText(tokens, segment));
  let index = 0;
  for (const match of text.matchAll(URL_CANDIDATE)) {
    const url = trimUrl(match[0]);
    const href = safeHref(url);
    if (!href) continue;
    plain(text.slice(index, match.index));
    tokens.push({ kind: 'url', text: url, href });
    index = match.index + url.length;
  }
  plain(text.slice(index));
  return tokens;
}

/** How a URL reads in the text: no scheme or "www.", long ones cut short. */
export function shortUrl(url: string, max = 40): string {
  const bare = url.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  return bare.length <= max ? bare : `${bare.slice(0, max - 1)}…`;
}
