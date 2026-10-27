import { expect, it, vi } from 'vitest';
import { executeTodoCommand, parseTodoCommand } from './cli.js';
it.each([['add'], ['report', 'run', '--status', 'complete'], ['add', '--title', 'x', '--source'], ['list', '--title', 'x'], ['add', '--title', 'x', '--description', 'one', '--stdin'], ['report', 'run', '--status', 'unknown', '--content', 'x']].map(args => ({ args })))('rejects incomplete or ambiguous arguments $args', ({ args }) => { expect(() => parseTodoCommand(args)).toThrow(); });
it('forwards source and deduplication identity without creating an execution', async () => {
  const io = { request: vi.fn(async () => ({ statusCode: 200, body: '{"todo":{"id":"created"}}' })), stdin: vi.fn(async () => '详细背景'), write: vi.fn() };
  expect(await executeTodoCommand(parseTodoCommand(['add', '--title', '巡检待办', '--source', '项目', '--external-id', 'stable', '--stdin']), io)).toBe(0);
  expect(io.request).toHaveBeenCalledExactlyOnceWith('POST', '/api/terminal/operations/todos', expect.objectContaining({ title: '巡检待办', description: '详细背景', externalId: 'stable', source: '项目' }));
});
it('targets a specific run for reporting and never retries an uncertain write', async () => {
  const io = { request: vi.fn().mockRejectedValue(new Error('connection closed')), stdin: vi.fn(), write: vi.fn() };
  expect(await executeTodoCommand(parseTodoCommand(['report', 'run/id', '--status', 'blocked', '--content', '需要补充资料']), io)).toBe(1);
  expect(io.request).toHaveBeenCalledExactlyOnceWith('POST', '/api/terminal/operations/todos/runs/run%2Fid/report', { status: 'blocked', content: '需要补充资料' });
});
it('shows help without a running service', async () => { const io = { request: vi.fn(), stdin: vi.fn(), write: vi.fn() }; expect(await executeTodoCommand(parseTodoCommand(['--help']), io)).toBe(0); expect(io.request).not.toHaveBeenCalled(); });
it.each([
  ['checkpoint', 'get'], ['checkpoint', 'get', '--collector', 'c', '--title', 'x'],
  ['collector', 'finish', 'run', '--stdin'], ['collector', 'finish', 'run', '--revision', '1'],
  ['collector', 'finish', 'run', '--revision', '0', '--stdin'], ['collector', 'finish', 'run', '--revision', '1', '--stdin', '--file', 'x'],
  ['collector', 'retry', 'run', '--revision', '1'], ['collector', 'cancel', 'run'],
].map(args => ({ args })))('rejects incomplete collector lifecycle commands $args', ({ args }) => expect(() => parseTodoCommand(args)).toThrow());
it('uses bounded read endpoints and explicit CAS for owner recovery', async () => {
  const io = { request: vi.fn(async () => ({ statusCode: 200, body: '{"collectorProtocolVersion":1}' })), stdin: vi.fn(), write: vi.fn() };
  await executeTodoCommand(parseTodoCommand(['checkpoint', 'get', '--collector', 'a/b', '--source-key', 'chat:mentions']), io);
  expect(io.request).toHaveBeenLastCalledWith('GET', '/api/terminal/operations/todos/collectors/a%2Fb/checkpoints?sourceKey=chat%3Amentions', undefined);
  await executeTodoCommand(parseTodoCommand(['collector', 'retry', 'r', '--revision', '7', '--idempotency-key', 'new-attempt']), io);
  expect(io.request).toHaveBeenLastCalledWith('POST', '/api/terminal/operations/todos/runs/r/retry', { revision: 7, idempotencyKey: 'new-attempt' });
  await executeTodoCommand(parseTodoCommand(['collector', 'cancel', 'r', '--revision', '7']), io);
  expect(io.request).toHaveBeenLastCalledWith('POST', '/api/terminal/operations/todos/runs/r/cancel', { revision: 7 });
});
it('rejects an old service before attempting any collector write or recovery', async () => {
  const io = { request: vi.fn(async () => ({ statusCode: 200, body: '{"count":0}' })), stdin: vi.fn(), write: vi.fn() };
  expect(await executeTodoCommand(parseTodoCommand(['add', '--title', '本轮待办', '--collector', 'c', '--run', 'r']), io)).toBe(1);
  expect(io.request).toHaveBeenCalledExactlyOnceWith('GET', '/api/terminal/operations/todos/summary', undefined);
  expect(JSON.parse(io.write.mock.calls[0][0]).error).toContain('一起升级');
});
it.each([
  ['update'], ['update', 'id'], ['update', 'id', '--revision', '1'],
  ['update', 'id', '--category', 'bad'], ['list', '--category', 'bad'],
  ...['0', '-1', '1.5', '1e2', '9007199254740992'].map(revision => ['update', 'id', '--title', 'x', '--revision', revision]),
  ['update', 'id', '--description=', '--stdin'], ['update', 'id', '--source', 'other'],
].map(args => ({ args })))('rejects invalid updates and categories $args', ({ args }) => expect(() => parseTodoCommand(args)).toThrow());
it('updates only supplied fields and uses an explicitly observed revision without refetching', async () => {
  const io = { request: vi.fn(async () => ({ statusCode: 200, body: '{"todo":{"id":"id"}}' })), stdin: vi.fn(async () => '等待 alpha 合入'), write: vi.fn() };
  expect(await executeTodoCommand(parseTodoCommand(['update', 'id', '--stdin', '--category', 'delegated', '--revision', '7', '--url=', '--external-id', 'stable-2']), io)).toBe(0);
  expect(io.request).toHaveBeenCalledExactlyOnceWith('POST', '/api/terminal/operations/todos/id', { description: '等待 alpha 合入', category: 'delegated', revision: 7, sourceUrl: '', externalId: 'stable-2' });
});
it('clears descriptions explicitly without treating an empty value as an omitted field', async () => {
  const io = { request: vi.fn(async () => ({ statusCode: 200, body: '{}' })), stdin: vi.fn(), write: vi.fn() };
  expect(await executeTodoCommand(parseTodoCommand(['update', 'id', '--description=', '--revision', '2']), io)).toBe(0);
  expect(io.request).toHaveBeenCalledExactlyOnceWith('POST', '/api/terminal/operations/todos/id', { description: '', revision: 2 });
});
it('reads a revision for a simple edit without erasing unspecified content and exposes conflicts', async () => {
  const io = { request: vi.fn().mockResolvedValueOnce({ statusCode: 200, body: '{"todos":[{"id":"id","revision":3}]}' }).mockResolvedValueOnce({ statusCode: 409, body: '{"error":"记录已更新","currentRevision":4}' }), stdin: vi.fn(), write: vi.fn() };
  expect(await executeTodoCommand(parseTodoCommand(['update', 'id', '--title', '只改标题']), io)).toBe(1);
  expect(io.request).toHaveBeenLastCalledWith('POST', '/api/terminal/operations/todos/id', { title: '只改标题', revision: 3 });
  expect(JSON.parse(io.write.mock.calls[0][0])).toMatchObject({ ok: false, currentRevision: 4 });
  expect(io.request).toHaveBeenCalledTimes(2);
});
it('filters uncategorized legacy todos and combines source with category', async () => {
  const snapshot = { todos: [{ id: 'legacy', source: 'daily' }, { id: 'short', source: 'daily', category: 'short' }, { id: 'other', source: 'other', category: 'short' }] };
  const io = { request: vi.fn(async () => ({ statusCode: 200, body: JSON.stringify(snapshot) })), stdin: vi.fn(), write: vi.fn() };
  await executeTodoCommand(parseTodoCommand(['list', '--category', 'uncategorized']), io);
  expect(JSON.parse(io.write.mock.calls[0][0]).todos.map((t: { id: string }) => t.id)).toEqual(['legacy']);
  await executeTodoCommand(parseTodoCommand(['list', '--category', 'short', '--source', 'daily']), io);
  expect(JSON.parse(io.write.mock.calls[1][0]).todos.map((t: { id: string }) => t.id)).toEqual(['short']);
});

