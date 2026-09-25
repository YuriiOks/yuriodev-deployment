import { useEffect } from 'react';

export const SITE_TITLE = 'Yurii Oksamytnyi — AI/ML Systems Engineer';

/** The document title for a page: the site title alone, or "<page> | Yurii Oksamytnyi". */
export function pageTitle(page?: string): string {
  return page ? `${page} | Yurii Oksamytnyi` : SITE_TITLE;
}

/**
 * Sets document.title while the calling page is mounted. Call it once from
 * each routed page; omit the argument on the home page.
 */
export function usePageTitle(page?: string): void {
  useEffect(() => {
    document.title = pageTitle(page);
  }, [page]);
}
