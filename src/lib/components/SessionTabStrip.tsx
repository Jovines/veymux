import { forwardRef, useLayoutEffect, useRef, type HTMLAttributes } from 'react';
import './sessionTabStrip.css';

/** Native tab scrolling stays independent of the Session pager and page pan. */
export const SessionTabStrip = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & {
  activeSessionId: string | null; ready?: boolean; onInitialPositioned?: () => void;
}>(function SessionTabStrip({ activeSessionId, ready = true, onInitialPositioned, className = '', children, ...props }, forwardedRef) {
  const viewport = useRef<HTMLDivElement | null>(null), positioned = useRef(false);
  const initial = useRef(onInitialPositioned); initial.current = onInitialPositioned;
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const updateEdges = () => {
      node.toggleAttribute('data-overflow-start', node.scrollLeft > 1);
      node.toggleAttribute('data-overflow-end', node.scrollLeft + node.clientWidth < node.scrollWidth - 1);
    };
    let watched: Element | null = null;
    const childrenObserved = new Set<Element>();
    const reveal = () => {
      node.style.setProperty('--session-tab-width', `${node.clientWidth}px`);
      // Earlier tabs can change width after fonts/titles load even when the
      // selected tab remains capped at exactly the same width.
      for (const child of childrenObserved) if (child.parentElement !== node) { resize?.unobserve(child); childrenObserved.delete(child); }
      for (const child of node.children) if (!childrenObserved.has(child)) { childrenObserved.add(child); resize?.observe(child); }
      const tab = activeSessionId ? node.querySelector<HTMLElement>(`[data-session-tab-id="${CSS.escape(activeSessionId)}"]`) : null;
      if (tab !== watched) { if (watched) resize?.unobserve(watched); watched = tab; if (tab) resize?.observe(tab); }
      if (ready && tab && node.clientWidth > 0) {
        const bounds = node.getBoundingClientRect(), item = tab.getBoundingClientRect();
        const left = bounds.left + 8, right = bounds.right - 8;
        const delta = item.width > right - left || item.left < left ? item.left - left : item.right > right ? item.right - right : 0;
        // A new swipe supersedes any previous navigation immediately. Never use
        // scrollIntoView here: it can also pan ancestors and the mobile page.
        if (Math.abs(delta) > .5) node.scrollLeft += delta;
        if (!positioned.current) { positioned.current = true; initial.current?.(); }
      }
      updateEdges();
    };
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(reveal);
    resize?.observe(node);
    const mutation = new MutationObserver(reveal); mutation.observe(node, { childList: true, subtree: true });
    reveal();
    node.addEventListener('scroll', updateEdges, { passive: true });
    return () => { resize?.disconnect(); mutation.disconnect(); node.removeEventListener('scroll', updateEdges); };
  }, [activeSessionId, ready]);
  return <div {...props} ref={node => {
    viewport.current = node;
    if (typeof forwardedRef === 'function') forwardedRef(node); else if (forwardedRef) forwardedRef.current = node;
  }} data-session-tab-scroll className={`session-tab-scroll scrollbar-hidden flex h-full min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden whitespace-nowrap ${className}`} style={{ ...props.style, touchAction: 'pan-x', overscrollBehaviorX: 'contain' }}>{children}</div>;
});
