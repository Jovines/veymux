import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { preloadChatHistory } from './chatHistoryRequest';
import { ChatLoading } from './ChatLoading';
import { TerminalModeHint } from './TerminalModeHint';
import { useSessionViewMode } from './sessionViewMode';
import { sharedSessionContextMenu, useSessionCapabilities } from '../../federation/ShareAccessContext';
import { TerminalPeekContext, useSessionTerminalPeek } from './SessionTerminalPeek';
import { useTerminalStore } from '../../stores/useTerminalStore';
import { KeyboardPanelLayoutOwnedContext } from '../layout/keyboardPanelLayout';
const loadChat = () => import('./SessionChatView').then(m => ({ default: m.SessionChatView }));
const Chat = lazy(loadChat);
/** The existing session menu owns view actions; the terminal keeps its full canvas. */
export function SessionWorkspace({ sessionId, name, active, visible = active, terminalReady = false, terminalStartupPending = false, onKeyboardChange, onChatReadyChange, children }: { sessionId: string; name: string; active: boolean; visible?: boolean; terminalReady?: boolean; terminalStartupPending?: boolean; onKeyboardChange?: (open: boolean) => void; onChatReadyChange?: (sessionId: string, ready: boolean | null) => void; children: (terminalVisible: boolean, terminalInteractive: boolean) => ReactNode }) {
  const capabilities = useSessionCapabilities();
  const [mode, setMode] = useSessionViewMode(sessionId, visible);
  useEffect(() => { useTerminalStore.getState().setSessionChatMode(sessionId, mode === 'chat'); }, [sessionId, mode]);
  // A new Agent needs a measured grid and size acknowledgement before its
  // command can run. Retain a layout box behind chat during that handshake.
  const preparingTerminal = mode === 'chat' && terminalStartupPending;
  const peek = useSessionTerminalPeek({ enabled: active && mode === 'chat', name, expand: () => setMode('terminal') });
  const [mountedChat, setMountedChat] = useState(mode === 'chat');
  const [chatReady, setChatReady] = useState(false);
  useEffect(() => {
    if (visible && mode === 'chat') return preloadChatHistory(sessionId);
  }, [visible, mode, sessionId]);
  useEffect(() => {
    // null means this session is displaying its terminal, whose existing
    // stream/content/size readiness checks remain authoritative.
    onChatReadyChange?.(sessionId, mode === 'chat' ? chatReady : null);
    return () => onChatReadyChange?.(sessionId, null);
  }, [sessionId, mode, chatReady, onChatReadyChange]);
  useEffect(() => {
    if (!active || mountedChat) return;
    // Warm code only for the foreground session, after urgent terminal work.
    const warm = () => { void loadChat().catch(() => {}); };
    if (typeof requestIdleCallback === 'function') {
      const idle = requestIdleCallback(warm, { timeout: 3000 });
      return () => cancelIdleCallback(idle);
    }
    const timer = setTimeout(warm, 800);
    return () => clearTimeout(timer);
  }, [active, mountedChat]);
  if (mode === 'chat' && !mountedChat) setMountedChat(true);
  // Attach the retained host to the popover before the terminal's reveal
  // layout effects measure it. Otherwise they still see its hidden slot.
  return <TerminalPeekContext.Provider value={peek.context}>{peek.popover}<div className="relative flex h-full min-h-0 flex-col" data-session-workspace={sessionId} data-session-active={active} data-session-input-ready={capabilities.has('todo.guidance') && (mode === 'chat' ? chatReady : terminalReady)}
    onContextMenuCapture={capabilities.has('session.owner-menu') ? undefined : sharedSessionContextMenu}
    onContextMenu={event => {
      if (!active || window.matchMedia('(pointer: coarse)').matches) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('a, button, input[type="file"]') || window.getSelection()?.toString()) return;
      if (target instanceof HTMLTextAreaElement && target.selectionStart !== target.selectionEnd) return;
      event.preventDefault(); event.stopPropagation();
      window.dispatchEvent(new CustomEvent('veymux:session-context-menu', { detail: { sessionId, x: event.clientX, y: event.clientY } }));
    }}>
    <TerminalModeHint sessionId={sessionId} active={active && mode === 'terminal'} ready={terminalReady && !terminalStartupPending} />
    <div ref={peek.attachNormal} aria-hidden={preparingTerminal || undefined} className={`min-h-0 flex-1 ${mode === 'terminal' ? '' : preparingTerminal ? 'pointer-events-none invisible absolute inset-0' : 'hidden'}`} />
    {createPortal(<KeyboardPanelLayoutOwnedContext.Provider value={peek.open}>{children(mode === 'terminal' || peek.open || preparingTerminal, mode === 'terminal' || peek.interactive)}</KeyboardPanelLayoutOwnedContext.Provider>, peek.host)}
    {mountedChat && <div className={`min-h-0 flex-1 ${mode === 'chat' ? '' : 'hidden'}`}><Suspense fallback={<div className="h-full bg-[var(--chrome-bg)] px-4 sm:px-8"><div className="mx-auto max-w-screen-2xl py-5 sm:py-8"><ChatLoading /></div></div>}><Chat sessionId={sessionId} name={name} active={active && mode === 'chat'} visible={visible && mode === 'chat'} terminalLink={false} onKeyboardChange={onKeyboardChange} onReadyChange={setChatReady} onTerminal={() => setMode('terminal')} /></Suspense></div>}
  </div></TerminalPeekContext.Provider>;
}
