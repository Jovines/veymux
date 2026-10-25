import { useEffect, type RefObject } from 'react';
import { getTermdockDesktopBridge } from '../../desktop/nativeBridge';
import { WORKSPACE_VISIBILITY_EVENT } from '../../services/workspaceHost';
import { isKeyboardLayerSource, useKeyboardLayerOpen } from '../../hooks/useKeyboardLayer';
/** Only actual viewport exposure counts. Overscan, preload, and background
 * rendering never acknowledge a message. This is local viewing, not a receipt. */
export function useChatMessageViewed(node: RefObject<HTMLElement>, root: RefObject<HTMLDivElement> | undefined, enabled: boolean, onViewed: () => void) {
  // Portaled previews do not change intersection geometry. Shared layer changes
  // cancel partial exposure and start a fresh interval when the preview closes.
  const keyboardLayerOpen = useKeyboardLayerOpen();
  useEffect(() => {
    const element = node.current, container = root?.current;
    if (!enabled || !element || !container || typeof IntersectionObserver === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | undefined, exposed = false, finished = false;
    const cancel = () => { clearTimeout(timer); timer = undefined; };
    const available = () => !document.hidden && isKeyboardLayerSource(element)
      && (!getTermdockDesktopBridge() || document.hasFocus());
    const check = () => {
      if (!exposed || !available()) { cancel(); return; }
      if (timer || finished) return;
      timer = setTimeout(() => { timer = undefined; if (exposed && available()) { finished = true; onViewed(); } }, 600);
    };
    const observer = new IntersectionObserver(entries => {
      const entry = entries.find(entry => entry.target === element);
      if (!entry) return;
      const required = Math.min(entry.boundingClientRect.height * .5, container.clientHeight * .5, 160);
      exposed = entry.isIntersecting && required > 0 && entry.intersectionRect.height >= required;
      check();
    }, { root: container, threshold: [0, Math.min(.5, (Math.min(container.clientHeight * .5, 160)) / Math.max(1, element.getBoundingClientRect().height))] });
    observer.observe(element);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check); window.addEventListener('blur', cancel);
    window.addEventListener(WORKSPACE_VISIBILITY_EVENT, check);
    return () => {
      cancel(); observer.disconnect(); document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check); window.removeEventListener('blur', cancel);
      window.removeEventListener(WORKSPACE_VISIBILITY_EVENT, check);
    };
  }, [node, root, enabled, onViewed, keyboardLayerOpen]);
}
