import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CollaborationStore } from './collaborationStore';
import { sessionChatHistory, sessionChatIndex, watchSessionChatIndices } from './sessionChatHistory';

const directories: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dir = fs.mkdtempSync(join(tmpdir(), 'veymux-chat-attention-')); directories.push(dir);
  const file = join(dir, 'collaboration.json'), store = new CollaborationStore(file);
  const group = store.ensureSessionChat('agent');
  const [request] = store.send({ groupId: group.id, fromSessionId: null, toSessionIds: ['agent'], kind: 'ask', content: '历史问题',
    integrationOrigin: { integrationId: 'web-user', source: 'session-chat' }, idempotencyKey: 'original-request', threadId: 'web-user' });
  const reply = store.storeIntegrationReply(request.id, 'agent', '历史回复', { idempotencyKey: 'old-reply' });
  const unread = (target: CollaborationStore) => { const index = sessionChatIndex(target, 'agent'); return index.messageIds.filter(id => !index.viewedMessageIds?.includes(id)); };
  const legacy = (transform: (document: any) => void = () => {}) => {
    const document = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete document.sessionChatAttentionBaseline; transform(document);
    fs.writeFileSync(file, JSON.stringify(document));
  };
  return { store, file, group, request, reply, unread, legacy };
}

it.each([false, true])('adopts pre-upgrade replies as history without inventing views (view tracking already introduced: %s)', tracked => {
  const f = fixture();
  f.legacy(document => { if (tracked) document.sessionChatViewed = {}; else delete document.sessionChatViewed; });
  const upgraded = new CollaborationStore(f.file);
  expect(f.unread(upgraded)).toEqual([]);
  expect(upgraded.sessionChatViewedIds(f.group.id)).toEqual([]);
  expect(sessionChatHistory(upgraded, 'agent').messages.map(message => message.id)).toEqual([f.request.id, f.reply.id]);
  expect(upgraded.getMessage(f.reply.id)).toEqual(f.reply);
  // Initialization is durable even when no user sends or acknowledges anything.
  expect(JSON.parse(fs.readFileSync(f.file, 'utf8')).sessionChatAttentionBaseline).toEqual([f.reply.id]);
  expect(f.unread(new CollaborationStore(f.file))).toEqual([]);
});

it('keeps new replies unread across restarts and publishes the same state to background clients', () => {
  const f = fixture(); f.legacy();
  const upgraded = new CollaborationStore(f.file), publish = vi.fn();
  const stop = watchSessionChatIndices(upgraded, () => new Set(['agent']), publish);
  expect(publish).toHaveBeenLastCalledWith([{ sessionId: 'agent', index: { conversationId: f.group.id, messageIds: [], viewedMessageIds: [] } }]);
  const reply = upgraded.storeIntegrationReply(f.request.id, 'agent', '升级后的新回复', { idempotencyKey: 'new-reply' });
  expect(f.unread(upgraded)).toEqual([reply.id]);
  expect(publish).toHaveBeenLastCalledWith([{ sessionId: 'agent', index: { conversationId: f.group.id, messageIds: [reply.id], viewedMessageIds: [] } }]);
  const restarted = new CollaborationStore(f.file);
  expect(f.unread(restarted)).toEqual([reply.id]);
  restarted.markSessionChatViewed('agent', f.group.id, [reply.id]);
  expect(f.unread(new CollaborationStore(f.file))).toEqual([]);
  expect(restarted.sessionChatViewedIds(f.group.id)).toEqual([reply.id]);
  stop();
});

it('starts new conversations with normal unread tracking and preserves existing viewing facts on migration', () => {
  const f = fixture();
  expect(f.unread(new CollaborationStore(f.file))).toEqual([f.reply.id]);
  f.store.markSessionChatViewed('agent', f.group.id, [f.reply.id]);
  f.legacy();
  const upgraded = new CollaborationStore(f.file);
  expect(upgraded.sessionChatViewedIds(f.group.id)).toEqual([f.reply.id]);
  expect(upgraded.getMessage(f.reply.id)?.readAt).toBeNull();
});

it('keeps attention enabled after clearing the store and creating a new conversation', () => {
  const f = fixture(); f.legacy();
  const upgraded = new CollaborationStore(f.file); upgraded.clear();
  const group = upgraded.ensureSessionChat('agent');
  const [request] = upgraded.send({ groupId: group.id, fromSessionId: null, toSessionIds: ['agent'], kind: 'ask', content: '新问题',
    integrationOrigin: { integrationId: 'web-user', source: 'session-chat' }, idempotencyKey: 'after-clear', threadId: 'web-user' });
  const reply = upgraded.storeIntegrationReply(request.id, 'agent', '新回复', { idempotencyKey: 'after-clear-reply' });
  expect(f.unread(new CollaborationStore(f.file))).toEqual([reply.id]);
});

it('retains attention for an unfinished stream and recognizes legacy conversation bindings', () => {
  const f = fixture();
  const body = (text: string) => JSON.stringify({ text, ui: `root = TextContent("${text}")` });
  const stream = f.store.storeIntegrationReply(f.request.id, 'agent', body('生成中'), { idempotencyKey: 'stream-start', metadata: { openui: { version: 2, streaming: true } } });
  f.legacy(document => { delete document.groups[0].sessionChatSessionId; });
  const upgraded = new CollaborationStore(f.file);
  expect(upgraded.getSessionChat('agent')?.id).toBe(f.group.id);
  expect(f.unread(upgraded)).toEqual([stream.id]);
  upgraded.updateIntegrationUIReply(f.request.id, stream.id, 'agent', body('完成'), { idempotencyKey: 'stream-end', metadata: { openui: { version: 2, streaming: false } } }, 0);
  expect(f.unread(new CollaborationStore(f.file))).toEqual([stream.id]);
});

it('refuses to serve a migration whose baseline could not be saved', () => {
  const f = fixture(); f.legacy();
  vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('disk unavailable'); });
  expect(() => new CollaborationStore(f.file)).toThrow('disk unavailable');
  expect(JSON.parse(fs.readFileSync(f.file, 'utf8')).sessionChatAttentionBaseline).toBeUndefined();
});
