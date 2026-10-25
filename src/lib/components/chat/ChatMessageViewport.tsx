import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useCallback } from 'react';
import { useChatMessageViewed } from './useChatMessageViewed';
/** Loaded pages stay in the native scroll flow. Visibility observes exposure
 * only; scrolling must not replace prose or interactive state with estimates. */
export function ChatMessageViewport({ id, root, nearby, children, unread, viewing, onViewed, located }: {
  id: string; root?: RefObject<HTMLDivElement>;
  nearby?: Set<string>; children: ReactNode;
  unread?: boolean; viewing?: boolean; onViewed?: (id: string) => void;
  located?: boolean;
}) {
  const node = useRef<HTMLDivElement>(null);
  const [highlight, setHighlight] = useState(false);
  const viewed = useCallback(() => { setHighlight(true); onViewed?.(id); }, [onViewed, id]);
  useChatMessageViewed(node, root, !!unread && !!viewing, viewed);
  useEffect(() => { if (!highlight) return; const timer = setTimeout(() => setHighlight(false), 2000); return () => clearTimeout(timer); }, [highlight]);
  useEffect(() => {
    const container = root?.current, element = node.current;
    if (!container || !element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      if (!container.clientHeight) return;
      const entry = entries.find(item => item.target === element);
      if (!entry) return;
      if (entry.isIntersecting) nearby?.add(id); else nearby?.delete(id);
    }, { root: container, rootMargin: `${container.clientHeight}px 0px` });
    observer.observe(element);
    return () => observer.disconnect();
  }, [root, nearby, id]);
  return <div ref={node} data-chat-viewport-row={id} data-chat-located={located || undefined} data-chat-unread={unread || undefined} data-chat-highlight={highlight || undefined} className={unread || highlight ? 'chat-message-attention' : undefined}>
    {children}
  </div>;
}
