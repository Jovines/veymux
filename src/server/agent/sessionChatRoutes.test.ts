import { afterEach, expect, it, vi } from 'vitest';
import express from 'express';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collaborationGroupRoutes } from './collaborationGroupRoutes';
import { collaborationRoutes } from './collaborationRoutes';
import { sessionChatRoutes } from './sessionChatRoutes';
import { CollaborationStore } from './collaborationStore';
import { markEncryptedRequest } from '../federation/requestContext';
const clean: (() => void)[] = [];
afterEach(() => clean.splice(0).reverse().forEach(fn => fn()));
async function fixture(existingFile?: string) {
  const dir = mkdtempSync(join(tmpdir(), 'td-chat-')); clean.push(() => rmSync(dir, { recursive: true, force: true }));
  const filePath = existingFile || join(dir, 'collab.json');
  const store = new CollaborationStore(filePath), deliver = vi.fn(), recover = vi.fn(async (_id: string) => {});
  const app = express(); app.use(express.json());
  // Test-only authentication boundary; never mounted by the product.
  app.use((req, _res, next) => { markEncryptedRequest(req, String(req.headers['test-subject'] || 'alice'), req.headers['test-access'] !== 'scoped', undefined, req.headers['test-chat-only'] === '1'); next(); });
  app.use(sessionChatRoutes({ store, deliver, recover, resolve: id => id === 'agent' ? { sessionId: id, agent: { slug: 'test' } } : id === 'shell' ? { sessionId: id } : undefined }));
  app.use(collaborationGroupRoutes({ store, sessions: () => [{ sessionId: 'agent' }, { sessionId: 'peer' }] }));
  app.use('/collab', collaborationRoutes({ store, resolveSession: () => 'agent', deliver }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); clean.push(() => { server.closeAllConnections(); server.close(); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error(); const base = `http://127.0.0.1:${address.port}`;
  const post = (content: string, requestId = 'request-00000000001', subject = 'alice') => fetch(`${base}/agent/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'test-subject': subject }, body: JSON.stringify({ content, requestId }) });
  const read = (subject = 'alice', scoped = false) => fetch(`${base}/agent/chat`, { headers: { 'test-subject': subject, ...(scoped ? { 'test-access': 'scoped', 'x-termdock-full-service': '1' } : {}) } }).then(r => r.json());
  return { store, deliver, recover, base, post, read, filePath };
}
it('accepts only ordinary restricted-chat messages, rejects control bytes and slash commands, and binds queued delivery to the real subject', async () => {
  const f = await fixture();
  const post = (content: string, requestId: string) => fetch(`${f.base}/agent/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'test-access': 'scoped', 'test-chat-only': '1', 'test-subject': 'restricted-user' }, body: JSON.stringify({ content, requestId }) });
  for (const content of ['/exit', '\u0003exit', '\u001b[200~exit', '\u0004']) expect((await post(content, 'rejected-command-00001')).status).toBe(403);
  expect(f.deliver).not.toHaveBeenCalled();
  const sent = await (await post('请解释当前工作\n第二行', 'ordinary-message-00001')).json();
  expect(f.store.getMessage(sent.id)?.metadata).toEqual({ chatOnly: true, chatSubject: 'restricted-user' });
  expect(f.deliver).toHaveBeenCalledWith('agent');
});
it('persists messages once and shares existing Session history across full-service clients and service reloads', async () => {
  const f = await fixture();
  expect((await fetch(`${f.base}/agent/chat`).then(r => r.json())).messages).toEqual([]);
  const first = await f.post('请帮我解释结果').then(r => r.json());
  expect((await f.post('请帮我解释结果').then(r => r.json())).id).toBe(first.id);
  expect((await f.post('改变内容')).status).toBe(409);
  const original = f.store.getMessage(first.id)!;
  expect(original.integrationOrigin?.source).toBe('session-chat'); expect(original.fromSessionId).toBeNull();
  f.store.storeIntegrationReply(original.id, 'agent', '**完成**\n\n解释正文', { idempotencyKey: 'reply-000000000001', responseKind: 'result' });
  const mine = await fetch(`${f.base}/agent/chat`).then(r => r.json());
  expect(mine.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant']);
  expect(mine.messages[1].content).toContain('解释正文');
  expect((await f.read('bob')).messages).toEqual(mine.messages);
  // Sending identity and deduplication stay unchanged, including retries from older clients.
  const next = await f.post('继续处理', 'request-00000000002', 'bob').then(r => r.json());
  expect((await f.read('alice')).messages.map((m: { id: string }) => m.id)).toEqual([first.id, mine.messages[1].id, next.id]);
  const restarted = await fixture(f.filePath);
  expect((await restarted.read('another-device')).messages).toEqual((await f.read()).messages);
  expect(f.deliver).toHaveBeenCalledWith('agent');
  expect(JSON.stringify(mine)).not.toContain('readAt');
});
it('persists OpenUI replies and versioned form values for authorized clients, with text compatibility and conflict detection', async () => {
  const f = await fixture(), original = await f.post('选择方案').then(response => response.json());
  const ui = 'root = Stack([Text("方案说明")])';
  const reply = f.store.storeIntegrationReply(original.id, 'agent', JSON.stringify({ text: '完整的文字说明', ui }), { idempotencyKey: 'ui-reply', metadata: { openui: { version: 1 } } });
  expect((await f.read('other-device', true)).messages[1]).toMatchObject({ content: '完整的文字说明', ui: { version: 1, code: ui } });
  const save = (revision: number, values: unknown, id = reply.id) => fetch(`${f.base}/agent/chat/${id}/state`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision, values }) });
  const values = { form: { plan: { value: 'A' } } };
  expect(await save(0, values).then(response => response.json())).toEqual({ revision: 1, values });
  expect((await save(0, { plan: 'B' })).status).toBe(409);
  expect((await save(1, {}, original.id)).status).toBe(404);
  expect((await save(1, { nested: JSON.parse('{"__proto__":{"polluted":true}}') })).status).toBe(400);
  const restarted = await fixture(f.filePath);
  expect((await restarted.read()).messages[1].uiState).toEqual({ revision: 1, values });
  f.store.storeIntegrationReply(original.id, 'agent', JSON.stringify({ text: '版本升级仍可阅读', ui }), { idempotencyKey: 'future-ui-reply', metadata: { openui: { version: 99 } } });
  expect((await f.read()).messages[2]).toMatchObject({ content: '版本升级仍可阅读' });
  expect((await f.read()).messages[2].ui).toBeUndefined();
});
it('rejects shell sessions, arbitrary destinations and malformed requests without queuing work', async () => {
  const f = await fixture();
  expect((await fetch(`${f.base}/shell/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'rm -rf', requestId: 'request-00000000001' }) })).status).toBe(409);
  expect((await fetch(`${f.base}/agent/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'test', requestId: 'request-00000000001', sessionId: 'other' }) })).status).toBe(400);
  expect(f.deliver).not.toHaveBeenCalled(); expect(f.store.list()).toEqual([]);
});