const collectorArgs = ['collector', 'create', '--name', '社区渠道', '--agent', 'codex', '--prompt', '筛选可执行事项，附上来源，避免重复，只收集不执行'];
it('accepts sorted unique multiple collection times with explicit weekdays', () => {
  expect(parseTodoCommand([...collectorArgs, '--at', '20:00,09:00,09:00', '--weekdays', '1,3,5']).schedule).toEqual({ kind: 'daily', time: '09:00', times: ['09:00', '20:00'], weekdays: [1, 3, 5] });
  for (const at of ['09:00,', '09:00,25:00', '09:00,,20:00']) expect(() => parseTodoCommand([...collectorArgs, '--at', at])).toThrow('--at');
});
it.each([
  ['collector'], ['collector', 'list', '--disabled'], ['collector', 'create', '--name', '渠道'],
  [...collectorArgs, '--stdin'], [...collectorArgs, '--every', '0'], [...collectorArgs, '--every', '1.5'],
  [...collectorArgs, '--every', '43201'], [...collectorArgs, '--at', '24:00'],
  [...collectorArgs, '--weekdays', '1'], [...collectorArgs, '--at', '09:00', '--weekdays', '7'],
  [...collectorArgs, '--at', '09:00', '--every', '60'], [...collectorArgs, 'unexpected'],
].map(args => ({ args })))('rejects ambiguous collector configuration $args', ({ args }) => { expect(() => parseTodoCommand(args)).toThrow(); });

