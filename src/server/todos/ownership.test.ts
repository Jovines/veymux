import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TodoError, TodoStore } from './store.js';
import { TodoRunner, todoRoutes, type TodoRuntime } from './routes.js';
import type { TodoCollector, TodoItem, TodoRun } from './types.js';

let directory: string, store: TodoStore, server: Server, base: string;
let a: TodoCollector, b: TodoCollector, ta: TodoItem, tb: TodoItem, runs: TodoRun[];
const config = { agentSlug: 'fixture', command: 'fixture', cwd: '/tmp', prompt: '只收集' };
beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'td-todo-ownership-'));
  store = new TodoStore(path.join(directory, 'todos.json'));
  [a, b] = ['A', 'B'].map(() => store.saveCollector({ name: '同名方向', config }));
  [ta, tb] = [a, b].map(c => store.create({ title: c.id, collectorId: c.id, externalId: 'same', category: 'short' }));
  runs = [a, b].map((c, i) => {
    const run = store.begin('collect', c.id, config, c.id).run;
    store.mark(run.id, { sessionId: `session-${i}`, status: 'delivered' }); return store.run(run.id);
  });
  const runtime: TodoRuntime = { validate: async c => c, launch: vi.fn(async () => {}), callerSession: context => {
    if (['session-0', 'session-1'].includes(context.backendSessionId ?? '')) return context.backendSessionId!;
    throw new TodoError('未知会话', 403);
  } };
  const app = express(); app.use(express.json()); app.use('/todos', todoRoutes(store, new TodoRunner(store, runtime), runtime));
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.on('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/todos`;
});
afterEach(async () => { await new Promise<void>(resolve => server.close(() => resolve())); fs.rmSync(directory, { recursive: true, force: true }); });
const request = async (suffix: string, body?: unknown, context: unknown = { backendSessionId: 'session-0' }) => {
  const response = await fetch(base + suffix, { method: body === undefined ? 'GET' : 'POST', headers: {
    'Content-Type': 'application/json', 'X-Termdock-Local-Token': 'fixture',
    ...(context === undefined ? {} : { 'X-Termdock-Todo-Context': encodeURIComponent(JSON.stringify(context)) }),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body && typeof body === 'object' && 'collectorId' in body && !('runId' in body) ? { ...body, runId: runs[(context as { backendSessionId?: string })?.backendSessionId === 'session-1' ? 1 : 0].id } : body) }) });
  return { status: response.status, data: await response.json() };
};

it('isolates stable namespaces and all list metadata and summary counts after renaming', async () => {
  expect(ta.id).not.toBe(tb.id);
  store.create({ title: 'A2', collectorId: a.id });
  store.saveCollector({ ...store.collector(a.id), name: 'A 改名' });
  const result = await request('');
  expect(result.data.todos.map((t: TodoItem) => t.collectorId)).toEqual([a.id, a.id]);
  expect(result.data.collectors.map((c: TodoCollector) => [c.id, c.name])).toEqual([[a.id, 'A 改名']]);
  expect(result.data.runs.map((r: TodoRun) => r.id)).toEqual([runs[0].id]);
  expect((await request('/summary')).data.count).toBe(2);
  expect((await request('?collectorId=' + b.id)).status).toBe(403);
  expect((await request('?collectorId=' + a.id, undefined, {})).data.todos).toHaveLength(2);
  expect(store.collectorForSession('session-0')).toBe(a.id);
});
it('rejects missing or swapped namespaces before any write and does not expose foreign revisions', async () => {
  const before = store.snapshot();
  for (const body of [{ title: '遗漏 collector' }, { title: '指定其他 collector', collectorId: b.id }]) expect((await request('', body)).status).toBe(403);
  for (const patch of [{ title: '更新' }, { status: 'completed' }, { status: 'ignored' }, { status: 'open' }]) {
    const foreign = await request('/' + tb.id, { ...patch, revision: 99, collectorId: a.id });
    expect(foreign).toMatchObject({ status: 403, data: { code: 'TODO_OWNERSHIP_MISMATCH' } });
    expect(foreign.data.currentRevision).toBeUndefined();
    expect((await request('/' + tb.id, { ...patch, revision: 1, collectorId: b.id })).status).toBe(403);
    expect((await request('/' + ta.id, { ...patch, revision: 1 })).status).toBe(403);
  }
  expect(store.snapshot()).toEqual(before);
});
it('allows only explicit own updates and preserves conditional revisions and audit fields', async () => {
  expect((await request('', { title: '重复 add 不覆盖', collectorId: a.id, externalId: 'same', category: 'long' })).data.todo).toEqual(ta);
  const updated = await request('/' + ta.id, { collectorId: a.id, revision: 1, description: '更新', category: 'delegated' });
  expect(updated).toMatchObject({ status: 200, data: { collectorId: a.id, todoId: ta.id, revision: 2 } });
  expect((await request('/' + ta.id, { collectorId: a.id, revision: 1, status: 'completed' }))).toMatchObject({ status: 409, data: { currentRevision: 2 } });
  for (const [revision, status] of [[2, 'completed'], [3, 'open'], [4, 'ignored'], [5, 'open']]) expect((await request('/' + ta.id, { collectorId: a.id, revision, status })).status).toBe(200);
  expect(store.get(tb.id)).toEqual(tb);
  expect(store.get(ta.id)).toMatchObject({ category: 'delegated', collectorId: a.id, status: 'open', revision: 6 });
});
it('fails closed for legacy local writers, bad caller context and alternative mutation routes', async () => {
  const before = store.snapshot();
  const legacy = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Termdock-Local-Token': 'fixture' }, body: JSON.stringify({ title: '旧 CLI' }) });
  expect(legacy.status).toBe(403); expect((await legacy.json()).code).toBe('TODO_CALLER_CONTEXT_REQUIRED');
  for (const context of [{ backendSessionId: 'missing' }, [], { sessionId: 'session-0' }, { backendSessionId: 3 }]) expect((await request('', { title: '上下文错误', collectorId: a.id }, context)).status).toBeGreaterThanOrEqual(400);
  for (const suffix of ['/claim', '/handoff', '/defaults', '/collectors', '/' + ta.id + '/run', '/' + ta.id + '/release', '/runs/' + runs[1].id + '/report']) expect((await request(suffix, { collectorId: a.id, revision: 1, status: 'complete', content: '越权' })).status).toBe(403);
  expect(store.snapshot()).toEqual(before);
  expect((await request('/runs/' + runs[0].id + '/report', { status: 'complete', content: '仅本方向收集结果' })).status).toBe(200);
});
it('keeps namespace immutable and does not drop scope after another handoff uses the session', async () => {
  const before = store.snapshot();
  expect((await request('/' + ta.id, { collectorId: a.id, source: '移入其他来源', revision: 1 })).status).toBe(400);
  expect(store.snapshot()).toEqual(before);
  const execute = store.begin('execute', ta.id, config, 'later-execution').run;
  store.mark(execute.id, { sessionId: 'session-0', status: 'delivered' });
  expect(store.collectorForSession('session-0')).toBe(a.id);
  expect((await request('/' + tb.id, { collectorId: b.id, revision: 1, status: 'completed' })).status).toBe(403);
  expect(store.get(tb.id)).toEqual(tb);
});
