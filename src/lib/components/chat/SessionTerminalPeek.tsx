import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { ArrowLeft, SquareArrowOutUpRight, TerminalSquare, X } from 'lucide-react';
import { useSessionCapabilities } from '../../federation/ShareAccessContext';
import { isFocusTargetAvailable, restoreFocusIfUnclaimed } from '../../utils/focusOwnership';
import { isPhoneDevice, usesTouchTerminalLayout } from '../../utils/touchTerminalLayout';
import { useTerminalPeekIdleClose } from './useTerminalPeekIdleClose';
import { focusKeyboardInput, measureNativePagePan, usesNativeKeyboardLayout } from '../../hooks/nativeKeyboardLayout';
import { useViewportKeyboardState } from '../../hooks/useViewportKeyboardState';

interface PeekContext {
  open: boolean; id: string;
  show: (anchor: HTMLElement) => void;
  toggle: (anchor: HTMLElement, autoClose?: boolean) => void;
  leave: (related: EventTarget | null) => void;
  expand: () => void;
}
export const TerminalPeekContext = createContext<PeekContext | null>(null);

/** An interactive popover, rather than a tooltip or a second terminal client. */
export function TerminalPeekTrigger({ children, className, hoverDelay = 200, label = '查看会话终端' }: { children: ReactNode; className: string; hoverDelay?: number; label?: string }) {
  const peek = useContext(TerminalPeekContext);
  const latestPeek = useRef(peek); latestPeek.current = peek;
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerType = useRef('');
  const cancelHover = useCallback(() => { if (hoverTimer.current !== null) { clearTimeout(hoverTimer.current); hoverTimer.current = null; } }, []);
  useEffect(() => cancelHover, [cancelHover]);
  const available = !!peek;
  useEffect(() => { if (!available) cancelHover(); }, [available, cancelHover]);
  if (!peek) return <div className={className}>{children}</div>;
  return <button type="button" data-terminal-peek-trigger data-terminal-peek-delay={hoverDelay || undefined} aria-label={label} aria-haspopup="dialog" aria-expanded={peek.open} aria-controls={peek.open ? peek.id : undefined}
    className={`${className} text-left transition-colors hover:border-primary/40 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
    onPointerDown={event => { pointerType.current = event.pointerType; cancelHover(); event.preventDefault(); }}
    onPointerEnter={event => {
      if (event.pointerType !== 'mouse' || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
      cancelHover(); const source = event.currentTarget;
      if (!hoverDelay) peek.show(source);
      else hoverTimer.current = setTimeout(() => { hoverTimer.current = null; if (source.isConnected) latestPeek.current?.show(source); }, hoverDelay);
    }}
    onPointerLeave={event => { cancelHover(); if (event.pointerType === 'mouse') peek.leave(event.relatedTarget); }}
    onClick={event => {
      cancelHover();
      // A hover may have opened the mouse preview just before the click. Touch
      // and keyboard activation instead behave as a disclosure toggle.
      const hoverMouse = event.detail > 0 && pointerType.current === 'mouse' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
      if (hoverMouse) peek.show(event.currentTarget); else peek.toggle(event.currentTarget, pointerType.current === 'touch' || pointerType.current === 'pen' || !event.detail && usesTouchTerminalLayout());
    }}>{children}</button>;
}

type PeekBounds = { left: number; top: number; width: number; height: number };
type PeekSize = { width: number; height: number };
type PeekOrigin = { left: number; top: number; paddingTop: number; paddingBottom: number };
const sizeKey = 'termdock:terminal-peek-size';
function readPeekSize(): PeekSize | null {
  try {
    const size = JSON.parse(localStorage.getItem(sizeKey) || 'null');
    return size && Number.isFinite(size.width) && Number.isFinite(size.height)
      && size.width >= 320 && size.height >= 200 ? { width: Math.min(2400, size.width), height: Math.min(1600, size.height) } : null;
  } catch { return null; }
}

export function terminalPeekPosition(anchor: DOMRect, width: number, height: number, bounds: PeekBounds = { left: 0, top: 0, width, height }, preferred: PeekSize | null = null) {
  const margin = 12, gap = 8;
  const left = Math.max(0, bounds.left) + margin, top = Math.max(0, bounds.top) + margin;
  const right = Math.min(width, bounds.left + bounds.width) - margin;
  const bottom = Math.min(height, bounds.top + bounds.height) - margin;
  const above = Math.max(0, anchor.top - top), below = Math.max(0, bottom - anchor.bottom);
  const placement = above >= below ? 'above' : 'below';
  const panelHeight = Math.max(0, Math.min(preferred?.height ?? Math.min(640, Math.max(0, bottom - top) * .8), (placement === 'above' ? above : below) - gap));
  const panelWidth = Math.max(0, Math.min(preferred?.width ?? 1120, right - left));
  const totalHeight = panelHeight + gap;
  return {
    left: Math.max(left, Math.min(anchor.left, right - panelWidth)),
    top: Math.max(top, Math.min(placement === 'above' ? anchor.top - totalHeight : anchor.bottom, bottom - totalHeight)),
    width: panelWidth, height: totalHeight,
    paddingTop: placement === 'below' ? gap : 0,
    paddingBottom: placement === 'above' ? gap : 0,
  };
}

function readPeekBounds(probe: HTMLElement): PeekBounds {
  // Portals bypass #root's padding. Resolve the same shared CSS as the other
  // previews, including env(), max(), native title bars and PWA fallbacks.
  if (!probe.isConnected) document.body.append(probe);
  const style = getComputedStyle(probe);
  // Native focus scrolls the document to reveal the portal's input. Its DOM
  // anchor already includes that displacement; visualViewport offsets are in
  // a different coordinate space and may remain stale during the animation.
  const viewport = usesNativeKeyboardLayout() ? null : window.visualViewport;
  const inset = (value: string) => Math.max(0, Number.parseFloat(value) || 0);
  // Intersect the visual viewport with layout-viewport safe edges. Adding the
  // insets to visualViewport offsets would count them twice during page pan.
  const left = Math.max(viewport?.offsetLeft ?? 0, inset(style.paddingLeft));
  const top = Math.max(viewport?.offsetTop ?? 0, inset(style.paddingTop));
  const right = Math.min(innerWidth - inset(style.paddingRight), (viewport?.offsetLeft ?? 0) + (viewport?.width ?? innerWidth));
  const bottom = Math.min(innerHeight - inset(style.paddingBottom), (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight));
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}
function positionForAnchor(anchor: HTMLElement, preferred: PeekSize | null, origin: PeekOrigin | null, bounds: PeekBounds) {
  // The trigger anchors the preview; the whole safe visible window owns its budget.
  const anchored = terminalPeekPosition(anchor.getBoundingClientRect(), innerWidth, innerHeight, bounds, preferred);
  if (!origin || !preferred) return anchored;
  const left = bounds.left + 12, top = bounds.top + 12;
  const right = Math.min(innerWidth, bounds.left + bounds.width) - 12;
  const bottom = Math.min(innerHeight, bounds.top + bounds.height) - 12;
  const width = Math.max(0, Math.min(preferred.width, right - left));
  const height = Math.max(0, Math.min(preferred.height + origin.paddingTop + origin.paddingBottom, bottom - top));
  return { ...origin, width, height, left: Math.max(left, Math.min(origin.left, right - width)), top: Math.max(top, Math.min(origin.top, bottom - height)) };
}
function resizeSize(position: PeekOrigin, width: number, height: number, bounds: PeekBounds): PeekSize {
  const right = bounds.left + bounds.width - 12;
  const bottom = bounds.top + bounds.height - 12;
  return { width: Math.max(0, Math.min(Math.max(320, width), right - position.left)), height: Math.max(0, Math.min(Math.max(200, height), bottom - position.top - position.paddingTop - position.paddingBottom)) };
}

function positionForInput(anchor: HTMLElement, bounds: PeekBounds) {
  const workspace = anchor.closest('[data-session-workspace]')?.getBoundingClientRect();
  const native = usesNativeKeyboardLayout();
  const pan = native ? Math.max(0, measureNativePagePan()) : 0;
  const left = bounds.left, right = bounds.left + bounds.width;
  // Keep the workspace header stable while native focus moves the footer.
  // The chat composer remains mounted underneath; none of its height is
  // reserved by this temporary terminal input surface.
  const top = Math.max(bounds.top, workspace ? workspace.top + pan : bounds.top);
  // Native input placement follows the real workspace footer, even when
  // innerHeight reports a shorter viewport during keyboard animation. Capping
  // it to that API leaves the underlying composer exposed below the terminal.
  const bottom = native && workspace ? workspace.bottom : Math.min(bounds.top + bounds.height, workspace?.bottom ?? innerHeight);
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top), paddingTop: 0, paddingBottom: 0 };
}

export function useSessionTerminalPeek({ enabled, name, expand }: { enabled: boolean; name: string; expand: () => void }) {
  const capabilities = useSessionCapabilities();
  const available = enabled && capabilities.has('session.terminal-view');
  const id = useId();
  const [safeAreaProbe] = useState(() => {
    const node = document.createElement('div'); node.className = 'preview-safe-area';
    node.setAttribute('aria-hidden', 'true');
    node.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none';
    return node;
  });
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [engaged, setEngaged] = useState(false);
  const [terminalInputFocused, setTerminalInputFocused] = useState(false);
  const [touchOpened, setTouchOpened] = useState(false);
  const [position, setPosition] = useState<ReturnType<typeof terminalPeekPosition> | null>(null);
  const [preferredSize, setPreferredSize] = useState(readPeekSize);
  const resizing = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const sizeDraft = useRef<PeekSize | null>(null);
  const resizeOrigin = useRef<PeekOrigin | null>(null);
  // Portal into one stable host. Moving this host preserves the full terminal
  // component, its controller, connection, input node and toolbar state.
  const [host] = useState(() => { const node = document.createElement('div'); node.className = 'h-full min-h-0 w-full [&[data-peek=true]_[data-mobile-keyboard]]:transition-none'; node.dataset.sessionTerminalHost = 'true'; return node; });
  const normalSlot = useRef<HTMLDivElement | null>(null), panel = useRef<HTMLDivElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const open = available && !!anchor;
  const openRef = useRef(open); openRef.current = open;
  const phone = isPhoneDevice();
  const keyboard = useViewportKeyboardState({ enabled: open && phone });
  // Pointer down also starts scrolling; even focus alone can be a hardware
  // keyboard. Expansion requires all three independently observed facts.
  const inputExpanded = open && phone && keyboard.isOpen && terminalInputFocused && capabilities.has('session.input');
  const close = useCallback((restore = true) => {
    const focused = document.activeElement;
    const restoreTarget = restore && focused instanceof Node && host.contains(focused) ? previousFocus.current : null;
    setAnchor(null); setEngaged(false); setTerminalInputFocused(false);
    if (restoreTarget?.isConnected) requestAnimationFrame(() => {
      restoreFocusIfUnclaimed(restoreTarget, host);
    });
  }, [host]);
  const idleSeconds = useTerminalPeekIdleClose(panel, open && touchOpened, close);
  const show = useCallback((source: HTMLElement) => {
    if (!available) return;
    const size = readPeekSize() ?? preferredSize;
    if (!openRef.current) {
      setTouchOpened(false);
      resizeOrigin.current = null;
      setPreferredSize(size);
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setEngaged(false);
      setTerminalInputFocused(false);
    }
    setPosition(positionForAnchor(source, size, resizeOrigin.current, readPeekBounds(safeAreaProbe)));
    setAnchor(source);
  }, [available, preferredSize, safeAreaProbe]);
  const toggle = useCallback((source: HTMLElement, autoClose = false) => {
    if (openRef.current && anchor === source) close(); else { show(source); setTouchOpened(autoClose); }
  }, [anchor, close, show]);
  const inside = useCallback((target: EventTarget | null) => target instanceof Node && (!!anchor?.contains(target) || !!panel.current?.contains(target)), [anchor]);
  const leave = useCallback((target: EventTarget | null) => { if (!inputExpanded && !resizing.current && !inside(target)) close(); }, [inputExpanded, inside, close]);
  const attachNormal = useCallback((node: HTMLDivElement | null) => { normalSlot.current = node; if (node && !openRef.current) node.append(host); }, [host]);
  const attachPeek = useCallback((node: HTMLDivElement | null) => {
    // The preview must measure its final toolbar height on its first frame.
    host.dataset.peek = String(!!node);
    if (node) node.append(host); else normalSlot.current?.append(host);
  }, [host]);
  const expandTerminal = () => { close(false); expand(); };
  const returnToChat = () => {
    const editor = anchor?.closest('[data-session-workspace]')?.querySelector<HTMLElement>('[data-session-chat] [role="textbox"]');
    // This explicit action restores the native editing session in the same
    // gesture, after revealing the original editor with its draft intact.
    flushSync(() => close(false));
    if (isFocusTargetAvailable(editor)) focusKeyboardInput(editor);
  };
  useEffect(() => { if (!available) close(false); }, [available, close]);
  useLayoutEffect(() => () => { host.remove(); safeAreaProbe.remove(); }, [host, safeAreaProbe]);
  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const positionAtAnchor = () => {
      if (!anchor.isConnected) return;
      const rect = anchor.getBoundingClientRect();
      if (!inputExpanded && !host.contains(document.activeElement) && (rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth)) { close(); return; }
      const bounds = readPeekBounds(safeAreaProbe);
      const next = inputExpanded ? positionForInput(anchor, bounds) : positionForAnchor(anchor, preferredSize, resizeOrigin.current, bounds);
      setPosition(current => current && Object.keys(next).every(key => current[key as keyof typeof next] === next[key as keyof typeof next]) ? current : next);
    };
    positionAtAnchor();
    const safeAreaChanges = new MutationObserver(positionAtAnchor);
    safeAreaChanges.observe(document.documentElement, { attributes: true });
    const observer = new ResizeObserver(positionAtAnchor);
    observer.observe(anchor); if (anchor.parentElement) observer.observe(anchor.parentElement);
    const workspace = anchor.closest('[data-session-workspace]'); if (workspace) observer.observe(workspace);
    window.addEventListener('resize', positionAtAnchor);
    window.visualViewport?.addEventListener('resize', positionAtAnchor);
    window.visualViewport?.addEventListener('scroll', positionAtAnchor);
    document.addEventListener('scroll', positionAtAnchor, true);
    return () => { observer.disconnect(); safeAreaChanges.disconnect(); window.removeEventListener('resize', positionAtAnchor); window.visualViewport?.removeEventListener('resize', positionAtAnchor); window.visualViewport?.removeEventListener('scroll', positionAtAnchor); document.removeEventListener('scroll', positionAtAnchor, true); };
  }, [open, anchor, close, preferredSize, safeAreaProbe, host, inputExpanded]);
  useEffect(() => {
    if (!open) return;
    const move = (event: PointerEvent) => { if (!inputExpanded && !resizing.current && event.pointerType === 'mouse' && !inside(event.target)) close(); };
    const outside = (event: PointerEvent) => { if (!resizing.current && !inside(event.target)) close(); };
    // Touch release emits pointerout/leave with no related target; only a
    // mouse leaving the window should dismiss an open preview.
    const windowLeave = (event: PointerEvent) => { if (!resizing.current && event.pointerType === 'mouse' && !event.relatedTarget) close(); };
    const blur = () => close();
    document.addEventListener('pointermove', move, true); document.addEventListener('pointerdown', outside, true); document.addEventListener('pointerout', windowLeave);
    window.addEventListener('blur', blur);
    return () => { document.removeEventListener('pointermove', move, true); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('pointerout', windowLeave); window.removeEventListener('blur', blur); };
  }, [open, inside, close, inputExpanded]);
  // Hover only reveals the canvas. Explicit terminal interaction enables its
  // existing input gate synchronously, before that very pointer/wheel event.
  const engage = () => { if (!engaged && capabilities.has('session.input')) flushSync(() => setEngaged(true)); };
  useLayoutEffect(() => {
    if (!open) return;
    // The terminal's stable portal keeps its React ancestry in the workspace;
    // use its DOM host for capture when it has moved into the popover.
    const interact = () => { if (openRef.current) engage(); };
    const syncInputFocus = (event: FocusEvent) => {
      const input = event.type === 'focusout' ? event.relatedTarget : event.target;
      setTerminalInputFocused(input instanceof HTMLTextAreaElement && input.matches('[data-terminal-input-anchor]') && host.contains(input));
    };
    host.addEventListener('focusin', syncInputFocus, true); host.addEventListener('focusout', syncInputFocus, true);
    host.addEventListener('pointerdown', interact, true); host.addEventListener('wheel', interact, true); host.addEventListener('focusin', interact, true);
    return () => { host.removeEventListener('pointerdown', interact, true); host.removeEventListener('wheel', interact, true); host.removeEventListener('focusin', interact, true); host.removeEventListener('focusin', syncInputFocus, true); host.removeEventListener('focusout', syncInputFocus, true); };
  });
  return {
    host, attachNormal,
    open,
    interactive: open && engaged && capabilities.has('session.input'),
    context: available ? { open, id, show, toggle, leave, expand: expandTerminal } : null,
    popover: open && position ? createPortal(<div ref={panel} style={usesNativeKeyboardLayout() ? { ...position, left: position.left + window.scrollX, top: position.top + window.scrollY } : position} data-terminal-peek data-terminal-peek-input-expanded={inputExpanded || undefined} id={id} role="dialog" aria-label="会话终端预览" aria-modal="false"
      className={`${usesNativeKeyboardLayout() ? 'absolute' : 'fixed'} z-menu-panel box-border`} onPointerLeave={event => { if (event.pointerType === 'mouse') leave(event.relatedTarget); }}>
      <section className={`relative z-10 flex h-full min-h-0 flex-col overflow-hidden bg-[var(--chrome-bg)] text-foreground ${inputExpanded ? '' : 'rounded-xl border border-border shadow-2xl'}`}>
        <header className={`flex shrink-0 items-center gap-2 border-b border-border/60 text-[11px] text-muted-foreground ${inputExpanded ? 'h-8 px-1.5' : 'terminal-peek-header h-9 pl-3 pr-1.5'}`}>{!inputExpanded && <><TerminalSquare size={13} /><span className="min-w-0 flex-1 truncate" title={name}>{name}</span></>}
          {idleSeconds !== null && <span data-terminal-peek-countdown={idleSeconds} title="操作后保持展开，可手动收起" className="inline-flex h-6 shrink-0 items-center rounded-md border border-[rgb(var(--warning-rgb)/0.4)] bg-[rgb(var(--warning-rgb)/0.15)] px-1.5 text-[11px] font-medium tabular-nums text-[var(--warning)]">{idleSeconds} 秒后收起</span>}
          <div className={`flex shrink-0 items-center gap-0.5 ${inputExpanded ? 'w-full justify-between' : ''}`}>
            <button type="button" aria-label="在完整会话中打开终端" title="在完整会话中打开终端" className={`terminal-peek-action inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-surface-2 hover:text-foreground ${inputExpanded ? 'order-last' : ''}`} onClick={expandTerminal}><SquareArrowOutUpRight size={14} /></button>
            <button type="button" aria-label={inputExpanded ? '返回对话' : '关闭终端预览'} title={inputExpanded ? '返回对话' : '关闭预览'} className={`inline-flex shrink-0 items-center justify-center gap-1 rounded-md hover:bg-surface-2 hover:text-foreground ${inputExpanded ? 'h-8 whitespace-nowrap px-2' : 'terminal-peek-action h-7 w-7'}`} onPointerDown={event => event.preventDefault()} onClick={() => inputExpanded ? returnToChat() : close()}>{inputExpanded ? <><ArrowLeft size={14} /><span>返回对话</span></> : <X size={14} />}</button>
          </div>
        </header>
        <div ref={attachPeek} className="min-h-0 flex-1" />
      </section>
      {!inputExpanded && <button type="button" aria-label="调整终端预览大小" title="拖动调整大小，方向键微调" style={{ bottom: position.paddingBottom + 1 }} className="absolute right-0.5 z-20 flex h-5 w-5 touch-none cursor-nwse-resize items-end justify-end p-1 text-muted-foreground/50 hover:text-foreground focus-visible:text-foreground"
        onPointerDown={event => {
          event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
          resizeOrigin.current = { left: position.left, top: position.top, paddingTop: position.paddingTop, paddingBottom: position.paddingBottom };
          resizing.current = { x: event.clientX, y: event.clientY, width: position.width, height: position.height - 8 };
          sizeDraft.current = null;
        }}
        onPointerMove={event => {
          const start = resizing.current; if (!start) return;
          const next = resizeSize(resizeOrigin.current!, start.width + event.clientX - start.x, start.height + event.clientY - start.y, readPeekBounds(safeAreaProbe));
          sizeDraft.current = next; setPreferredSize(next);
        }}
        onPointerUp={event => {
          if (!resizing.current) return;
          resizing.current = null; event.currentTarget.releasePointerCapture(event.pointerId);
          try { if (sizeDraft.current) localStorage.setItem(sizeKey, JSON.stringify(sizeDraft.current)); } catch { /* Keep this window's preference. */ }
        }}
        onPointerCancel={() => { resizing.current = null; }}
        onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          resizeOrigin.current = { left: position.left, top: position.top, paddingTop: position.paddingTop, paddingBottom: position.paddingBottom };
          const next = resizeSize(resizeOrigin.current, position.width + (event.key === 'ArrowRight' ? 24 : event.key === 'ArrowLeft' ? -24 : 0), position.height - 8 + (event.key === 'ArrowDown' ? 24 : event.key === 'ArrowUp' ? -24 : 0), readPeekBounds(safeAreaProbe));
          setPreferredSize(next); try { localStorage.setItem(sizeKey, JSON.stringify(next)); } catch { /* In-memory preference. */ }
        }}><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true"><path d="m3 13 10-10m-5 10 5-5m-1 5 1-1" /></svg></button>}
    </div>, document.body) : null,
  };
}