it('projects blocked terminal delivery without leaking routing diagnostics to shared viewers', async () => {
  const f = await fixture(), sent = await f.post('请检查结果').then(r => r.json());
  const first = await f.read();
  f.store.recordTransport(sent.id, { relay_online: null, peer_reachable: false, attempt_count: 0,
    next_retry_at: Date.now() + 30000, last_error: 'TMUX_PANE_CHANGED', checked_at: Date.now(), route_state: 'identity-mismatch',
    route_diagnostics: { expected: null, observed: [], truncated: false, recovery: 'confirmation-required', reason: 'NATIVE_IDENTITY_UNCONFIRMED', rebind_command: 'private-debug-command' } });
  const owner = await f.read();
  expect(owner.messages[0]).toMatchObject({ status: 'pending', delivery: { state: 'binding-required', canReconnect: true } });
  expect(owner.revision).not.toBe(first.revision);
  const shared = await f.read('guest', true);
  expect(shared.messages[0].delivery).toEqual({ state: 'binding-required' });
  expect(JSON.stringify(shared)).not.toMatch(/private-debug-command|TMUX_PANE_CHANGED|rebind|route_diagnostics/);
  const update = await fetch(`${f.base}/agent/chat?limit=30&after=${sent.id}`).then(r => r.json());
  expect(update.updates[0].delivery.state).toBe('binding-required');
  f.store.markDelivered([sent.id]);
  const delivered = await f.read();
  expect(delivered.messages[0].status).toBe('delivered');
  expect(delivered.messages[0].delivery).toBeUndefined();
  expect(delivered.revision).not.toBe(owner.revision);
});
it('does not project recovery cards for an active paste, while retaining real interruption feedback', async () => {
  const f = await fixture(), sent = await f.post('正常发送').then(r => r.json());
  for (const stage of ['unknown', 'not_started', 'paste_attempted', 'paste_written', 'submit_attempted', 'submit_written'] as const) {
    f.store.recordTransport(sent.id, { relay_online: null, peer_reachable: true, attempt_count: 1, next_retry_at: null,
      last_error: 'DELIVERY_IN_PROGRESS', checked_at: Date.now(), write_stage: stage });
    expect((await f.read()).messages[0].delivery).toBeUndefined();
    expect((await f.read('shared', true)).messages[0].delivery).toBeUndefined();
  }
  f.store.recordTransport(sent.id, { relay_online: null, peer_reachable: false, attempt_count: 1, next_retry_at: null,
    last_error: 'DELIVERY_OUTCOME_UNCONFIRMED', checked_at: Date.now(), write_stage: 'paste_written' });
  expect((await f.read()).messages[0].delivery).toEqual({ state: 'outcome-unknown', attemptCount: 1 });
  expect((await f.read('shared', true)).messages[0].delivery).toEqual({ state: 'outcome-unknown' });
});
it('lets the owner recover the actual queue head blocking a later chat message, including a non-chat reply', async () => {
  const f = await fixture();
  const group = f.store.save({ name: 'Peers', sessionIds: ['peer', 'agent'] });
  const [head] = f.store.send({ groupId: group.id, fromSessionId: 'peer', toSessionIds: ['agent'], kind: 'message', content: 'private peer reply' });
  f.store.recordTransport(head.id, { relay_online: null, peer_reachable: true, attempt_count: 2, next_retry_at: null,
    last_error: 'TERMINAL_INPUT_ECHO_UNCONFIRMED', checked_at: Date.now(), write_stage: 'probe_attempted' });
  const sent = await f.post('后续消息').then(r => r.json());
  const visible = (await f.read()).messages.find((m: { id: string }) => m.id === sent.id);
  expect(visible.delivery).toMatchObject({ state: 'retrying', blockedBy: { messageId: head.id, attemptCount: 2 } });
  expect(visible.delivery.attemptCount).toBeUndefined();
  const shared = (await f.read('shared', true)).messages.find((m: { id: string }) => m.id === sent.id);
  expect(shared.delivery.blockedBy).toBeUndefined();
  const recover = (blockingMessageId = head.id, attempt = 2, scoped = false) => fetch(`${f.base}/agent/chat/${sent.id}/delivery`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(scoped ? { 'test-access': 'scoped' } : {}) },
    body: JSON.stringify({ action: 'retry', attempt, blockingMessageId }) });
  expect((await recover(head.id, 2, true)).status).toBe(403);
  expect((await recover(sent.id)).status).toBe(409);
  expect((await recover(head.id, 1)).status).toBe(409);
  expect(f.store.diagnostic(head.id)?.write_stage).toBe('probe_attempted');
  expect((await recover()).status).toBe(200);
  expect(f.store.diagnostic(head.id)?.write_stage).toBe('not_started');
  expect(f.store.getMessage(sent.id)?.status).toBe('pending');
  expect(f.store.diagnostic(sent.id)?.attempt_count ?? 0).toBe(0);
  expect((await f.read()).messages.find((m: { id: string }) => m.id === sent.id).delivery).toBeUndefined();
  expect((await recover()).status).toBe(409);
});
it('rechecks only the authenticated current session and rejects shared or redirected recovery requests', async () => {
  const f = await fixture();
  const recover = (body: object = {}, scoped = false) => fetch(`${f.base}/agent/chat/recover`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(scoped ? { 'test-access': 'scoped' } : {}) }, body: JSON.stringify(body) });
  expect((await recover({}, true)).status).toBe(403);
  expect((await recover({ sessionId: 'another' })).status).toBe(400);
  expect(f.recover).not.toHaveBeenCalled();
  expect(await recover().then(r => r.json())).toEqual({ ok: true });
  expect(f.recover).toHaveBeenCalledExactlyOnceWith('agent');
  f.recover.mockRejectedValueOnce(new Error('private runtime details'));
  const failed = await recover(); expect(failed.status).toBe(409);
  expect(JSON.stringify(await failed.json())).not.toContain('private runtime details');
});
it('resolves uncertain chat writes in the page with owner authority and an attempt fence', async () => {
  const f = await fixture(), sent = await f.post('Original request').then(r => r.json());
  f.store.recordTransport(sent.id, { relay_online: null, peer_reachable: true, attempt_count: 1, next_retry_at: null,
    last_error: 'DELIVERY_OUTCOME_UNCONFIRMED', checked_at: Date.now(), write_stage: 'paste_written' });
  const decide = (action: string, attempt: number, scoped = false, id = sent.id) => fetch(`${f.base}/agent/chat/${id}/delivery`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(scoped ? { 'test-access': 'scoped' } : {}) }, body: JSON.stringify({ action, attempt }) });
  expect((await decide('retry', 1, true)).status).toBe(403);
  expect((await decide('retry', 1, false, 'another-message')).status).toBe(404);
  expect((await decide('retry', 2)).status).toBe(409);
  expect(f.store.hasUnconfirmedDelivery('agent')).toBe(true);
  expect((await decide('retry', 1)).status).toBe(200);
  expect((await decide('retry', 1)).status).toBe(200);
  expect(f.store.hasUnconfirmedDelivery('agent')).toBe(false);
  f.store.recordTransport(sent.id, { relay_online: null, peer_reachable: true, attempt_count: 2, next_retry_at: null,
    last_error: 'DELIVERY_OUTCOME_UNCONFIRMED', checked_at: Date.now(), write_stage: 'submit_attempted' });
  expect((await decide('cancel', 1)).status).toBe(409);
  // CLI and page use the same explicit recipient decision, with no new body.
  const cancelled = await fetch(`${f.base}/collab/message/${sent.id}/resolve-delivery`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel', attempt: 2 }) });
  expect(cancelled.status).toBe(200);
  expect((await f.read()).messages[0]).toMatchObject({ id: sent.id, content: 'Original request', status: 'cancelled' });
  expect(f.store.receipt(sent.id).delivered_at).toBeNull();
});

