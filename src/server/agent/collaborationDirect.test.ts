import express from 'express';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { CollaborationStore } from './collaborationStore.js';
import { collaborationRoutes } from './collaborationRoutes.js';
import { CollaborationDeliveryWorker } from './collaborationDeliveryWorker.js';
import { markEncryptedRequest } from '../federation/requestContext.js';
import { sessionChatRoutes } from './sessionChatRoutes.js';

const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).reverse().forEach(close => close()));
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'td-direct-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'messages.json'), store = new CollaborationStore(file);
  const locals = new Set(['a', 'b', 'c', 'private']);
  store.save({ name: 'A team', sessionIds: ['a', 'c'] });
  store.save({ name: 'B team', sessionIds: ['b', 'private'] });
  const deliver = vi.fn(() => ({}));
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { markEncryptedRequest(req, 'device', req.headers['test-scope'] !== 'shared'); next(); });
  app.use('/collab', collaborationRoutes({ store, resolveSession: input => locals.has(String(input.session)) ? String(input.session) : null,
    resolveContact: id => locals.has(id) ? id : null, deliver, diagnoseRoute: async id => ({ sessionId: id }) }));
  app.use(sessionChatRoutes({ store, deliver, resolve: id => locals.has(id) ? { sessionId: id, agent: { slug: 'test' } } : undefined,
    canMention: (source, target, groupId) => source !== target && (!groupId ? locals.has(target) : store.groupsForSession(source).some(group => group.id === groupId && group.sessionIds.includes(target))) }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  cleanup.push(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = async (path: string, body?: unknown, shared = false) => {
    const response = await fetch(`${url}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: {
      'Content-Type': 'application/json', ...(shared ? { 'test-scope': 'shared', 'x-termdock-full-service': '1' } : {}),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  const send = (target = 'b', extra = {}) => request('/collab/send', { session: 'a', targetSessionId: target, message: 'Please help', idempotency_key: 'direct-request', ...extra });
  return { store, file, locals, deliver, request, send };
}

it('sends and replies across groups without exposing membership or a terminal snapshot, including after restart', async () => {
  const f = await fixture(), before = structuredClone(f.store.list());
  const sent = await f.send(); expect(sent.status).toBe(200);
  expect(sent.body.messages[0]).toMatchObject({ direct: true, fromSessionId: 'a', toSessionId: 'b' });
  const id = sent.body.message_id;
  expect((await f.send()).body.message_id).toBe(id);
  expect((await f.send('b', { message: 'Changed' })).status).toBe(409);
  expect(f.store.list()).toEqual(before);
  expect(f.store.groupsForSession('a').flatMap(g => g.sessionIds)).not.toContain('b');
  expect(await f.request('/collab/route/b?session=a')).toMatchObject({ status: 403 });
  expect(await f.request(`/collab/message/${id}?session=c`)).toMatchObject({ status: 404 });
  const restarted = new CollaborationStore(f.file);
  expect(restarted.page('b').messages).toContainEqual(expect.objectContaining({ id, direct: true }));
  restarted.setSnapshot(id, 'Private screen');
  expect(restarted.receipt(id).snapshot).toBeNull();
  const reply = await f.request('/collab/reply', { session: 'b', messageId: id, content: 'Done', response_kind: 'result', idempotency_key: 'direct-reply' });
  expect(reply.status).toBe(200);
  expect(reply.body.thread_id).toBe(sent.body.thread_id);
  expect(f.store.receipt(id).result_ids).toEqual([reply.body.message_id]);
  expect(f.store.list()).toEqual(before);
  f.locals.delete('a');
  expect(await f.request('/collab/reply', { session: 'b', messageId: id, content: 'Later' })).toMatchObject({ status: 403 });
});

it('preserves explicit group boundaries and refuses unknown, remote and self targets atomically', async () => {
  const f = await fixture(), group = f.store.groupsForSession('a')[0];
  expect(await f.send('b', { group_id: group.id })).toMatchObject({ status: 400, body: { code: 'GROUP_NOT_FOUND' } });
  for (const target of ['missing', 'remote:https%3A%2F%2Fpeer.test:b', 'a']) expect((await f.send(target)).status).toBe(403);
  expect(await f.request('/collab/send', { session: 'a', toSessionIds: ['b', 'missing'], message: 'No partial send' })).toMatchObject({ status: 403 });
  expect(f.store.snapshotMessages()).toHaveLength(0);
  const grouped = await f.send('c');
  expect(grouped.status).toBe(200); expect(grouped.body.messages[0].direct).toBeUndefined();
  const fanout = await f.request('/collab/send', { session: 'a', toSessionIds: ['b', 'c'], message: 'Direct broadcast' });
  expect(fanout.status).toBe(200);
  expect(fanout.body.messages).toHaveLength(2);
  expect(fanout.body.messages.every((m: { direct?: boolean }) => m.direct)).toBe(true);
  expect(fanout.body.messages[0].fanOutIds).toEqual(['c']);
});

it('rejects scoped collaboration access and forged mention envelopes before queueing', async () => {
  const f = await fixture();
  expect(await f.request('/collab/send', { session: 'a', targetSessionId: 'private', message: 'Attack' }, true)).toMatchObject({ status: 403, body: { code: 'SESSION_SCOPE_DENIED' } });
  expect(await f.request('/collab/directory?session=a', undefined, true)).toMatchObject({ status: 403 });
  const content = (target: string, groupId = '') => `请联系\n\n\`\`\`termdock-context\n${JSON.stringify({ attachments: [], mentions: [{ sessionId: target, groupId, groupName: '', name: target }] })}\n\`\`\``;
  const post = (text: string, shared = false) => f.request('/a/chat', { content: text, requestId: 'request-00000000001' }, shared);
  // Same- and cross-group mentions both remain closed in single/multi-session shares.
  for (const target of ['b', 'c', 'private']) expect(await post(content(target), true)).toMatchObject({ status: 403 });
  expect(await post(content('missing'))).toMatchObject({ status: 403 });
  expect(await post(content('b', f.store.groupsForSession('a')[0].id))).toMatchObject({ status: 403 });
  expect(f.store.snapshotMessages()).toHaveLength(0); expect(f.deliver).not.toHaveBeenCalled();
  expect((await post(content('b'))).status).toBe(200);
  expect((await post('Normal shared chat', true)).status).toBe(409); // existing request key, different body
  expect(await f.request('/a/chat', { content: 'Normal shared chat', requestId: 'request-00000000002' }, true)).toMatchObject({ status: 200 });
});

it('never captures a direct recipient screen, including shell confirmation and disconnected delivery', async () => {
  const f = await fixture(), sent = await f.send();
  const capture = vi.fn(async () => 'Private screen'), write = vi.fn(async () => undefined);
  const resolve = vi.fn(async () => ({ state: 'offline' as const, reason: 'Disconnected' }));
  const worker = new CollaborationDeliveryWorker({ store: f.store, peers: () => [], isLocal: () => true,
    resolve, onError: error => { throw error; }, snapshotDelayMs: 0 });
  await worker.run('b'); expect(write).not.toHaveBeenCalled();
  expect(f.store.receipt(sent.body.message_id).status).toBe('pending');
  resolve.mockResolvedValue({ state: 'ready', isShell: true, capture, write } as never);
  await worker.run('b'); expect(capture).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  f.store.confirmShell(sent.body.message_id);
  await worker.run('b'); expect(write).toHaveBeenCalledTimes(1); expect(capture).not.toHaveBeenCalled();
  expect(f.store.receipt(sent.body.message_id)).toMatchObject({ status: 'delivered', snapshot: null });
});
