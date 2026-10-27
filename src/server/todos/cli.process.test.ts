import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import express from 'express';
import { expect, it, vi } from 'vitest';
import { TodoStore } from './store.js';
import { todoRoutes, TodoRunner, type TodoRuntime } from './routes.js';

it('injects and deduplicates through the actual CLI, local credential and HTTP routes', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'veymux-todo-cli-'));
  const state = path.join(directory, '.veymux'); fs.mkdirSync(state);
  const store = new TodoStore(path.join(state, 'todos.json'));
  const runtime: TodoRuntime = { validate: async config => config, launch: vi.fn(async () => {}), callerSession: context => {
    if (context.backendSessionId === 'backend-a') return 'session-a';
    if (context.backendSessionId === 'backend-b') return 'session-b';
    throw new Error('unknown caller');
  } };
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { if (req.header('X-Veymux-Local-Token') !== 'todo-cli-fixture') { res.sendStatus(401); return; } next(); });
  app.use('/api/terminal/operations/todos', todoRoutes(store, new TodoRunner(store, runtime), runtime));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.on('listening', resolve));
  const preload = path.join(directory, 'preload.mjs');
  fs.writeFileSync(preload, "import os from 'node:os'; import { syncBuiltinESMExports } from 'node:module'; os.homedir = () => process.env.VEYMUX_TODO_TEST_DIRECTORY; syncBuiltinESMExports();");
  fs.writeFileSync(path.join(state, 'server.json'), JSON.stringify({ pid: process.pid, host: '127.0.0.1', scheme: 'http', port: (server.address() as { port: number }).port, localApiToken: 'todo-cli-fixture' }), { mode: 0o600 });
  const run = (args = ['add', '--title', '项目巡检待办', '--source', '外部工具', '--external-id', 'stable', '--category', 'short', '--stdin'], content = '外部程序传入的背景与处理要求', backend?: string) => new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    if (backend && ['add', 'update', 'complete', 'ignore', 'reopen'].includes(args[0])) args = [...args, '--run', store.snapshot().runs.find(run => run.sessionId === (backend === 'backend-a' ? 'session-a' : 'session-b'))!.id];
    const child = spawn(process.execPath, ['--import', preload, '--import', 'tsx', path.resolve('src/server/cli.ts'), 'todo', ...args], { env: { ...process.env, VEYMUX_TODO_TEST_DIRECTORY: directory, VEYMUX: backend ? "1" : undefined, VEYMUX_BACKEND_SESSION_ID: backend, TMUX: undefined, TMUX_PANE: undefined }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; const timer = setTimeout(() => child.kill(), 8000);
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject); child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); }); child.stdin.end(content);
  });
  try {
    const first = await run(), second = await run();
    expect(first.code).toBe(0); expect(first.stderr).toBe(''); expect(second.code).toBe(0);
    const a = JSON.parse(first.stdout), b = JSON.parse(second.stdout);
    expect(a.todo.id).toBe(b.todo.id); expect(store.snapshot().todos).toHaveLength(1);
    expect(store.snapshot().todos[0]).toMatchObject({ source: '外部工具', description: '外部程序传入的背景与处理要求' });
    const id = a.todo.id;
    const listed = await run(['list', '--category', 'short']);
    expect(JSON.parse(listed.stdout).todos.map((t: { id: string }) => t.id)).toEqual([id]);
    const updated = await run(['update', id, '--stdin', '--category', 'delegated', '--revision', '1'], '缺陷已解决；待合入 alpha 并通知');
    expect(updated.code).toBe(0);
    expect(JSON.parse(updated.stdout).todo).toMatchObject({ id, category: 'delegated', revision: 2, description: '缺陷已解决；待合入 alpha 并通知' });
    const stale = await run(['update', id, '--description', '过期内容', '--revision', '1']);
    expect(stale.code).toBe(1); expect(JSON.parse(stale.stdout)).toMatchObject({ ok: false, currentRevision: 2 });
    const repeated = await run();
    expect(JSON.parse(repeated.stdout).todo).toEqual(JSON.parse(updated.stdout).todo);
    expect((await run(['complete', id])).code).toBe(0);
    expect((await run(['reopen', id])).code).toBe(0);
    expect(store.get(id)).toMatchObject({ category: 'delegated', status: 'open', externalId: 'stable', source: '外部工具' });
    expect(store.snapshot().todos).toHaveLength(1);
    const config = { agentSlug: 'fixture', command: 'fixture', cwd: directory, prompt: '只收集' };
    const collectors = ['a', 'b'].map(id => {
      const collector = store.saveCollector({ name: '相同显示名', config });
      const run = store.begin('collect', collector.id, config, 'collect-' + id).run;
      store.mark(run.id, { sessionId: 'session-' + id, status: 'delivered' });
      return collector;
    });
    const [ca, cb] = collectors;
    const add = (collector: string) => ['add', '--title', '独立事项', '--collector', collector, '--external-id', 'same'];
    const ownedA = JSON.parse((await run(add(ca.id), '', 'backend-a')).stdout).todo;
    const ownedB = JSON.parse((await run(add(cb.id), '', 'backend-b')).stdout).todo;
    expect(ownedA.id).not.toBe(ownedB.id);
    const missing = await run(['add', '--title', '不许落默认来源'], '', 'backend-a');
    expect(missing.code).toBe(1); expect(JSON.parse(missing.stdout).code).toBe('TODO_COLLECTOR_REQUIRED');
    const foreignAdd = await run(add(cb.id), '', 'backend-a');
    expect(JSON.parse(foreignAdd.stdout).code).toBe('TODO_OWNERSHIP_MISMATCH');
    for (const action of ['update', 'complete', 'ignore', 'reopen']) {
      const args = [action, ownedB.id, '--collector', ca.id, '--revision', '1', ...(action === 'update' ? ['--title', '越权'] : [])];
      const denied = await run(args, '', 'backend-a');
      expect(denied.code).toBe(1); expect(JSON.parse(denied.stdout).code).toBe('TODO_OWNERSHIP_MISMATCH');
      expect(store.get(ownedB.id)).toEqual(ownedB);
    }
    expect((await run(['update', ownedA.id, '--collector', ca.id, '--revision', '1', '--category', 'long'], '', 'backend-a')).code).toBe(0);
    const complete = await run(['complete', ownedA.id, '--collector', ca.id, '--revision', '2'], '', 'backend-a');
    expect(complete.code).toBe(0); expect(JSON.parse(complete.stdout)).toMatchObject({ collectorId: ca.id, todoId: ownedA.id, revision: 3 });
    expect((await run(['reopen', ownedA.id, '--collector', ca.id, '--revision', '3'], '', 'backend-a')).code).toBe(0);
    expect(JSON.parse((await run(['ignore', ownedA.id, '--collector', ca.id, '--revision', '1'], '', 'backend-a')).stdout)).toMatchObject({ currentRevision: 4 });
    store.saveCollector({ ...store.collector(ca.id), name: '改名后的 A' });
    const scoped = JSON.parse((await run(['list', '--collector', ca.id], '', 'backend-a')).stdout);
    expect(scoped.todos.map((t: { id: string }) => t.id)).toEqual([ownedA.id]);
    expect(scoped.collectors.map((c: { id: string; name: string }) => [c.id, c.name])).toEqual([[ca.id, '改名后的 A']]);
    const inspected = JSON.parse((await run(['collector', 'inspect', store.activeCollection(ca.id)!.id], '', 'backend-a')).stdout).run;
    expect(inspected.trigger).toMatchObject({ collectorId: ca.id, triggerType: 'manual', runId: inspected.id });
    expect(JSON.parse((await run(['checkpoint', 'get', '--collector', ca.id, '--source-key', 'source-a'], '', 'backend-a')).stdout).checkpoints[0]).toMatchObject({ revision: 0, cursor: null });
    const outcome = JSON.stringify({ status: 'success', summary: '声明的来源已完整扫描', coverage: [{ sourceKey: 'source-a', status: 'success' }], checkpoints: [{ sourceKey: 'source-a', expectedRevision: 0, cursor: { opaque: 'page-7' } }] });
    const finishArgs = ['collector', 'finish', inspected.id, '--revision', String(inspected.collection.revision), '--stdin'];
    const committed = await run(finishArgs, outcome, 'backend-a');
    expect(committed.code).toBe(0); expect(JSON.parse(committed.stdout).run.collection.state).toBe('complete');
    expect(JSON.parse((await run(finishArgs, outcome, 'backend-a')).stdout).run.id).toBe(inspected.id);
    expect(JSON.parse((await run(['checkpoint', 'get', '--collector', ca.id, '--source-key', 'source-a'], '', 'backend-a')).stdout).checkpoints[0]).toMatchObject({ revision: 1, cursor: { opaque: 'page-7' }, lastSuccessfulRunId: inspected.id });
    const late = await run(['update', ownedA.id, '--collector', ca.id, '--revision', '4', '--title', '旧轮次迟到写入'], '', 'backend-a');
    expect(late.code).toBe(1); expect(JSON.parse(late.stdout).code).toBe('COLLECTOR_RUN_FENCED');
    expect(new TodoStore(path.join(state, 'todos.json')).collectorForSession('session-a')).toBe(ca.id);
    expect(runtime.launch).not.toHaveBeenCalled();
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); fs.rmSync(directory, { recursive: true, force: true }); }
}, 30000);