it('shares the same Session conversation with scoped viewers without relying on client headers', async () => {
  const f = await fixture();
  const a = await f.post('第一位的消息', 'request-00000000001', 'guest-a').then(r => r.json());
  const b = await f.post('第二位的消息', 'request-00000000001', 'guest-b').then(r => r.json());
  const aReply = f.store.storeIntegrationReply(a.id, 'agent', '第一位的回复', { idempotencyKey: 'reply-000000000001', responseKind: 'result' });
  f.store.storeIntegrationReply(b.id, 'agent', '第二位的回复', { idempotencyKey: 'reply-000000000002', responseKind: 'result' });
  expect((await f.read('guest-a', true)).messages).toHaveLength(4);
  expect((await f.read('new-guest', true)).messages).toEqual((await f.read('owner')).messages);
  expect((await f.read('new-guest', true)).messages.some((m: { id: string }) => m.id === aReply.id)).toBe(true);
  expect((await f.read('owner')).messages).toHaveLength(4);
});
it('only includes chat requests and their matching replies, without exposing other collaboration integrations or sessions', async () => {
  const f = await fixture();
  const a = await f.post('聊天正文').then(r => r.json());
  const original = f.store.getMessage(a.id)!;
  const [external] = f.store.send({ groupId: original.groupId, fromSessionId: null, toSessionIds: ['agent'], kind: 'ask', content: '其他集成内容', integrationOrigin: { integrationId: original.integrationOrigin!.integrationId, source: 'external' }, idempotencyKey: 'external-0000000001' });
  f.store.storeIntegrationReply(external.id, 'agent', '其他集成回复', { idempotencyKey: 'reply-external-000001', responseKind: 'result' });
  const externalUI = f.store.storeIntegrationReply(external.id, 'agent', JSON.stringify({ text: '其他集成的交互回复', ui: 'root = Stack([Text("other")])' }), { idempotencyKey: 'reply-external-ui', metadata: { openui: { version: 1 } } });
  expect((await fetch(`${f.base}/agent/chat/${externalUI.id}/state`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: 0, values: { plan: 'A' } }) })).status).toBe(404);
  const otherGroup = f.store.save({ name: 'Session 对话 another', sessionIds: ['another'] });
  f.store.send({ groupId: otherGroup.id, fromSessionId: null, toSessionIds: ['another'], kind: 'ask', content: '其他会话内容', integrationOrigin: { integrationId: original.integrationOrigin!.integrationId, source: 'session-chat' } });
  expect((await f.read('owner')).messages.map((m: { id: string }) => m.id)).toEqual([a.id]);
  expect((await f.read('alice', true)).messages.map((m: { id: string }) => m.id)).toEqual([a.id]);
});

