import { useCallback, useRef, type RefObject } from 'react';

const blocks = 'p, pre, li, img, [data-chat-message-actions]';
export interface ChatReadingPosition { messageId: string; block: number; offset: number }

/** One owner for history prepend and late content sizing. Keep the visible DOM
 * block at its screen offset, adding a delta to the live scroll position rather
 * than restoring an old scrollTop or counting changes below the reader. */
export function useChatScrollAnchor(root: RefObject<HTMLDivElement>) {
  const anchor = useRef<{ node: Element; offset: number }>();
  const capture = useCallback(() => {
    const container = root.current;
    if (!container?.clientHeight) return;
    const bounds = container.getBoundingClientRect();
    const row = [...container.querySelectorAll('[data-chat-viewport-row]')].find(node => {
      const rect = node.getBoundingClientRect();
      return rect.height > 0 && rect.bottom > bounds.top && rect.top < bounds.bottom;
    });
    const candidates = row ? [...row.querySelectorAll(blocks)] : [];
    const block = candidates.find(node => {
      const rect = node.getBoundingClientRect();
      return rect.height > 0 && rect.bottom > bounds.top;
    });
    const node = block ?? row;
    anchor.current = node ? { node, offset: node.getBoundingClientRect().top - bounds.top } : undefined;
    const messageId = row?.getAttribute('data-chat-viewport-row');
    return messageId && anchor.current ? { messageId, block: block ? candidates.indexOf(block) : -1, offset: anchor.current.offset } : undefined;
  }, [root]);
  const restore = useCallback(() => {
    const container = root.current, saved = anchor.current;
    if (!container?.clientHeight || !saved || !container.contains(saved.node)) return;
    const delta = saved.node.getBoundingClientRect().top - container.getBoundingClientRect().top - saved.offset;
    if (Math.abs(delta) > 0.5) container.scrollTop += delta;
  }, [root]);
  const restorePosition = useCallback((position: ChatReadingPosition) => {
    const container = root.current;
    if (!container?.clientHeight) return false;
    const row = container.querySelector(`[data-chat-viewport-row="${CSS.escape(position.messageId)}"]`);
    if (!row) return false;
    const node = row.querySelectorAll(blocks)[position.block] ?? row;
    container.scrollTop += node.getBoundingClientRect().top - container.getBoundingClientRect().top - position.offset;
    anchor.current = { node, offset: node.getBoundingClientRect().top - container.getBoundingClientRect().top };
    return true;
  }, [root]);
  return { capture, restore, restorePosition };
}
