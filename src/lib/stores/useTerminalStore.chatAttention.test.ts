// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { useTerminalStore } from './useTerminalStore';
import { clearChatViewingUpdates } from '../components/chat/chatViewedMessages';
const service = vi.hoisted(() => ({ id: 'service-a' }));
vi.mock('../federation/browserIntegration', () => ({ savedConnection: () => ({ targetPeerId: service.id }), currentSecureClient: () => undefined }));
const index = { conversationId: 'conversation', messageIds: ['a', 'b'] };
const store = () => useTerminalStore.getState();
const attention = () => store().sessions.get('chat')!.chatAttention!;
afterEach(() => { clearChatViewingUpdates(); vi.unstubAllGlobals(); store().clearAllTerminalSessions(); localStorage.clear(); vi.restoreAllMocks(); service.id = 'service-a'; });
it('tracks individual unseen replies, without treating an exposed later reply as earlier replies viewed', () => {
  store().setSessionChatMode('chat', true); store().setSessionChatIndex('chat', index);
  expect(attention().unreadIds).toEqual(['a', 'b']);
  store().markChatMessagesViewed('chat', ['b']);
  expect(attention().unreadIds).toEqual(['a']);
  store().clearAgentNeedsReview('chat'); expect(attention().unreadIds).toEqual(['a']);
  store().setSessionChatIndex('chat', { ...index, messageIds: ['a', 'b', 'c'] });
  expect(attention().unreadIds).toEqual(['a', 'c']);
  store().markChatMessagesViewed('chat', ['unknown']); expect(attention().unreadIds).toEqual(['a', 'c']);
});
it('persists only message identifiers and survives refresh and backend rebinding', () => {
  store().setSessionChatMode('chat', true); store().setSessionChatIndex('chat', index); store().markChatMessagesViewed('chat', ['a']);
  store().setTerminalSession('chat', { sessionId: 'new-backend', cols: 80, rows: 24 });
  expect(attention().mode).toBe(true); expect(attention().unreadIds).toEqual(['b']);
  store().clearAllTerminalSessions(); store().setSessionChatIndex('chat', index);
  expect(attention().unreadIds).toEqual(['b']);
  expect(localStorage.getItem('termdock:chat-viewed:service-a:chat:conversation')).toBe('["a"]');
});
it('isolates service and conversation identity and drops pruned history from attention', () => {
  store().setSessionChatIndex('chat', index); store().markChatMessagesViewed('chat', ['a', 'b']);
  store().clearAllTerminalSessions(); service.id = 'service-b'; store().setSessionChatIndex('chat', index);
  expect(attention().unreadIds).toEqual(['a', 'b']);
  store().setSessionChatIndex('chat', { conversationId: 'replacement', messageIds: ['a'] });
  expect(attention().unreadIds).toEqual(['a']);
  store().setSessionChatIndex('chat', { conversationId: 'replacement', messageIds: [] });
  expect(attention().unreadIds).toEqual([]);
});
it('keeps in-memory acknowledgements if storage is unavailable and does not infer Agent state', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable'); });
  store().setSessionChatIndex('chat', index); store().markChatMessagesViewed('chat', ['b']);
  store().setSessionChatIndex('chat', { ...index, messageIds: ['a', 'b', 'c'] });
  expect(attention().unreadIds).toEqual(['a', 'c']);
  expect(store().sessions.get('chat')?.agentStatus).toBeNull();
  expect(store().sessions.get('chat')?.agentActivity).toBe(0);
});

it('uses server acknowledgement, propagates a remote read, and ignores older read snapshots', async () => {
  const { waitFor } = await import('@testing-library/react');
  let acknowledge!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { acknowledge = resolve; })));
  const shared = { ...index, viewedMessageIds: [] as string[] };
  store().setSessionChatIndex('chat', shared);
  store().markChatMessagesViewed('chat', ['a']);
  expect(attention().unreadIds).toEqual(['a', 'b']);
  await waitFor(() => expect(acknowledge).toBeTypeOf('function'));
  acknowledge(Response.json({ chatIndex: { ...shared, viewedMessageIds: ['a'] } }));
  await waitFor(() => expect(attention().unreadIds).toEqual(['b']));
  store().setSessionChatIndex('chat', { ...shared, viewedMessageIds: ['a', 'b'] });
  expect(attention().unreadIds).toEqual([]);
  store().setSessionChatIndex('chat', shared);
  expect(attention().unreadIds).toEqual([]);
  store().setSessionChatIndex('chat', { ...shared, messageIds: ['a', 'b', 'new'], viewedMessageIds: ['a', 'b'] });
  expect(attention().unreadIds).toEqual(['new']);
  clearChatViewingUpdates(); vi.unstubAllGlobals();
});

it('retries an offline viewing acknowledgement and updates a second independent client', async () => {
  const { waitFor } = await import('@testing-library/react');
  vi.resetModules();
  const { useTerminalStore: otherClient } = await import('./useTerminalStore');
  const shared = { ...index, viewedMessageIds: [] as string[] };
  store().setSessionChatIndex('chat', shared); otherClient.getState().setSessionChatIndex('chat', shared);
  let online = false;
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (!online) throw new Error('offline');
    const acknowledged = { ...shared, viewedMessageIds: ['b'] };
    otherClient.getState().setSessionChatIndex('chat', acknowledged);
    return Response.json({ chatIndex: acknowledged });
  }));
  store().markChatMessagesViewed('chat', ['b']);
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  expect(attention().unreadIds).toEqual(['a', 'b']);
  expect(otherClient.getState().sessions.get('chat')?.chatAttention?.unreadIds).toEqual(['a', 'b']);
  online = true; window.dispatchEvent(new Event('online'));
  await waitFor(() => expect(attention().unreadIds).toEqual(['a']));
  expect(otherClient.getState().sessions.get('chat')?.chatAttention?.unreadIds).toEqual(['a']);
  otherClient.getState().clearAllTerminalSessions(); clearChatViewingUpdates(); vi.unstubAllGlobals();
});

it('backs off an acknowledgement the server defers instead of looping immediately', async () => {
  const { waitFor } = await import('@testing-library/react');
  const shared = { ...index, viewedMessageIds: [] as string[] };
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ chatIndex: shared })));
  store().setSessionChatIndex('chat', shared); store().markChatMessagesViewed('chat', ['a']);
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(fetch).toHaveBeenCalledOnce();
  expect(attention().unreadIds).toEqual(['a', 'b']);
});