it('returns a small revision acknowledgement for unchanged history and full data after a reply or form update', async () => {
  const f = await fixture(), sent = await f.post('请比较方案').then(response => response.json());
  const first = await f.read();
  const poll = (revision: string) => fetch(`${f.base}/agent/chat?revision=${encodeURIComponent(revision)}`).then(response => response.json());
  expect(await poll(first.revision)).toEqual({ unchanged: true, revision: first.revision });
  const reply = f.store.storeIntegrationReply(sent.id, 'agent', JSON.stringify({ text: '方案说明', ui: 'root = Stack([Text("方案")])' }), { idempotencyKey: 'revision-reply', metadata: { openui: { version: 1 } } });
  const updated = await poll(first.revision);
  expect(updated.messages).toHaveLength(2); expect(updated.revision).not.toBe(first.revision);
  f.store.saveChatUIState(reply.id, 'agent', { plan: 'A' }, 0);
  const edited = await poll(updated.revision);
  expect(edited.messages[1].uiState).toEqual({ revision: 1, values: { plan: 'A' } });
  expect(edited.revision).not.toBe(updated.revision);
  expect((await f.read('scoped-guest', true)).messages).toHaveLength(2);
  expect((await fetch(`${f.base}/missing/chat?revision=${edited.revision}`)).status).toBe(404);
});

