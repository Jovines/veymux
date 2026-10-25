import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageCircle, X } from 'lucide-react';

/** Prefer the main navigation, then the active pane's compact entry. */
export function findTerminalModeHintAnchor(sessionId: string): HTMLButtonElement | undefined {
  const anchors = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-session-mode-switch]')).filter(button => {
    if (button.dataset.sessionModeSwitch !== sessionId || button.disabled || button.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
    const rect = button.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight;
  });
  return anchors.find(button => !button.hasAttribute('data-session-mode-switch-compact')) ?? anchors[0];
}

interface Position { left: number; top: number; arrow: number; above: boolean }
/** Portal outside Swiper and pane stacking contexts; the terminal keeps its entire layout box. */
export function TerminalModeHintBubble({ sessionId, close }: { sessionId: string; close: (reason: 'dismissed' | 'interrupted') => void }) {
  const bounds = useRef<HTMLDivElement>(null), bubble = useRef<HTMLElement>(null);
  const closeRef = useRef(close); closeRef.current = close;
  const [position, setPosition] = useState<Position | null>(null);
  const dismiss = () => {
    const focused = document.activeElement;
    const restore = focused && bubble.current?.contains(focused) ? findTerminalModeHintAnchor(sessionId) : undefined;
    closeRef.current('dismissed');
    restore?.focus();
  };
  useLayoutEffect(() => {
    let anchor: HTMLButtonElement | undefined;
    const update = () => {
      const next = findTerminalModeHintAnchor(sessionId), area = bounds.current, hint = bubble.current;
      if (!next || !area || !hint) { closeRef.current('interrupted'); return; }
      if (next !== anchor) { if (anchor) observer?.unobserve(anchor); anchor = next; observer?.observe(next); }
      const safe = area.getBoundingClientRect(), target = next.getBoundingClientRect(), size = hint.getBoundingClientRect();
      const left = Math.max(safe.left, Math.min(target.right - size.width, safe.right - size.width));
      const above = target.bottom + 8 + size.height > safe.bottom && target.top - 8 - size.height >= safe.top;
      const top = Math.max(safe.top, Math.min(above ? target.top - size.height - 8 : target.bottom + 8, safe.bottom - size.height));
      const arrow = Math.max(14, Math.min(target.left + target.width / 2 - left, size.width - 14));
      const nextPosition = { left: left - safe.left, top: top - safe.top, arrow, above };
      setPosition(previous => previous && Object.keys(nextPosition).every(key => previous[key as keyof Position] === nextPosition[key as keyof Position]) ? previous : nextPosition);
    };
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    if (bounds.current) observer?.observe(bounds.current);
    if (bubble.current) observer?.observe(bubble.current);
    update();
    window.addEventListener('resize', update);
    document.addEventListener('scroll', update, true);
    return () => { observer?.disconnect(); window.removeEventListener('resize', update); document.removeEventListener('scroll', update, true); };
  }, [sessionId]);
  return createPortal(<div data-terminal-mode-hint-layer className="pointer-events-none fixed inset-0 z-chrome-hint preview-safe-area [--preview-safe-area-gap:0.75rem]">
    <div ref={bounds} data-terminal-mode-hint-bounds className="relative h-full w-full">
      <aside ref={bubble} data-terminal-mode-hint aria-label="会话模式说明" className="pointer-events-auto absolute z-10 flex w-72 max-w-full items-start gap-2 rounded-xl border border-border bg-surface p-2 text-xs leading-5 text-muted-foreground shadow-lg"
        style={position ? { left: position.left, top: position.top } : { visibility: 'hidden' }}
        onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); } }}>
        <span aria-hidden="true" className={`absolute h-2 w-2 rotate-45 bg-surface ${position?.above ? '-bottom-1 border-b border-r border-border' : '-top-1 border-l border-t border-border'}`} style={{ left: (position?.arrow ?? 24) - 4 }} />
        <MessageCircle size={14} className="mt-2 shrink-0 text-primary" aria-hidden="true" />
        <p className="min-w-0 flex-1 py-1.5">这个会话也能用普通对话。<br />点<span className="text-foreground">「对话」</span>切换，随时可以切回。</p>
        <button type="button" aria-label="关闭会话模式说明" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8 sm:w-8"
          onPointerDown={event => event.preventDefault()} onClick={dismiss}><X size={14} aria-hidden="true" /></button>
      </aside>
    </div>
  </div>, document.body);
}
