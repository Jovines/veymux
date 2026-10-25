import type { CollaborationStore } from './collaborationStore.js';
import type { SessionChatIndex } from '../shared/sessionChatAttention.js';
/** Use the exact same visibility rule for history and attention metadata. */
export function sessionChatHistory(store: CollaborationStore, sessionId: string) {
  const group = store.getSessionChat(sessionId);
  const history = group ? store.listGroupMessages(group.id) : [];
  const originals = new Map(history.map(message => [message.id, message]));
  const messages = history.filter(message => {
    if (message.integrationOrigin?.source === 'session-chat') return true;
    const original = message.toPrincipalId && message.replyTo ? originals.get(message.replyTo) : null;
    return original?.groupId === group?.id && message.toPrincipalId === original?.integrationOrigin?.integrationId && original?.integrationOrigin?.source === 'session-chat';
  });
  return { group, messages };
}
export function sessionChatIndex(store: CollaborationStore, sessionId: string): SessionChatIndex {
  const { group, messages } = sessionChatHistory(store, sessionId);
  const baseline = new Set(store.sessionChatBaselineIds());
  return { conversationId: group?.id ?? '', messageIds: messages.filter(message => message.toPrincipalId && !baseline.has(message.id)).map(message => message.id), viewedMessageIds: group ? store.sessionChatViewedIds(group.id) : [] };
}
/** No browser polling or additional session inventory. Body/form updates do
 * not rebroadcast unchanged identifiers. Disposed with the terminal stream. */
export function watchSessionChatIndex(store: CollaborationStore, sessionId: string, send: (index: SessionChatIndex) => void) {
  let previous = '';
  const publish = () => {
    const index = sessionChatIndex(store, sessionId), key = JSON.stringify(index);
    if (key === previous) return;
    previous = key; send(index);
  };
  publish();
  return store.subscribe(publish);
}

/** Full-service control clients also need attention for unmounted terminals. */
export function watchSessionChatIndices(store: CollaborationStore, allowed: () => Set<string>, send: (sessions: { sessionId: string; index: SessionChatIndex }[]) => void) {
  const previous = new Map<string, string>();
  const publish = () => {
    const ids = allowed(), changed: { sessionId: string; index: SessionChatIndex }[] = [];
    for (const sessionId of store.sessionChatSessionIds()) {
      if (!ids.has(sessionId)) continue;
      const index = sessionChatIndex(store, sessionId), key = JSON.stringify(index);
      if (previous.get(sessionId) === key) continue;
      previous.set(sessionId, key); changed.push({ sessionId, index });
    }
    if (changed.length) send(changed);
  };
  publish(); return store.subscribe(publish);
}