it('pages the retained history beyond 500 messages without gaps, overlaps or offset shifts from new arrivals', async () => {
  const f = await fixture(), original = await f.post('seed').then(response => response.json());
  const template = f.store.getMessage(original.id)!;
  const document = JSON.parse(readFileSync(f.filePath, 'utf8'));
  document.messages = Array.from({ length: 760 }, (_, index) => ({ ...template, id: `page-${index}`, sequence: index + 1, createdAt: index + 1, status: 'delivered', content: `message ${index}`, idempotencyKey: `seed-${index}` }));
  writeFileSync(f.filePath, JSON.stringify(document));
  const current = await fixture(f.filePath);
  const page = (query = '') => fetch(`${current.base}/agent/chat?limit=30${query}`).then(response => response.json());
  let result = await page();
  expect(result.messages).toHaveLength(30);
  expect(result.messages[0].id).toBe('page-730');
  expect(result.page).toEqual({ hasOlder: true, hasNewer: false, mode: 'latest' });
  const ids = result.messages.map((message: { id: string }) => message.id);
  await current.post('new arrival', 'paging-new-arrival');
  while (result.page.hasOlder) {
    result = await page(`&before=${result.messages[0].id}`);
    expect(result.messages.length).toBeLessThanOrEqual(30);
    ids.unshift(...result.messages.map((message: { id: string }) => message.id));
  }
  expect(ids).toEqual(Array.from({ length: 760 }, (_, index) => `page-${index}`));
  expect(new Set(ids).size).toBe(760);
  expect((await current.read()).messages).toHaveLength(500);
  const next = await page('&after=page-759');
  expect(next.messages.map((message: { content: string }) => message.content)).toEqual(['new arrival']);
  expect(next.updates).toHaveLength(30);
  expect(next.updates[29].id).toBe('page-759');
  const unchanged = await page(`&after=page-759&revision=${next.revision}`);
  expect(unchanged).toEqual({ unchanged: true, revision: next.revision });
});

it('validates paging cursors within the visible conversation and retains per-page form and status updates', async () => {
  const f = await fixture(), sent = await f.post('interactive').then(response => response.json());
  const original = f.store.getMessage(sent.id)!;
  const [external] = f.store.send({ groupId: original.groupId, fromSessionId: null, toSessionIds: ['agent'], kind: 'ask', content: 'private external body', integrationOrigin: { integrationId: 'external', source: 'external' } });
  const fetchPage = (query: string) => fetch(`${f.base}/agent/chat?limit=2${query}`);
  expect((await fetchPage(`&before=${external.id}`)).status).toBe(404);
  expect((await fetchPage('&before=missing')).status).toBe(404);
  for (const query of ['limit=0', 'limit=61', 'limit=wrong', 'limit=2&before=x&after=y']) expect((await fetch(`${f.base}/agent/chat?${query}`)).status).toBe(400);
  const first = await fetchPage(`&after=${sent.id}`).then(response => response.json());
  expect(first.messages).toEqual([]); expect(first.updates).toHaveLength(1);
  f.store.fail(sent.id, 'test failure');
  const changed = await fetchPage(`&after=${sent.id}&revision=${first.revision}`).then(response => response.json());
  expect(changed.updates[0].status).toBe('failed'); expect(changed.revision).not.toBe(first.revision);
  expect(JSON.stringify(changed)).not.toContain('private external body');
  const reply = f.store.storeIntegrationReply(sent.id, 'agent', JSON.stringify({ text: 'plan', ui: 'root = Stack([Text("plan")])' }), { idempotencyKey: 'page-ui-reply', metadata: { openui: { version: 1 } } });
  const uiPage = await fetchPage(`&after=${reply.id}`).then(response => response.json());
  f.store.saveChatUIState(reply.id, 'agent', { selected: 'A' }, 0);
  const edited = await fetchPage(`&after=${reply.id}&revision=${uiPage.revision}`).then(response => response.json());
  expect(edited.updates.find((message: { id: string }) => message.id === reply.id).uiState.values).toEqual({ selected: 'A' });
});

it('confirms a retained pending request and reports its unanswered state without transferring the original request body', async () => {
  const f = await fixture(), requestId = 'pending-outside-current-page';
  const sent = await f.post('old request outside the page', requestId).then(response => response.json());
  for (let index = 0; index < 35; index++) f.store.storeIntegrationReply(sent.id, 'agent', `progress ${index}`, { idempotencyKey: `progress-${index}`, responseKind: 'progress' });
  const read = () => fetch(`${f.base}/agent/chat?limit=30&requestId=${requestId}`).then(response => response.json());
  const page = await read();
  expect(page.messages).toHaveLength(30); expect(page.messages.every((message: { role: string }) => message.role === 'assistant')).toBe(true);
  expect(page.confirmedRequestId).toBe(requestId); expect(page.replyPending).toBe(true);
  expect(JSON.stringify(page)).not.toContain('old request outside the page');
  f.store.storeIntegrationReply(sent.id, 'agent', 'completed', { idempotencyKey: 'last-paged-result', responseKind: 'result' });
  expect((await read()).replyPending).toBe(false);
});

