import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TodoStore } from './store.js';
import { TodoRunner, type TodoRuntime } from './routes.js';
import type { CollectorFinishInput, TodoRun } from './types.js';

let directory: string, file: string, store: TodoStore, runtime: TodoRuntime, runner: TodoRunner;
const config = { agentSlug: 'fixture', command: 'fixture', cwd: '/tmp', prompt: '只收集，明确来源覆盖范围' };
const originalTZ = process.env.TZ;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'td-collection-'));
  file = path.join(directory, 'todos.json'); store = new TodoStore(file);
  runtime = { validate: vi.fn(async c => c), launch: vi.fn(async (run, _prompt, created) => created('terminal-' + run.id)),
    collectionSessions: { observe: vi.fn(async () => null), reuse: vi.fn(async () => {}), close: vi.fn(async () => false) } };
  runner = new TodoRunner(store, runtime);
});
afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); vi.restoreAllMocks(); if (originalTZ === undefined) delete process.env.TZ; else process.env.TZ = originalTZ; });
function finish(run: TodoRun, overrides: Partial<CollectorFinishInput> = {}) {
  return store.finishCollection(run.id, { revision: store.run(run.id).collection!.revision, idempotencyKey: 'commit-' + run.id,
    status: 'success', summary: '声明来源已完整扫描，无候选', coverage: [{ sourceKey: 'source-a', status: 'success' }], ...overrides });
}
it('serializes concurrent manual/schedule/webhook requests through the entire run, independently for each collector', async () => {
  const a = store.saveCollector({ name: 'A', config }), b = store.saveCollector({ name: 'B', config });
  const attempts = await Promise.allSettled([
    runner.start('collect', a.id, undefined, 'manual'),
    runner.start('collect', a.id, undefined, 'schedule', undefined, { triggerType: 'schedule', scheduledAt: Date.now() }),
    runner.start('collect', a.id, undefined, 'webhook', undefined, { triggerType: 'webhook', payload: { issue: 7 } }),
  ]);
  expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  for (const attempt of attempts) if (attempt.status === 'rejected') expect(attempt.reason).toMatchObject({ status: 409, code: 'COLLECTOR_BUSY', activeRunId: store.activeCollection(a.id)!.id });
  await runner.start('collect', b.id, undefined, 'b');
  await vi.waitFor(() => expect(runtime.launch).toHaveBeenCalledTimes(2));
  const active = store.activeCollection(a.id)!;
  expect(active.status).toBe('delivered');
  await expect(runner.start('collect', a.id, undefined, 'still-busy')).rejects.toMatchObject({ code: 'COLLECTOR_BUSY' });
  finish(active);
  await runner.start('collect', a.id, undefined, 'after-finish');
  expect(runtime.launch).toHaveBeenCalledTimes(3);
});
it('replays stable trigger identity even after configuration changes and rejects different payloads without new launches', async () => {
  const collector = store.saveCollector({ name: '来源', config });
  const [first, duplicate] = await Promise.all([
    runner.start('collect', collector.id, undefined, 'event', undefined, { triggerType: 'webhook', payload: { b: 2, a: 1 } }),
    runner.start('collect', collector.id, undefined, 'event', undefined, { triggerType: 'webhook', payload: { a: 1, b: 2 } }),
  ]);
  expect(first.id).toBe(duplicate.id); expect(runtime.launch).toHaveBeenCalledOnce();
  const before = store.run(first.id).trigger;
  store.saveCollector({ ...store.collector(collector.id), name: '改名', config: { ...config, prompt: '修改要求' } });
  const replay = await runner.start('collect', collector.id, undefined, 'event', undefined, { triggerType: 'webhook', payload: { a: 1, b: 2 } });
  expect(replay.trigger).toEqual(before); expect(replay.config.prompt).toBe(config.prompt);
  await expect(runner.start('collect', collector.id, undefined, 'event', undefined, { triggerType: 'webhook', payload: { a: 9 } })).rejects.toMatchObject({ code: 'COLLECTOR_TRIGGER_CONFLICT' });
  expect(runtime.launch).toHaveBeenCalledOnce(); expect(store.snapshot().runs).toHaveLength(1);
  const prompt = vi.mocked(runtime.launch).mock.calls[0][1];
  expect(prompt).toContain(JSON.stringify(before)); expect(prompt).toContain(`--run ${first.id}`);
});
it('commits all source CAS updates with outcome atomically and preserves opaque cursors across restart', async () => {
  const c = store.saveCollector({ name: '来源', config });
  const run = await runner.start('collect', c.id, undefined, 'first');
  finish(run, { coverage: [{ sourceKey: 'a', status: 'success' }, { sourceKey: 'b', status: 'success' }], checkpoints: [
    { sourceKey: 'a', expectedRevision: 0, cursor: { opaque: ['cursor', 7] } }, { sourceKey: 'b', expectedRevision: 0, cursor: 'b1' },
  ] });
  expect(store.checkpoints(c.id, 'a')).toMatchObject({ revision: 1, cursor: { opaque: ['cursor', 7] }, lastSuccessfulRunId: run.id });
  const second = await runner.start('collect', c.id, undefined, 'second');
  const before = store.snapshot();
  expect(() => finish(second, { coverage: [{ sourceKey: 'a', status: 'success' }, { sourceKey: 'b', status: 'success' }], checkpoints: [
    { sourceKey: 'a', expectedRevision: 1, cursor: 'a2' }, { sourceKey: 'b', expectedRevision: 0, cursor: 'b2' },
  ] })).toThrow('checkpoint b 已更新');
  expect(store.snapshot()).toEqual(before);
  const commit: CollectorFinishInput = { revision: store.run(second.id).collection!.revision, idempotencyKey: 'atomic', status: 'success', summary: '两个来源已扫描', coverage: [{ sourceKey: 'a', status: 'success' }, { sourceKey: 'b', status: 'success' }], checkpoints: [
    { sourceKey: 'a', expectedRevision: 1, cursor: 'a2' }, { sourceKey: 'b', expectedRevision: 1, cursor: 'b2' },
  ] };
  const completed = store.finishCollection(second.id, commit);
  expect(store.finishCollection(second.id, commit)).toEqual(completed);
  expect(() => store.finishCollection(second.id, { ...commit, summary: '不同结果' })).toThrow('结果不一致');
  expect(new TodoStore(file).checkpoints(c.id)).toEqual(store.checkpoints(c.id));
  expect(store.checkpoints(c.id, 'a')).toMatchObject({ revision: 2, cursor: 'a2', lastSuccessfulRunId: second.id });
});
it('does not advance checkpoints on partial/failed results, incomplete coverage or text reports', async () => {
  const c = store.saveCollector({ name: '来源', config });
  let run = await runner.start('collect', c.id, undefined, 'first');
  for (const status of ['partial', 'failed'] as const) expect(() => finish(run, { status, coverage: [{ sourceKey: 'source-a', status }], checkpoints: [{ sourceKey: 'source-a', expectedRevision: 0, cursor: 'skip' }] })).toThrow('只有显式成功');
  expect(() => finish(run, { coverage: [] })).toThrow('声明来源');
  expect(() => finish(run, { coverage: [{ sourceKey: 'source-a', status: 'partial' }] })).toThrow('声明来源');
  finish(run, { status: 'partial', summary: '来源 A 无权限，来源 B 已查看', coverage: [{ sourceKey: 'docs', status: 'failed', note: 'FORBIDDEN' }, { sourceKey: 'source-a', status: 'success' }] });
  expect(store.checkpoints(c.id)).toEqual([]);
  run = await runner.start('collect', c.id, undefined, 'second');
  store.report(run.id, 'complete', '新增零条；普通文字报告没有完整扫描承诺');
  expect(store.checkpoints(c.id)).toEqual([]);
  expect(() => store.create({ title: '迟到写入', collectorId: c.id, runId: run.id })).toThrow('本轮已结束');
});
it('persists interrupted gates after restart and retries once with lineage while fencing old writes and reports', async () => {
  const c = store.saveCollector({ name: '来源', config });
  const run = await runner.start('collect', c.id, undefined, 'original', undefined, { triggerType: 'webhook', payload: { event: 7 } });
  await vi.waitFor(() => expect(store.run(run.id).status).toBe('delivered'));
  store = new TodoStore(file); runner = new TodoRunner(store, runtime);
  const interrupted = store.run(run.id);
  expect(interrupted.collection?.state).toBe('interrupted');
  await expect(runner.start('collect', c.id, undefined, 'new-event')).rejects.toMatchObject({ code: 'COLLECTOR_BUSY', activeRunId: run.id });
  expect(() => store.create({ title: '旧轮次', collectorId: c.id, runId: run.id })).toThrow('本轮已结束');
  const retried = await runner.retry(run.id, interrupted.collection!.revision, 'retry-1');
  expect(retried.trigger?.payload).toEqual({ event: 7 }); expect(retried.collection?.previousRunId).toBe(run.id);
  expect((await runner.retry(run.id, interrupted.collection!.revision, 'retry-1')).id).toBe(retried.id);
  expect(runtime.launch).toHaveBeenCalledTimes(2);
  expect(() => store.report(run.id, 'complete', '迟到结果')).toThrow('已失效');
  expect(() => finish(run)).toThrow('本轮已结束');
  expect(() => store.update(store.create({ title: '人工条目', collectorId: c.id }).id, { revision: 1, collectorId: c.id, runId: run.id, title: '过期覆盖' })).toThrow('本轮已结束');
  expect(store.activeCollection(c.id)?.id).toBe(retried.id);
});
it('requires the old terminal to be observably absent for owner retry or cancellation', async () => {
  const c = store.saveCollector({ name: '来源', config });
  const run = await runner.start('collect', c.id, undefined, 'one');
  await vi.waitFor(() => expect(store.run(run.id).status).toBe('delivered'));
  vi.mocked(runtime.collectionSessions!.observe).mockResolvedValue({ identity: 'live', ownershipIdentity: 'live', lastOutputAt: Date.now(), observedAt: Date.now() });
  const before = store.snapshot();
  await expect(runner.cancel(run.id, store.run(run.id).collection!.revision)).rejects.toMatchObject({ code: 'COLLECTOR_RUNTIME_PRESENT' });
  await expect(runner.retry(run.id, store.run(run.id).collection!.revision, 'retry')).rejects.toMatchObject({ code: 'COLLECTOR_RUNTIME_PRESENT' });
  expect(store.snapshot()).toEqual(before);
  vi.mocked(runtime.collectionSessions!.observe).mockResolvedValue(null);
  await runner.cancel(run.id, store.run(run.id).collection!.revision);
  expect(store.run(run.id).collection?.state).toBe('cancelled'); expect(store.checkpoints(c.id)).toEqual([]);
});
it('records a late terminal opening after cancellation but fences the Agent command before delivery', async () => {
  const c = store.saveCollector({ name: '来源', config }), command = vi.fn();
  let opened!: () => void;
  runtime.launch = vi.fn(async (_run, _prompt, created) => {
    await new Promise<void>(resolve => { opened = resolve; });
    created('late-terminal'); command();
  });
  const run = await runner.start('collect', c.id, undefined, 'opening');
  await runner.cancel(run.id, store.run(run.id).collection!.revision);
  opened();
  await vi.waitFor(() => expect(store.run(run.id).sessionId).toBe('late-terminal'));
  expect(store.run(run.id).collection?.state).toBe('cancelled'); expect(command).not.toHaveBeenCalled();
  expect(() => store.create({ title: '被取消的轮次', collectorId: c.id, runId: run.id })).toThrow('本轮已结束');
});
it('rejects unsafe or oversized payloads before acceptance and keeps trigger records immutable', async () => {
  const c = store.saveCollector({ name: '来源', config, webhook: { enabled: true, secret: "" } });
  for (const payload of [{ authorization: 'secret' }, { nested: { access_token: 'secret' } }, { headers: { 'X-Api-Key': 'secret' } }, { text: '界'.repeat(6000) }]) {
    await expect(runner.start('collect', c.id, undefined, 'unsafe', undefined, { triggerType: 'webhook', payload })).rejects.toThrow();
    expect(store.snapshot().runs).toHaveLength(0);
  }
  const run = await runner.start('collect', c.id, undefined, 'safe', undefined, { triggerType: 'webhook', payload: { resourceId: 'message-7' } });
  expect(JSON.stringify(run.trigger)).not.toContain(c.webhook!.secret);
  expect(vi.mocked(runtime.launch).mock.calls[0][1]).not.toContain(c.webhook!.secret);
  const envelope = structuredClone(run.trigger);
  store.mark(run.id, { status: 'delivered' }); store.report(run.id, 'failed', '来源读取失败');
  expect(new TodoStore(file).run(run.id).trigger).toEqual(envelope);
});
it('keeps a busy schedule due and coalesces elapsed slots into one later checkpoint-based catch-up', async () => {
  process.env.TZ = 'Asia/Shanghai';
  const at = (hour: number) => new Date(`2026-10-26T${String(hour).padStart(2, '0')}:00:00+08:00`).getTime();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(at(11));
  const c = store.saveCollector({ name: '工作日', config, schedule: { kind: 'daily', time: '12:00', times: ['12:00', '16:00', '20:00', '23:00'], weekdays: [1, 2, 3, 4, 5] } });
  clock.mockReturnValue(at(12)); await runner.tick();
  const first = store.activeCollection(c.id)!;
  clock.mockReturnValue(at(21)); await runner.tick(); await runner.tick();
  expect(runtime.launch).toHaveBeenCalledOnce(); expect(store.collector(c.id).nextRunAt).toBe(at(16));
  finish(first); await runner.tick();
  expect(runtime.launch).toHaveBeenCalledTimes(2);
  expect(store.activeCollection(c.id)?.trigger).toMatchObject({ triggerType: 'schedule', scheduledAt: at(16), receivedAt: at(21), timezone: 'Asia/Shanghai' });
  expect(store.collector(c.id).nextRunAt).toBe(at(23));
});
it('keeps accepted schedule keys stable across clock rollback and the repeated DST hour', async () => {
  process.env.TZ = 'America/New_York';
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-01T01:00:00-04:00'));
  const c = store.saveCollector({ name: 'DST', config, schedule: { kind: 'daily', time: '01:30', weekdays: [0, 1, 2, 3, 4, 5, 6] } });
  clock.mockReturnValue(Date.parse('2026-11-01T01:31:00-04:00')); await runner.tick(); finish(store.activeCollection(c.id)!);
  clock.mockReturnValue(Date.parse('2026-11-01T01:15:00-04:00')); await runner.tick();
  clock.mockReturnValue(Date.parse('2026-11-01T01:31:00-05:00')); await runner.tick();
  expect(runtime.launch).toHaveBeenCalledOnce(); expect(store.collector(c.id).nextRunAt).toBe(Date.parse('2026-11-02T01:30:00-05:00'));
});
it('uses the server calendar normalization for a nonexistent DST wall time', async () => {
  process.env.TZ = 'America/New_York';
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-03-08T01:00:00-05:00'));
  const c = store.saveCollector({ name: 'DST', config, schedule: { kind: 'daily', time: '02:30', weekdays: [0, 1, 2, 3, 4, 5, 6] } });
  expect(store.collector(c.id).nextRunAt).toBe(Date.parse('2026-03-08T03:30:00-04:00'));
  clock.mockReturnValue(Date.parse('2026-03-08T03:30:00-04:00')); await runner.tick();
  expect(store.activeCollection(c.id)?.trigger).toMatchObject({ triggerType: 'schedule', timezone: 'America/New_York', scheduledAt: clock() });
  expect(runtime.launch).toHaveBeenCalledOnce();
});
it('refuses storage admission without launching or losing an accepted prior run', async () => {
  const c = store.saveCollector({ name: '容量', config });
  const size = fs.statSync(file).size;
  store = new TodoStore(file, { maxBytes: size + 32 }); runner = new TodoRunner(store, runtime);
  const before = store.snapshot();
  await expect(runner.start('collect', c.id, undefined, 'capacity')).rejects.toThrow('容量上限');
  expect(store.snapshot()).toEqual(before); expect(runtime.launch).not.toHaveBeenCalled();
});
