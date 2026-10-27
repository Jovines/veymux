import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { flushCacheThrottled, readCache, writeCacheThrottled } from '../../utils/localStorageCache';

export const SIDEBAR_SCROLL_POSITION_KEY = 'veymux-left-sidebar-scroll-position';

export function useSidebarScrollPosition(
  listRef: RefObject<HTMLElement>,
  _visible: boolean,
  hasSessions: boolean,
): void {
  const [savedTop] = useState(() => readCache(SIDEBAR_SCROLL_POSITION_KEY,
    (value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0));
  const restoredList = useRef<HTMLElement | null>(null);

  // Restore as soon as layout exists, including an offscreen mobile drawer:
  // a swipe exposes it before its deferred open state commits. A display:none
  // desktop panel still waits for measurable layout. Empty loading lists must
  // not clamp the saved position to zero before sessions arrive.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!hasSessions || !list || list.clientHeight === 0 || restoredList.current === list) return;
    if (savedTop !== null) list.scrollTop = savedTop;
    restoredList.current = list;
  });

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const save = () => {
      if (restoredList.current !== list || list.clientHeight === 0) return;
      writeCacheThrottled(SIDEBAR_SCROLL_POSITION_KEY, Math.max(0, list.scrollTop), 150);
    };
    const flush = () => { save(); flushCacheThrottled(SIDEBAR_SCROLL_POSITION_KEY); };
    const background = () => { if (document.hidden) flush(); };
    list.addEventListener('scroll', save, { passive: true });
    window.addEventListener('pagehide', flush);
    window.addEventListener('veymux:before-update', flush);
    document.addEventListener('visibilitychange', background);
    return () => {
      flush();
      list.removeEventListener('scroll', save);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('veymux:before-update', flush);
      document.removeEventListener('visibilitychange', background);
    };
  }, [listRef]);
}