it('updates a version-two UI stream in place, keeps revisions idempotent and closes it after the final snapshot', async () => {
  const f = await fixture();
  const original = await f.post('展示界面').then(r => r.json());
  const body = (text: string) => JSON.stringify({ text, ui: `root = Stack([TextContent("${text}")])` });
  const reply = f.store.storeIntegrationReply(original.id, 'agent', body('开始'), { idempotencyKey: 'stream-start', metadata: { openui: { version: 2, streaming: true } } });
  expect((await f.read()).messages[1].ui).toMatchObject({ version: 2, streaming: true, revision: 0 });
  const pageBefore = await fetch(`${f.base}/agent/chat?limit=10`).then(r => r.json());
  expect(pageBefore.replyPending).toBe(true);
  const update = { idempotencyKey: 'stream-middle', metadata: { openui: { version: 2, streaming: true } } };
  expect(f.store.updateIntegrationUIReply(original.id, reply.id, 'agent', body('中间'), update, 0).id).toBe(reply.id);
  f.store.updateIntegrationUIReply(original.id, reply.id, 'agent', body('中间'), update, 0);
  expect((await f.read()).messages).toHaveLength(2);
  expect((await f.read()).messages[1].ui).toMatchObject({ streaming: true, revision: 1 });
  expect(() => f.store.updateIntegrationUIReply(original.id, reply.id, 'agent', body('旧版本'), { ...update, idempotencyKey: 'stale' }, 0)).toThrow(/already changed/);
  expect(() => f.store.updateIntegrationUIReply(original.id, reply.id, 'other', body('越权'), update, 1)).toThrow();
  f.store.updateIntegrationUIReply(original.id, reply.id, 'agent', body('完成'), { idempotencyKey: 'stream-final', metadata: { openui: { version: 2, streaming: false } } }, 1);
  const page = await fetch(`${f.base}/agent/chat?limit=10`).then(r => r.json());
  expect(page.messages[1]).toMatchObject({ id: reply.id, content: '完成', ui: { streaming: false, revision: 2 } });
  expect(page.replyPending).toBe(false); expect(page.revision).not.toBe(pageBefore.revision);
  expect(() => f.store.updateIntegrationUIReply(original.id, reply.id, 'agent', body('再次修改'), { ...update, idempotencyKey: 'closed' }, 2)).toThrow(/unfinished/);
});

it('merges statement patches before exposing the next durable UI snapshot', async () => {
  const f = await fixture(), original = await f.post('逐步补全').then(r => r.json());
  const reply = f.store.storeIntegrationReply(original.id, 'agent', JSON.stringify({ text: '开始', ui: 'root = Stack([detail])\ndetail = TextContent("开始")' }), { idempotencyKey: 'patch-start', metadata: { openui: { version: 2, streaming: true } } });
  expect(f.store.receipt(original.id).result_ids).toEqual([]);
  f.store.updateIntegrationUIReply(original.id, reply.id, 'agent', JSON.stringify({ text: '更新后正文', ui: 'detail = TextContent("更新后正文")' }), { idempotencyKey: 'patch-1', metadata: { openui: { version: 2, streaming: true, patch: true } } }, 0);
  const message = (await f.read()).messages[1];
  expect(message.ui.code).toContain('root = Stack([detail])'); expect(message.ui.code).toContain('更新后正文');
  expect(message.ui.revision).toBe(1); expect(message.id).toBe(reply.id);
});

it('keeps chat independent of ordinary groups and preserves explicit replies and unambiguous peer sends', async () => {
  const f = await fixture(), sent = await f.post('普通对话').then(r => r.json());
  const channel = f.store.getSessionChat('agent')!;
  expect(channel.archivedAt).toBeUndefined(); expect(f.store.list()).toEqual([]); expect(f.store.groupsForSession('agent')).toEqual([]);
  const work = f.store.save({ name: '项目协作', sessionIds: ['agent', 'peer'] });
  const directory = await fetch(`${f.base}/collaboration-groups`).then(r => r.json());
  expect(directory.groups.map((g: { id: string }) => g.id)).toEqual([work.id]);
  expect(f.store.groupsForSession('agent').map(g => g.id)).toEqual([work.id]);
  const reply = await fetch(`${f.base}/collab/reply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageId: sent.id, content: '正常回复', response_kind: 'result', idempotency_key: 'independent-reply' }) });
  expect(reply.status).toBe(200); expect((await f.read()).messages.at(-1).content).toBe('正常回复');
  const peerSend = await fetch(`${f.base}/collab/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetSessionId: 'peer', message: '项目消息' }) });
  expect(peerSend.status).toBe(200);
  expect(() => f.store.save({ id: channel.id, name: '不应修改', sessionIds: ['agent', 'peer'] })).toThrow();
  expect(f.store.remove(channel.id)).toBe(false);
  f.store.archiveSession('agent');
  expect(f.store.getSessionChat('agent')?.sessionIds).toEqual(['agent']); expect((await f.read()).messages).toHaveLength(2);
});

