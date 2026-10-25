import { initializeSessionViewMode } from '../components/chat/sessionViewMode';
import { useTerminalStore } from '../stores/useTerminalStore';

/** Open the view containing the unread result, including the active session. */
export function switchToAttentionSession(sessionId: string): void {
  const session = useTerminalStore.getState().sessions.get(sessionId);
  if (session?.chatAttention?.unreadIds.length) {
    initializeSessionViewMode(sessionId, 'chat');
  }
  window.dispatchEvent(new CustomEvent('switch-terminal-session', { detail: sessionId }));
}
