// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
const socket = vi.hoisted(() => ({ readyState: 1, close: vi.fn(), onmessage: null as null | ((event: { data: string }) => void) }));
vi.mock('../federation/browserIntegration', () => ({ secureSocket: () => socket }));
import { subscribeClientState, __resetClientStateSyncForTests } from './clientStateSync';
afterEach(__resetClientStateSyncForTests);
it('delivers shared chat attention over the existing control channel without requiring a terminal viewport', () => {
  const listener = vi.fn(); subscribeClientState(listener);
  const event = { type: 'chat-attention', sessions: [{ sessionId: 'background', index: { conversationId: 'chat', messageIds: ['new'], viewedMessageIds: [] as string[] } }] };
  socket.onmessage!({ data: JSON.stringify(event) }); expect(listener).toHaveBeenLastCalledWith(event);
  event.sessions[0].index.viewedMessageIds = ['new'];
  socket.onmessage!({ data: JSON.stringify(event) }); expect(listener).toHaveBeenLastCalledWith(event);
});