it('discovers Agents and lists directions through read-only service requests', async () => {
  const io = { request: vi.fn().mockResolvedValueOnce({ statusCode: 200, body: '{"agents":[{"slug":"codex","command":"codex"}]}' }).mockResolvedValueOnce({ statusCode: 200, body: '{"todos":[],"collectors":[{"id":"channel"}]}' }), stdin: vi.fn(), write: vi.fn() };
  expect(await executeTodoCommand(parseTodoCommand(['agents']), io)).toBe(0);
  expect(await executeTodoCommand(parseTodoCommand(['collector', 'list']), io)).toBe(0);
  expect(io.request.mock.calls).toEqual([['GET', '/api/terminal/agent-launchers'], ['GET', '/api/terminal/operations/todos', undefined]]);
  expect(JSON.parse(io.write.mock.calls[1][0])).toEqual({ collectors: [{ id: 'channel' }] });
});

it('creates a scheduled direction using the detected launch command without launching an Agent', async () => {
  const io = { request: vi.fn().mockResolvedValueOnce({ statusCode: 200, body: '{"agents":[{"slug":"codex","command":"codex --profile collector"}]}' }).mockResolvedValueOnce({ statusCode: 200, body: '{"collector":{"id":"created"}}' }), stdin: vi.fn(), write: vi.fn() };
  expect(await executeTodoCommand(parseTodoCommand([...collectorArgs, '--cwd', '/tmp', '--at', '09:00', '--weekdays', '1,2,3,4,5']), io)).toBe(0);
  expect(io.request).toHaveBeenLastCalledWith('POST', '/api/terminal/operations/todos/collectors', {
    name: '社区渠道', config: { agentSlug: 'codex', command: 'codex --profile collector', cwd: '/tmp', prompt: collectorArgs.at(-1) },
    enabled: true, schedule: { kind: 'daily', time: '09:00', weekdays: [1, 2, 3, 4, 5] },
  });
  expect(io.request).toHaveBeenCalledTimes(2);
});

it('accepts stdin and an explicit command, defaults to manual, and supports disabled intervals', async () => {
  const io = { request: vi.fn(async () => ({ statusCode: 200, body: '{"collector":{"id":"saved"}}' })), stdin: vi.fn(async () => '从当前讨论的渠道收集，保留链接'), write: vi.fn() };
  const args = ['collector', 'create', '--name', '渠道', '--agent', 'codex', '--command', 'codex --profile work', '--stdin'];
  expect(await executeTodoCommand(parseTodoCommand(args), io)).toBe(0);
  expect(io.request).toHaveBeenLastCalledWith('POST', '/api/terminal/operations/todos/collectors', expect.objectContaining({ schedule: null, enabled: true, config: { agentSlug: 'codex', command: 'codex --profile work', cwd: process.cwd(), prompt: '从当前讨论的渠道收集，保留链接' } }));
  expect(await executeTodoCommand(parseTodoCommand([...args, '--every', '120', '--disabled']), io)).toBe(0);
  expect(io.request).toHaveBeenLastCalledWith('POST', '/api/terminal/operations/todos/collectors', expect.objectContaining({ schedule: { kind: 'interval', everyMinutes: 120 }, enabled: false }));
});

it('rejects empty collection requirements and unavailable Agents without writing or retrying', async () => {
  const io = { request: vi.fn(async () => ({ statusCode: 200, body: '{"agents":[]}' })), stdin: vi.fn(async () => '  '), write: vi.fn() };
  expect(await executeTodoCommand(parseTodoCommand(['collector', 'create', '--name', '渠道', '--agent', 'codex', '--stdin']), io)).toBe(1);
  expect(io.request).not.toHaveBeenCalled();
  expect(await executeTodoCommand(parseTodoCommand(collectorArgs), io)).toBe(1);
  expect(io.request).toHaveBeenCalledTimes(1);
  io.request.mockRejectedValueOnce(new Error('connection closed'));
  expect(await executeTodoCommand(parseTodoCommand([...collectorArgs, '--command', 'codex']), io)).toBe(1);
  expect(io.request).toHaveBeenCalledTimes(2);
});
