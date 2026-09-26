/** The URL schemes a link may use. Anything else (javascript:, data:, ...) is not rendered as a link. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

function parse(href: string): URL | null {
  try {
    return new URL(href, window.location.href);
  } catch {
    return null;
  }
}

/** Whether `href` (absolute, or relative to this page) uses an allowed scheme. */
export function isAllowedHref(href: string): boolean {
  const url = parse(href);
  return url !== null && ALLOWED_PROTOCOLS.has(url.protocol);
}

/** Whether `href` leaves this site: http or https on another origin. */
export function isExternalHref(href: string): boolean {
  const url = parse(href);
  return url !== null && (url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== window.location.origin;
}
