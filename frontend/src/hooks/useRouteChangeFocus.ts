import { useEffect, useRef, type RefObject } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * After a client-side navigation to a different path, scroll to the top and
 * move focus to the main content, so keyboard and screen-reader users start at
 * the new page rather than on the link they followed. Does nothing on the
 * first render or when only the hash changes; a URL with a hash is left to
 * useScrollToHash, so only the focus moves (without scrolling). On Back and
 * Forward the browser restores the earlier scroll position itself, so again
 * only the focus moves.
 */
export function useRouteChangeFocus(target: RefObject<HTMLElement | null>): void {
  const { pathname, hash } = useLocation();
  const navigationType = useNavigationType();
  const previousPath = useRef(pathname);

  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    if (!hash && navigationType !== 'POP') window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    target.current?.focus({ preventScroll: true });
  }, [pathname, hash, navigationType, target]);
}