it('migrates legacy archived chat channels without hiding a same-name ordinary group or losing history', async () => {
  const f = await fixture(), sent = await f.post('保留旧对话').then(r => r.json());
  const channel = f.store.getSessionChat('agent')!;
  const document = JSON.parse(readFileSync(f.filePath, 'utf8'));
  const legacy = document.groups.find((g: { id: string }) => g.id === channel.id);
  delete legacy.sessionChatSessionId; legacy.archivedAt = Date.now();
  document.groups.push({ id: 'ordinary-same-name', name: 'Session 对话 agent', sessionIds: ['agent'], createdAt: 1, updatedAt: 1 });
  writeFileSync(f.filePath, JSON.stringify(document));
  const restarted = await fixture(f.filePath);
  expect(restarted.store.list().map(g => g.id)).toEqual(['ordinary-same-name']);
  expect(restarted.store.getSessionChat('agent')?.id).toBe(channel.id);
  expect((await restarted.read()).messages.map((m: { id: string }) => m.id)).toEqual([sent.id]);
  expect((await restarted.post('后续消息', 'request-00000000002').then(r => r.json())).id).toBeTruthy();
  expect(restarted.store.getSessionChat('agent')?.id).toBe(channel.id);
});

it('projects only visible assistant message IDs and opens a page around the first unseen reply', async () => {
  const f = await fixture(); const original = await f.post('检查多项任务').then(r => r.json());
  const replies = Array.from({ length: 45 }, (_, i) => f.store.storeIntegrationReply(original.id, 'agent', `检查结果 ${i}`, { idempotencyKey: `attention-reply-${i}` }));
  const latest = await fetch(`${f.base}/agent/chat?limit=10`).then(r => r.json());
  expect(latest.chatIndex.messageIds).toEqual(replies.map(reply => reply.id));
  expect(latest.chatIndex.messageIds).not.toContain(original.id);
  const around = await fetch(`${f.base}/agent/chat?limit=10&around=${replies[5].id}`).then(r => r.json());
  expect(around.page).toEqual({ mode: 'around', hasOlder: true, hasNewer: true });
  expect(around.messages.some((message: { id: string }) => message.id === replies[5].id)).toBe(true);
  expect(around.messages).toHaveLength(10);
  expect((await fetch(`${f.base}/agent/chat?limit=10&around=missing`)).status).toBe(404);
  expect((await fetch(`${f.base}/agent/chat?limit=10&around=${replies[5].id}&after=${original.id}`)).status).toBe(400);
});

it('streams assistant identifiers without a browser polling, ignores unrelated changes, and disposes its listener', async () => {
  const { watchSessionChatIndex } = await import('./sessionChatHistory');
  const f = await fixture(), send = vi.fn();
  const stop = watchSessionChatIndex(f.store, 'agent', send);
  expect(send).toHaveBeenCalledExactlyOnceWith({ conversationId: '', messageIds: [], viewedMessageIds: [] });
  const original = await f.post('后台回复').then(r => r.json());
  const group = f.store.getSessionChat('agent')!;
  expect(send).toHaveBeenLastCalledWith({ conversationId: group.id, messageIds: [], viewedMessageIds: [] });
  send.mockClear();
  const reply = f.store.storeIntegrationReply(original.id, 'agent', '后台完成', { idempotencyKey: 'background-reply' });
  expect(send).toHaveBeenCalledExactlyOnceWith({ conversationId: group.id, messageIds: [reply.id], viewedMessageIds: [] });
  const single = await fetch(`${f.base}/agent/chat?limit=1&around=${reply.id}`).then(r => r.json());
  expect(single.messages.map((message: { id: string }) => message.id)).toEqual([reply.id]);
  send.mockClear();
  await f.post('下一项', 'request-next-0000001');
  expect(send).not.toHaveBeenCalled();
  stop();
  f.store.storeIntegrationReply(original.id, 'agent', '之后的消息', { idempotencyKey: 'after-unsubscribe' });
  expect(send).not.toHaveBeenCalled();
});

