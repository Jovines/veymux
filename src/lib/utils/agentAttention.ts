import type { AgentStatus, TuiProgressReport } from '../terminal/types';
import type { SessionChatAttention } from '../../server/shared/sessionChatAttention';

/** Chat-specific activity falls back to Terminal rules until content exists. */
export function isChatActivityEnabled(attention?: SessionChatAttention): boolean {
  return !!attention?.mode && (attention.hasMessages ?? !!attention.index?.messageIds.length);
}

export function sessionNeedsReview(state?: { agentNeedsReview?: boolean; chatAttention?: SessionChatAttention }): boolean {
  const chat = state?.chatAttention;
  return !!chat?.unreadIds.length || (chat?.mode && chat.index ? false : !!state?.agentNeedsReview);
}

/** Native terminal progress is a visual fallback, not an Agent phase. Idle
 * and acknowledged done states must not hide a new native progress report. */
export function shouldShowTuiLoading(state?: {
  agentStatus: AgentStatus | null;
  agentNeedsReview?: boolean;
  tuiProgress?: TuiProgressReport | null;
  chatAttention?: SessionChatAttention;
}): boolean {
  const progress = state?.tuiProgress?.state;
  return (progress === 'set' || progress === 'indeterminate')
    && state?.agentStatus !== 'working'
    && state?.agentStatus !== 'waiting'
    && !(state?.chatAttention?.mode && state.chatAttention.index ? false : state?.agentNeedsReview);
}

export interface AgentAttentionSession {
  sessionId: string;
  agentStatus: AgentStatus | null;
  agentNeedsReview?: boolean;
  chatAttention?: SessionChatAttention;
}

export function needsAgentAttention(session: AgentAttentionSession): boolean {
  return session.agentStatus === 'waiting' || sessionNeedsReview(session);
}

export function isAgentRunning(session: AgentAttentionSession): boolean {
  return session.agentStatus === 'working';
}

function getNextMatchingSessionId(
  sessions: readonly AgentAttentionSession[],
  activeSessionId: string | null,
  predicate: (session: AgentAttentionSession) => boolean,
  direction: 'next' | 'previous' = 'next',
): string | null {
  if (sessions.length === 0) return null;

  const activeIndex = activeSessionId
    ? sessions.findIndex((session) => session.sessionId === activeSessionId)
    : -1;

  for (let offset = 1; offset <= sessions.length; offset += 1) {
    const delta = direction === 'next' ? offset : -offset;
    const index = (activeIndex + delta + sessions.length) % sessions.length;
    const session = sessions[index];
    if (session && predicate(session)) return session.sessionId;
  }

  return null;
}

/**
 * Pick the next attention session in the same stable order used by the terminal
 * store. The search starts after the active session and wraps once, so repeated
 * clicks cycle through parallel tasks instead of repeatedly selecting the first.
 */
export function getNextAttentionSessionId(
  sessions: readonly AgentAttentionSession[],
  activeSessionId: string | null,
  direction: 'next' | 'previous' = 'next',
): string | null {
  return getNextMatchingSessionId(sessions, activeSessionId, needsAgentAttention, direction);
}

/** Pick the next actively running agent session and wrap at the end. */
export function getNextRunningSessionId(
  sessions: readonly AgentAttentionSession[],
  activeSessionId: string | null,
): string | null {
  return getNextMatchingSessionId(sessions, activeSessionId, isAgentRunning);
}
