import { savedConnection, currentSecureClient } from '../../federation/browserIntegration';
import type { SessionChatIndex } from '../../../server/shared/sessionChatAttention';
function key(sessionId: string, conversationId: string) {
  return `termdock:chat-viewed:${savedConnection()?.targetPeerId || location.origin}:${sessionId}:${conversationId}`;
}
export function viewedChatMessages(sessionId: string, index: SessionChatIndex): Set<string> {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(key(sessionId, index.conversationId)) || '[]');
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []);
  } catch { return new Set(); }
}
export function saveViewedChatMessages(sessionId: string, index: SessionChatIndex, ids: Set<string>) {
  try { localStorage.setItem(key(sessionId, index.conversationId), JSON.stringify(index.messageIds.filter(id => ids.has(id)))); } catch { /* In-memory attention still works. */ }
}

// Shared acknowledgements travel through the page's encrypted fetch wrapper.
// Local IDs are only a retry/migration outbox when the server supports this.
interface ViewingUpdate {
  sessionId: string; conversationId: string; scope: string; ids: Set<string>;
  apply: (index: SessionChatIndex) => void; running: boolean; failures: number;
  timer?: ReturnType<typeof setTimeout>;
}
const updates = new Map<string, ViewingUpdate>();
const currentScope = () => savedConnection()?.targetPeerId || location.origin;
async function flushUpdate(key: string, entry: ViewingUpdate) {
  if (entry.running || !entry.ids.size || currentScope() !== entry.scope) return;
  clearTimeout(entry.timer); entry.timer = undefined; entry.running = true;
  const ids = [...entry.ids].slice(0, 100);
  const client = currentSecureClient();
  try {
    const response = await fetch(`/api/terminal/${encodeURIComponent(entry.sessionId)}/chat/viewed`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: entry.conversationId, messageIds: ids }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      if ([400, 401, 403, 404, 409].includes(response.status)) { updates.delete(key); return; }
      throw new Error('Viewing acknowledgement unavailable');
    }
    const payload = await response.json() as { chatIndex?: SessionChatIndex };
    if (updates.get(key) !== entry) return;
    if (currentScope() !== entry.scope || currentSecureClient() !== client) throw new Error('Viewing context changed');
    if (!payload.chatIndex || payload.chatIndex.conversationId !== entry.conversationId || !Array.isArray(payload.chatIndex.viewedMessageIds)) throw new Error('Invalid viewing acknowledgement');
    const acknowledged = new Set(payload.chatIndex.viewedMessageIds), retained = new Set(payload.chatIndex.messageIds);
    let deferred = false;
    for (const id of ids) {
      if (acknowledged.has(id) || !retained.has(id)) entry.ids.delete(id);
      else deferred = true;
    }
    // A reply may still be streaming or have changed during this request.
    // Keep it pending without creating a zero-delay acknowledgement loop.
    entry.failures = deferred ? entry.failures + 1 : 0;
    if (currentScope() === entry.scope) entry.apply(payload.chatIndex);
  } catch { entry.failures++; }
  finally {
    entry.running = false;
    if (updates.get(key) === entry) {
      if (!entry.ids.size) updates.delete(key);
      else entry.timer = setTimeout(() => { entry.timer = undefined; void flushUpdate(key, entry); }, entry.failures ? Math.min(30000, 1000 * 2 ** Math.min(5, entry.failures - 1)) : 0);
    }
  }
}
export function syncViewedChatMessages(sessionId: string, index: SessionChatIndex, ids: string[], apply: (index: SessionChatIndex) => void) {
  if (!ids.length || index.viewedMessageIds === undefined) return;
  const scope = currentScope(), key = `${scope}:${sessionId}:${index.conversationId}`;
  let entry = updates.get(key);
  if (!entry) { entry = { sessionId, conversationId: index.conversationId, scope, ids: new Set(), apply, running: false, failures: 0 }; updates.set(key, entry); }
  entry.apply = apply;
  for (const id of ids) entry.ids.add(id);
  if (!entry.running && !entry.timer) { const update = entry; entry.timer = setTimeout(() => { update.timer = undefined; void flushUpdate(key, update); }, 0); }
}
export function clearChatViewingUpdates() {
  for (const entry of updates.values()) clearTimeout(entry.timer);
  updates.clear();
}
if (typeof window !== 'undefined') {
  const retry = () => { for (const [key, entry] of updates) { if (currentScope() === entry.scope) void flushUpdate(key, entry); } };
  window.addEventListener('online', retry);
  window.addEventListener('termdock:secure-ready', retry);
  window.addEventListener('auth:unauthorized', clearChatViewingUpdates);
}
