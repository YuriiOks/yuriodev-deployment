import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * BrowserRouter does not scroll to a URL fragment after a client-side
 * navigation (for example a '/#about' link followed from /courses). Call this
 * from the page that owns the target ids: once the page has mounted, and after
 * every later navigation that carries a hash, it scrolls the matching element
 * into view.
 */
export function useScrollToHash(): void {
  const { hash, key } = useLocation();

  useEffect(() => {
    if (!hash) return;
    let id: string;
    try {
      id = decodeURIComponent(hash.slice(1));
    } catch {
      return;
    }
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [hash, key]);
}
