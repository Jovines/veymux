import type { CollaborationPaneBinding } from './collaborationRouting.js';

/** Recheck inside the actual input queue, immediately before paste and submit. */
export async function validateSharedChatTarget(pinned: CollaborationPaneBinding, allowed: () => boolean,
  inspect: () => Promise<{ state: string; pane?: (Partial<CollaborationPaneBinding> & { isShell?: boolean }) | null }>,
  validateRecovered?: () => Promise<void>): Promise<void> {
  await validateRecovered?.();
  if (!allowed()) throw new Error('SHARED_CHAT_AUTHORIZATION_UNAVAILABLE');
  const observed = await inspect(), current = observed.pane;
  if (observed.state !== 'ready' || !current || current.isShell || !current.agentSlug || current.agentSlug !== pinned.agentSlug
    || current.serverPid !== pinned.serverPid || current.sessionId !== pinned.sessionId || current.paneId !== pinned.paneId || current.panePid !== pinned.panePid) throw new Error('SHARED_CHAT_AGENT_UNAVAILABLE');
}
