import { useTerminalStore } from '../../stores/useTerminalStore';

export function useSessionChatUnreadCount(sessionId: string): number {
  return useTerminalStore(state => state.sessions.get(sessionId)?.chatAttention?.unreadIds.length ?? 0);
}
export function SessionChatUnreadBadge({ count }: { count: number }) {
  return count > 0 ? <span aria-hidden="true" data-chat-unread-count={count} style={{ color: 'var(--warning)', backgroundColor: 'rgb(var(--warning-rgb) / 0.15)' }} className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-medium tabular-nums">{count > 99 ? '99+' : count}</span> : null;
}