it('shares durable message viewing across clients and broadcasts both acknowledgements and later replies', async () => {
  const { watchSessionChatIndex } = await import('./sessionChatHistory');
  const f = await fixture(), request = await f.post('多端查看同一对话').then(r => r.json());
  const one = f.store.storeIntegrationReply(request.id, 'agent', '第一条结果', { idempotencyKey: 'shared-first' });
  const two = f.store.storeIntegrationReply(request.id, 'agent', '第二条结果', { idempotencyKey: 'shared-second' });
  const clientA = vi.fn(), clientB = vi.fn();
  const stopA = watchSessionChatIndex(f.store, 'agent', clientA), stopB = watchSessionChatIndex(f.store, 'agent', clientB);
  clean.push(stopA, stopB);
  const initial = (await f.read()).chatIndex;
  expect(initial.viewedMessageIds).toEqual([]);
  const mark = (ids: string[], subject = 'alice', conversationId = initial.conversationId) => fetch(`${f.base}/agent/chat/viewed`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'test-subject': subject, 'test-access': 'scoped' }, body: JSON.stringify({ conversationId, messageIds: ids }) });
  expect((await f.read('bob')).chatIndex.viewedMessageIds).toEqual([]);
  const response = await mark([two.id]).then(r => r.json());
  expect(response.chatIndex.viewedMessageIds).toEqual([two.id]);
  expect((await f.read('bob')).chatIndex.viewedMessageIds).toEqual([two.id]);
  expect(clientA).toHaveBeenLastCalledWith(response.chatIndex);
  expect(clientB).toHaveBeenLastCalledWith(response.chatIndex);
  const broadcasts = clientB.mock.calls.length;
  await mark([two.id], 'bob'); expect(clientB.mock.calls).toHaveLength(broadcasts);
  const third = f.store.storeIntegrationReply(request.id, 'agent', '新的结果仍应提示', { idempotencyKey: 'shared-third' });
  await Promise.all([mark([one.id]), mark([two.id], 'bob')]);
  const index = (await f.read('bob')).chatIndex;
  expect(index.messageIds.filter((id: string) => !index.viewedMessageIds.includes(id))).toEqual([third.id]);
  const restarted = await fixture(f.filePath);
  expect((await restarted.read('new-device')).chatIndex.viewedMessageIds.sort()).toEqual([one.id, two.id].sort());
  expect((await mark([third.id], 'bob', 'wrong-conversation')).status).toBe(409);
  await mark([request.id, 'unknown-message']);
  expect((await f.read()).chatIndex.viewedMessageIds.sort()).toEqual([one.id, two.id].sort());
  expect(f.store.getMessage(one.id)?.status).toBe('stored');
  expect(JSON.stringify(f.store.inbox('agent'))).not.toContain('viewedMessageIds');
});

it('streams shared attention for known unmounted sessions through the full-service control projection', async () => {
  const { watchSessionChatIndices } = await import('./sessionChatHistory');
  const f = await fixture(), request = await f.post('后台消息提醒').then(r => r.json());
  const reply = f.store.storeIntegrationReply(request.id, 'agent', '未打开会话也有提醒', { idempotencyKey: 'background-attention' });
  f.store.ensureSessionChat('other-private-session');
  const send = vi.fn(), stop = watchSessionChatIndices(f.store, () => new Set(['agent']), send); clean.push(stop);
  const first = send.mock.calls[0][0];
  expect(first).toHaveLength(1); expect(first[0]).toMatchObject({ sessionId: 'agent', index: { messageIds: [reply.id], viewedMessageIds: [] } });
  f.store.markSessionChatViewed('agent', first[0].index.conversationId, [reply.id]);
  expect(send).toHaveBeenLastCalledWith([{ sessionId: 'agent', index: { ...first[0].index, viewedMessageIds: [reply.id] } }]);
});

it('preserves explicit reply targets and short question context even outside the current page', async () => {
  const f = await fixture();
  const first = await f.post('未读提示会导致界面抖动', 'request-context-00001').then(r => r.json());
  const second = await f.post('采用方案 A', 'request-context-00002').then(r => r.json());
  const newer = f.store.storeIntegrationReply(second.id, 'agent', '按 A 调整', { idempotencyKey: 'context-newer' });
  const earlier = f.store.storeIntegrationReply(first.id, 'agent', '修复未读抖动', { idempotencyKey: 'context-earlier' });
  const page = await fetch(`${f.base}/agent/chat?limit=2&replyContext=1`).then(r => r.json());
  expect(page.messages.map((m: { id: string }) => m.id)).toEqual([newer.id, earlier.id]);
  expect(page.messages[0]).toMatchObject({ replyTo: second.id, replyContext: { id: second.id, text: '采用方案 A' } });
  expect(page.messages[1]).toMatchObject({ replyTo: first.id, replyContext: { id: first.id, text: '未读提示会导致界面抖动' } });
  expect((await f.read()).messages.filter((m: { role: string }) => m.role === 'user').every((m: { replyContext?: unknown }) => m.replyContext === undefined)).toBe(true);
});
