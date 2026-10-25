import { createPortal } from 'react-dom';
import { MessageCircle, Share2, TerminalSquare } from 'lucide-react';
import { useSessionViewMode } from './sessionViewMode';
import { openSessionShare } from '../../federation/accessEvents';
import { useSessionCapabilities } from '../../federation/ShareAccessContext';
import { useChatModeEntry } from './useChatModeEntry';
import { acknowledgeSessionModes } from './sessionModeOnboarding';
import { SessionChatUnreadBadge, useSessionChatUnreadCount } from './SessionChatUnreadBadge';
/** Lives in the existing navigation row, available in either view and with IME open. */
export function SessionModeSwitch({ sessionId, compact = false, onActivate, share = true, shareSessionIds }: { sessionId: string; compact?: boolean; onActivate?: () => void; share?: boolean; shareSessionIds?: string[] }) {
  const [mode, setMode, syncError, clearError] = useSessionViewMode(sessionId);
  const capabilities = useSessionCapabilities();
  const entry = useChatModeEntry(sessionId, () => setMode('chat'));
  const unread = useSessionChatUnreadCount(sessionId);
  const label = mode === 'chat' ? '切换到终端' : `切换到对话${unread ? `，${unread} 条未读消息` : ''}`;
  const shareLabel = shareSessionIds && shareSessionIds.length > 1 ? '分享此分屏' : '分享这个会话';
  const Icon = mode === 'chat' ? TerminalSquare : MessageCircle;
  return <>{share && capabilities.has('session.share') && <button type="button" aria-label={shareLabel} title={shareLabel} className={`inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-surface-elevated ${compact ? 'h-full w-7' : 'h-11 w-11 sm:h-8 sm:w-8'}`} onClick={() => openSessionShare(shareSessionIds && shareSessionIds.length > 1 ? { inviteSessionIds: shareSessionIds, viewMode: 'terminal', viewLayout: 'split' } : { inviteSessionId: sessionId, viewMode: mode })}><Share2 size={compact ? 14 : 15} /></button>}<button type="button" aria-label={label} title={label}
    data-session-mode-switch={sessionId} data-session-mode-switch-compact={compact || undefined} disabled={entry.pending} aria-busy={entry.pending} className={`inline-flex shrink-0 items-center justify-center bg-surface-2/60 text-muted-foreground transition hover:bg-surface-elevated hover:text-foreground disabled:opacity-50 ${compact ? 'h-full gap-1 rounded-sm px-1.5 text-[10px]' : 'h-8 gap-1.5 rounded-md border border-border/40 px-2 text-[11px] font-medium'}`}
    onPointerDown={event => event.preventDefault()} onClick={() => {
      acknowledgeSessionModes();
      onActivate?.();
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused.matches('textarea,input,[contenteditable="true"]')) focused.blur();
      if (mode === 'chat') setMode('terminal'); else entry.request();
    }}><Icon size={compact ? 14 : 15} aria-hidden="true" /><span>{mode === 'chat' ? '终端' : '对话'}</span>{mode !== 'chat' && <SessionChatUnreadBadge count={unread} />}</button>{entry.dialog}{syncError && createPortal(<div role="alert" className="fixed inset-x-3 bottom-4 z-toast mx-auto flex max-w-md items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-xs text-foreground shadow-lg"><span className="flex-1">{syncError}</span><button type="button" className="min-h-9 shrink-0 px-2 text-primary" onClick={clearError}>关闭</button></div>, document.body)}</>;
}
