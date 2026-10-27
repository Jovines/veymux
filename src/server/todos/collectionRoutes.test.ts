import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TodoError, TodoStore } from './store.js';
import { TodoRunner, todoRoutes, type TodoRuntime } from './routes.js';
import { createTodoWebhookRouter } from './webhook.js';
import type { TodoCollector } from './types.js';

let dir: string, store: TodoStore, server: Server, origin: string, a: TodoCollector, b: TodoCollector, runtime: TodoRuntime;
const config = { agentSlug: 'fixture', command: 'fixture', cwd: '/tmp', prompt: '仅收集待办' };
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veymux-collection-http-')); store = new TodoStore(path.join(dir, 'todos.json'));
  a = store.saveCollector({ name: 'A', config, webhook: { enabled: true, secret: "" } }); b = store.saveCollector({ name: 'B', config });
  runtime = { validate: async c => c, launch: vi.fn(async (run, _prompt, created) => created(run.collectorId === a.id ? 'session-a' : 'session-b')),
    callerSession: context => { if (['session-a', 'session-b'].includes(context.backendSessionId ?? '')) return context.backendSessionId!; throw new TodoError('Unknown caller', 403); },
    collectionSessions: { observe: vi.fn(async () => null), close: vi.fn(async () => false), reuse: vi.fn(async () => {}) } };
  const runner = new TodoRunner(store, runtime), app = express();
  app.use('/hooks/todo', createTodoWebhookRouter(store, runner)); app.use(express.json()); app.use('/todos', todoRoutes(store, runner, runtime));
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.on('listening', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => { await new Promise<void>(resolve => server.close(() => resolve())); fs.rmSync(dir, { recursive: true, force: true }); });
const call = async (suffix: string, body?: unknown, caller?: string) => {
  const response = await fetch(origin + '/todos' + suffix, { method: body === undefined ? 'GET' : 'POST', headers: {
    'Content-Type': 'application/json', 'X-Veymux-Local-Token': 'fixture', 'X-Veymux-Todo-Context': encodeURIComponent(JSON.stringify(caller ? { backendSessionId: caller } : {})),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, data: await response.json() };
};
const webhook = async (key: string | null, payload: unknown = { resourceId: 'msg-7' }) => {
  const response = await fetch(origin + '/hooks/todo/' + a.id, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + a.webhook!.secret, ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(payload) });
  return { status: response.status, data: await response.json() };
};
it('persists the webhook envelope and rejects busy events without consuming their identity or payload', async () => {
  expect((await webhook(null)).status).toBe(400);
  const first = await webhook('event-1'); expect(first.status).toBe(202);
  const run = store.run(first.data.runId);
  expect(run.trigger).toMatchObject({ collectorId: a.id, runId: run.id, triggerType: 'webhook', payload: { resourceId: 'msg-7' }, idempotencyKey: 'event-1' });
  expect(JSON.stringify(run.trigger)).not.toContain(a.webhook!.secret);
  store.saveCollector({ ...store.collector(a.id), config: { ...config, prompt: '新配置' } });
  expect((await webhook('event-1')).data.runId).toBe(run.id);
  expect((await webhook('event-1', { resourceId: 'different' })).status).toBe(409);
  expect(await webhook('event-2', { resourceId: 'msg-8' })).toMatchObject({ status: 409, data: { code: 'COLLECTOR_BUSY', activeRunId: run.id } });
  const revision = store.run(run.id).collection!.revision;
  expect((await call('/runs/' + run.id + '/finish', { revision, idempotencyKey: 'finish-1', status: 'success', summary: '只覆盖声明的来源', coverage: [{ sourceKey: 'source-a', status: 'success' }], checkpoints: [{ sourceKey: 'source-a', expectedRevision: 0, cursor: { page: 'opaque-1' } }] }, 'session-a')).status).toBe(200);
  const second = await webhook('event-2', { resourceId: 'msg-8' }); expect(second.status).toBe(202);
  expect(store.run(second.data.runId).trigger?.payload).toEqual({ resourceId: 'msg-8' });
  expect(runtime.launch).toHaveBeenCalledTimes(2);
});
it('uses server-scoped checkpoint/run reads and fences old run mutations after a new run starts', async () => {
  const run = (await call('/collectors/' + a.id + '/run', { idempotencyKey: 'manual' })).data.run;
  await vi.waitFor(() => expect(store.run(run.id).status).toBe('delivered'));
  expect((await call('/collectors/' + a.id + '/checkpoints?sourceKey=chat', undefined, 'session-a')).data.checkpoints).toEqual([expect.objectContaining({ revision: 0, cursor: null })]);
  expect((await call('/collectors/' + b.id + '/checkpoints', undefined, 'session-a')).status).toBe(403);
  const rb = (await call('/collectors/' + b.id + '/run', { idempotencyKey: 'b' })).data.run;
  expect((await call('/runs/' + rb.id, undefined, 'session-a')).status).toBe(403);
  expect((await call('', { title: '忘记 run', collectorId: a.id }, 'session-a')).data.code).toBe('COLLECTOR_RUN_FENCED');
  const created = await call('', { title: '明确本轮', collectorId: a.id, runId: run.id, externalId: 'one' }, 'session-a');
  expect(created.status).toBe(200);
  await call('/runs/' + run.id + '/report', { status: 'complete', content: '普通报告，不推进 checkpoint' }, 'session-a');
  const next = (await call('/collectors/' + a.id + '/run', { idempotencyKey: 'next' })).data.run;
  expect(next.id).not.toBe(run.id);
  expect((await call('/' + created.data.todo.id, { collectorId: a.id, runId: run.id, revision: 1, title: '旧轮次覆盖' }, 'session-a')).data.code).toBe('COLLECTOR_RUN_FENCED');
  expect(store.get(created.data.todo.id).title).toBe('明确本轮');
  expect(store.checkpoints(a.id)).toEqual([]);
});
it('allows one atomic success from racing finish requests and makes identical retries idempotent', async () => {
  const run = (await call('/collectors/' + a.id + '/run', { idempotencyKey: 'start' })).data.run;
  await vi.waitFor(() => expect(store.run(run.id).status).toBe('delivered'));
  const revision = store.run(run.id).collection!.revision;
  const body = { revision, idempotencyKey: 'commit', status: 'success', summary: '声明来源已完整读取', coverage: [{ sourceKey: 'source-a', status: 'success' }], checkpoints: [{ sourceKey: 'source-a', expectedRevision: 0, cursor: 'page-7' }] };
  const results = await Promise.all([call('/runs/' + run.id + '/finish', body, 'session-a'), call('/runs/' + run.id + '/finish', { ...body, idempotencyKey: 'competing', checkpoints: [{ sourceKey: 'source-a', expectedRevision: 0, cursor: 'wrong' }] }, 'session-a')]);
  expect(results.map(r => r.status).sort()).toEqual([200, 409]);
  const winner = results.find(r => r.status === 200)!;
  const retryBody = winner.data.run.collection.commit.key === 'commit' ? body : { ...body, idempotencyKey: 'competing', checkpoints: [{ sourceKey: 'source-a', expectedRevision: 0, cursor: 'wrong' }] };
  expect((await call('/runs/' + run.id + '/finish', retryBody, 'session-a')).data.run).toEqual(winner.data.run);
  expect(store.checkpoints(a.id, 'source-a')).toMatchObject({ revision: 1, lastSuccessfulRunId: run.id });
  expect((await call('/collectors', { ...store.collector(a.id), checkpoints: [{ sourceKey: 'bypass', revision: 99, cursor: 'skip' }] })).status).toBe(400);
});
it('makes recovery an owner operation and refuses it until the old terminal is absent', async () => {
  const run = (await call('/collectors/' + a.id + '/run', { idempotencyKey: 'start' })).data.run;
  await vi.waitFor(() => expect(store.run(run.id).status).toBe('delivered'));
  vi.mocked(runtime.collectionSessions!.observe).mockResolvedValue({ identity: 'live', ownershipIdentity: 'live', lastOutputAt: Date.now(), observedAt: Date.now() });
  const revision = store.run(run.id).collection!.revision;
  expect((await call('/runs/' + run.id + '/retry', { revision, idempotencyKey: 'retry' }, 'session-a')).status).toBe(403);
  expect((await call('/runs/' + run.id + '/retry', { revision, idempotencyKey: 'retry' })).data.code).toBe('COLLECTOR_RUNTIME_PRESENT');
  vi.mocked(runtime.collectionSessions!.observe).mockResolvedValue(null);
  const retried = await call('/runs/' + run.id + '/retry', { revision, idempotencyKey: 'retry' });
  expect(retried.status).toBe(200); expect(retried.data.run.collection.previousRunId).toBe(run.id);
  expect((await call('/runs/' + run.id + '/retry', { revision, idempotencyKey: 'retry' })).data.run.id).toBe(retried.data.run.id);
  expect(runtime.launch).toHaveBeenCalledTimes(2);
});
