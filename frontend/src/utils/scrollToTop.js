/**
 * Scroll all known app scroll roots to top.
 * Main layout uses a fixed .content-area (not window); login uses .home-scroll-area.
 */
const SCROLL_ROOT_SELECTORS = [
  '.app-layout > .content-area',
  '.home-scroll-area',
  '.main-layout .content-area',
];

export function scrollAppToTop(behavior = 'auto') {
  const scrollOpts = { top: 0, left: 0, behavior };

  for (const selector of SCROLL_ROOT_SELECTORS) {
    document.querySelectorAll(selector).forEach((el) => {
      try {
        el.scrollTo(scrollOpts);
      } catch {
        /* scrollTo may fail on some nodes */
      }
      el.scrollTop = 0;
      el.scrollLeft = 0;
    });
  }

  try {
    window.scrollTo(scrollOpts);
  } catch {
    window.scrollTo(0, 0);
  }
  document.documentElement.scrollTop = 0;
  document.documentElement.scrollLeft = 0;
  document.body.scrollTop = 0;
  document.body.scrollLeft = 0;
}
