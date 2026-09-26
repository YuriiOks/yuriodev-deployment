import { useEffect } from 'react';

export const SITE_TITLE = 'Yurii Oksamytnyi — AI/ML Systems Engineer';
export const SITE_ORIGIN = 'https://yuriodev.co.uk';

/** The document title for a page: the site title alone, or "<page> | Yurii Oksamytnyi". */
export function pageTitle(page?: string): string {
  return page ? `${page} | Yurii Oksamytnyi` : SITE_TITLE;
}

/** Points <link rel="canonical"> and og:url (both in index.html) at `url`, creating them if missing. */
function setCanonicalUrl(url: string): void {
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'canonical';
    document.head.append(link);
  }
  link.href = url;

  let ogUrl = document.head.querySelector<HTMLMetaElement>('meta[property="og:url"]');
  if (!ogUrl) {
    ogUrl = document.createElement('meta');
    ogUrl.setAttribute('property', 'og:url');
    document.head.append(ogUrl);
  }
  ogUrl.content = url;
}

/**
 * Sets document.title, the canonical URL and og:url while the calling page is
 * mounted. Call it once from each routed page: omit `page` on the home page, and
 * pass `canonicalPath` on an indexable page other than home (for example
 * '/privacy'); every other page keeps the home page as its canonical URL.
 */
export function usePageTitle(page?: string, canonicalPath = '/'): void {
  useEffect(() => {
    document.title = pageTitle(page);
    setCanonicalUrl(SITE_ORIGIN + canonicalPath);
  }, [page, canonicalPath]);
}
