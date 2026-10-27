import { useEffect, type RefObject } from 'react';
import { useTerminalStore } from '../../stores/useTerminalStore';
import { getVeymuxDesktopBridge } from '../../desktop/nativeBridge';
import { isWorkspaceActive, WORKSPACE_VISIBILITY_EVENT } from '../../services/workspaceHost';
import { isFocusTargetAvailable } from '../../utils/focusOwnership';

/** A visible conversation acknowledges local attention just like opening its
 * terminal. This never sends input or claims that the Agent read a message. */
export function useSessionChatReview(sessionId: string, enabled: boolean, content: RefObject<HTMLElement>) {
  const pending = useTerminalStore(state => {
    const session = state.sessions.get(sessionId), progress = session?.tuiProgress;
    if (session?.chatAttention?.index && session.chatAttention.unreadIds.length) return false;
    return !!session?.agentNeedsReview || progress?.source === 'osc7501' && progress.state === 'done' && !progress.reviewed;
  });
  useEffect(() => {
    if (!enabled || !pending) return;
    const acknowledge = () => {
      if (document.hidden || !isWorkspaceActive() || !isFocusTargetAvailable(content.current)
        || getVeymuxDesktopBridge() && !document.hasFocus()) return;
      useTerminalStore.getState().clearAgentNeedsReview(sessionId);
    };
    acknowledge();
    document.addEventListener('visibilitychange', acknowledge);
    window.addEventListener('focus', acknowledge);
    window.addEventListener(WORKSPACE_VISIBILITY_EVENT, acknowledge);
    return () => {
      document.removeEventListener('visibilitychange', acknowledge);
      window.removeEventListener('focus', acknowledge);
      window.removeEventListener(WORKSPACE_VISIBILITY_EVENT, acknowledge);
    };
  }, [sessionId, enabled, pending, content]);
}
