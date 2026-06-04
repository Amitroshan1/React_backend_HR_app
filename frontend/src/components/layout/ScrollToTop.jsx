import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { scrollAppToTop } from '../../utils/scrollToTop';

/**
 * Resets scroll position when the route changes (pathname, query, or hash).
 */
export function ScrollToTop() {
  const { pathname, search, hash } = useLocation();

  useEffect(() => {
    if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
  }, []);

  useEffect(() => {
    scrollAppToTop();

    const raf = requestAnimationFrame(() => scrollAppToTop());
    const t1 = window.setTimeout(() => scrollAppToTop(), 50);
    const t2 = window.setTimeout(() => scrollAppToTop(), 200);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [pathname, search, hash]);

  return null;
}
