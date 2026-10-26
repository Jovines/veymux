import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Copy, Eraser, History, ListTodo, MoreHorizontal, Share2, SlidersHorizontal } from 'lucide-react';
import { useSessionCapabilities } from '../../federation/ShareAccessContext';
import { currentSecureClient } from '../../federation/browserIntegration';
import { openSessionShare } from '../../federation/accessEvents';
import { getActiveKeyboardLayer } from '../../hooks/useKeyboardLayer';
import { useTouchScrollBoundary } from '../../hooks/useTouchScrollBoundary';
import { useTerminalStore } from '../../stores/useTerminalStore';
import { insertSessionDraft } from '../../terminal/insertSessionDraft';
import { writeTerminalClipboardText } from '../../terminal/clipboardText';
import { TODO_GUIDANCE } from '../../todos/guidance';
import { useAppFeedback, type Feedback } from '../ui/AppFeedback';

/** A small nonmodal menu: pointer use preserves the chat editor and its IME. */
export function ChatComposerActions({ sessionId, active, canWrite, onOpen, onMediaSettings, mediaBusy = false, onClearDisplay, onRestoreDisplay, clearDisplayDisabled = false }: { sessionId: string; active: boolean; canWrite: boolean; onOpen?: () => void; onMediaSettings?: () => void; mediaBusy?: boolean; onClearDisplay?: () => void; onRestoreDisplay?: () => void; clearDisplayDisabled?: boolean }) {
  const capabilities = useSessionCapabilities();
  const canInsert = capabilities.has('todo.guidance') && canWrite;
  const canCopy = capabilities.has('session.owner-menu');
  const canShare = capabilities.has('session.share');
  const canMedia = canWrite && !!onMediaSettings;
  const canClear = capabilities.has('session.chat-clear') && !!onClearDisplay;
  const available = canInsert || canCopy || canShare || canMedia || canClear;
  const cwd = useTerminalStore(state => state.sessions.get(sessionId)?.cwd);
  const owner = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null), probe = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [inserting, setInserting] = useState(false), [feedback, setFeedback] = useState<Feedback | null>(null);
  const pointerActivation = useRef(false);
  const keyboardOpen = useRef<'first' | 'last' | null>(null), layer = useRef(getActiveKeyboardLayer());
  const current = useRef({ sessionId, active, available }); current.current = { sessionId, active, available };
  const mounted = useRef(true), id = useId();
  useAppFeedback(feedback);
  useTouchScrollBoundary(menu, open);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (!feedback) return; const timer = setTimeout(() => setFeedback(null), 4000); return () => clearTimeout(timer); }, [feedback]);
  useEffect(() => { if (!active || !available) setOpen(false); }, [active, available]);
  useEffect(() => setOpen(false), [sessionId]);
  const close = (restore = false) => {
    const focused = menu.current?.contains(document.activeElement);
    setOpen(false);
    if (restore && focused) trigger.current?.focus({ preventScroll: true });
  };
  const reveal = (focus: 'first' | 'last' | null = null) => {
    if (!active || !available) return;
    keyboardOpen.current = focus; layer.current = getActiveKeyboardLayer(); onOpen?.(); setOpen(true);
  };
  useLayoutEffect(() => {
    if (!open || !owner.current || !menu.current || !probe.current) return;
    const host = owner.current.closest('[data-session-chat]');
    const place = () => {
      const anchor = owner.current?.getBoundingClientRect(), panel = menu.current, scope = host?.getBoundingClientRect();
      if (!anchor || !panel || !scope || !probe.current) return;
      const safe = getComputedStyle(probe.current);
      const px = (value: string) => Math.max(0, Number.parseFloat(value) || 0);
      // The shared chat layout already compensates native page pan. Use its
      // actual clipping box, without deriving a second keyboard/pan offset.
      const top = Math.max(scope.top, px(safe.paddingTop)) + 8;
      const left = Math.max(scope.left, px(safe.paddingLeft)) + 8;
      const right = Math.min(scope.right, innerWidth - px(safe.paddingRight)) - 8;
      const width = Math.max(0, Math.min(232, right - left));
      panel.style.width = `${width}px`;
      panel.style.left = `${Math.max(left, Math.min(anchor.left, right - width)) - anchor.left}px`;
      panel.style.maxHeight = `${Math.max(0, anchor.top - top - 6)}px`;
    };
    place();
    if (keyboardOpen.current) {
      const choices = menu.current.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
      choices[keyboardOpen.current === 'last' ? choices.length - 1 : 0]?.focus({ preventScroll: true }); keyboardOpen.current = null;
    }
    const observer = new ResizeObserver(place); observer.observe(owner.current); if (host) observer.observe(host);
    const insets = new MutationObserver(place); insets.observe(document.documentElement, { attributes: true });
    window.addEventListener('resize', place); window.visualViewport?.addEventListener('resize', place); window.visualViewport?.addEventListener('scroll', place);
    return () => { observer.disconnect(); insets.disconnect(); window.removeEventListener('resize', place); window.visualViewport?.removeEventListener('resize', place); window.visualViewport?.removeEventListener('scroll', place); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !owner.current?.contains(event.target)) setOpen(false); };
    const key = (event: KeyboardEvent) => {
      if (getActiveKeyboardLayer() !== layer.current || event.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
      else if (event.key === 'Tab') close(true);
      else if (event.target instanceof Element && !owner.current?.contains(event.target) && event.target.closest('input,textarea,[contenteditable="true"]') && event.key.length === 1) close();
    };
    document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', key, true); };
  }, [open]);
  const scope = () => {
    const client = currentSecureClient(), target = sessionId;
    return () => mounted.current && current.current.active && current.current.available && current.current.sessionId === target && currentSecureClient() === client && !client?.closed;
  };
  const insert = async () => {
    if (!active || !canInsert || inserting) return;
    const isCurrent = scope(); close(); setFeedback(null); setInserting(true);
    try {
      const result = await insertSessionDraft(sessionId, ` ${TODO_GUIDANCE} `);
      if (isCurrent() && result === 'failed') setFeedback({ message: '提示词未插入，请稍后重试。', tone: 'error' });
    } finally { if (mounted.current) setInserting(false); }
  };
  const copy = async () => {
    if (!active || !canCopy || !cwd) return;
    const isCurrent = scope(); close(true); setFeedback(null);
    const ok = await writeTerminalClipboardText(cwd, isCurrent);
    if (isCurrent()) setFeedback(ok ? { message: '当前目录已复制', tone: 'success' } : { message: '未能复制当前目录，请重试。', tone: 'error' });
  };
  if (!available) return null;
  const item = 'flex min-h-11 w-full shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs text-foreground transition hover:bg-surface-2 focus:bg-surface-2 focus:outline-none disabled:opacity-40';
  return <div ref={owner} className="relative shrink-0" data-chat-no-swipe>
    <button ref={trigger} type="button" aria-label="更多会话操作" title="更多会话操作" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} disabled={!active}
      className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
      onPointerDown={event => { pointerActivation.current = true; event.preventDefault(); }} onClick={() => { const pointer = pointerActivation.current; pointerActivation.current = false; if (open) close(!pointer); else reveal(pointer ? null : 'first'); }}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') pointerActivation.current = false; if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); reveal(event.key === 'ArrowDown' ? 'first' : 'last'); } }}><MoreHorizontal size={18} /></button>
    {open && <>
      <div ref={probe} aria-hidden="true" className="preview-safe-area pointer-events-none invisible fixed left-0 top-0 h-0 w-0" />
      <div ref={menu} id={id} role="menu" aria-label="会话操作" data-chat-no-swipe className="absolute bottom-full z-30 mb-1.5 flex max-h-64 w-56 flex-col overflow-y-auto overscroll-contain rounded-xl border border-border bg-surface p-1.5 shadow-xl"
        onKeyDown={event => {
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          const choices = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')], index = choices.indexOf(document.activeElement as HTMLButtonElement);
          choices[event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length]?.focus({ preventScroll: true });
        }}>
        {canInsert && <button type="button" role="menuitem" className={item} disabled={inserting} onPointerDown={event => event.preventDefault()} onClick={() => void insert()}><ListTodo size={15} />{inserting ? '正在插入…' : '插入待办提示'}</button>}
        {canCopy && <button type="button" role="menuitem" className={item} disabled={!cwd} title={!cwd ? '当前目录暂不可用' : undefined} onPointerDown={event => event.preventDefault()} onClick={() => void copy()}><Copy size={15} />复制当前目录</button>}
        {canShare && <button type="button" role="menuitem" className={item} onPointerDown={event => event.preventDefault()} onClick={() => { if (active && capabilities.has('session.share')) { close(); openSessionShare({ inviteSessionId: sessionId, viewMode: 'chat' }); } }}><Share2 size={15} />分享这个会话</button>}
        {canMedia && <button type="button" role="menuitem" className={item} disabled={mediaBusy} onPointerDown={event => event.preventDefault()} onClick={() => { if (active && canWrite) { close(); onMediaSettings?.(); } }}><SlidersHorizontal size={15} />媒体压缩设置</button>}
        {canClear && onRestoreDisplay && <button type="button" role="menuitem" className={item} onPointerDown={event => event.preventDefault()} onClick={() => { if (active && capabilities.has('session.chat-clear')) { close(); onRestoreDisplay(); } }}><History size={15} />恢复旧记录</button>}
        {canClear && <button type="button" role="menuitem" className={item} disabled={clearDisplayDisabled} title="仅清空当前设备的显示，保留记录和 Agent 上下文" onPointerDown={event => event.preventDefault()} onClick={() => { if (active && !clearDisplayDisabled && capabilities.has('session.chat-clear')) { close(); onClearDisplay?.(); } }}><Eraser size={15} />清空显示</button>}
      </div>
    </>}
  </div>;
}
