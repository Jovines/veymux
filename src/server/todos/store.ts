import fs from 'node:fs';
import { activeCollection, assertCollectionWrite, beginCollection as reserveCollection, collectionKey, finishCollection as commitCollection, previousCollection, sourceKey } from './collection.js';
import type { CollectorFinishInput, CollectorTriggerInput } from './types.js';
import { TodoError } from './errors.js';
export { TodoError } from './errors.js';
import { canClaimTodo } from './claimEligibility.js';
import { JsonStorageBudget, type JsonStorageOptions } from '../utils/jsonStorageBudget.js';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { nextAutomationRunAt, normalizeAutomationSchedule } from '../agent/automationStore.js';
import { COLLECTOR_PROTOCOL_VERSION, isTodoCategory, type TodoUpdateInput, type TodoCollector, type TodoCreateInput, type TodoHandoffInput, type TodoItem, type TodoLaunchConfig, type TodoProcessing, type TodoRun, type TodoSessionPolicy, type TodoSnapshot } from './types.js';

interface Document extends TodoSnapshot { version: 1; requests: Record<string, { hash: string; id: string }> }
function string(value: unknown, max: number, fallback = ''): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) throw new TodoError('内容格式或长度无效');
  return value.trim();
}
function title(value: unknown): string { const s = string(value, 200); if (!s) throw new TodoError('请填写标题'); return s; }
function sourceLink(value: unknown): string {
  const url = string(value, 4096);
  if (url) { try { if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error(); } catch { throw new TodoError('来源链接须为有效的 http 或 https 地址'); } }
  return url;
}
function category(value: unknown) { if (!isTodoCategory(value)) throw new TodoError('分类须为 short、long、delegated 或 uncategorized'); return value; }
export function launchConfig(input: Partial<TodoLaunchConfig>, base?: TodoLaunchConfig): TodoLaunchConfig {
  return { agentSlug: string(input.agentSlug, 100, base?.agentSlug), command: string(input.command, 4000, base?.command),
    cwd: string(input.cwd, 4096, base?.cwd), prompt: string(input.prompt, 20000, base?.prompt) };
}
export function processingPolicy(input?: Partial<TodoProcessing>, base?: TodoLaunchConfig): TodoProcessing {
  if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input))) throw new TodoError('自动处理配置无效');
  const mode = input?.mode ?? 'manual';
  if (!['manual', 'new', 'existing'].includes(mode)) throw new TodoError('自动处理方式无效');
  const sessionId = mode === 'existing' ? string(input?.sessionId ?? undefined, 200) || null : null;
  if (mode === 'existing' && !sessionId) throw new TodoError('请选择自动处理的目标会话');
  return { mode, sessionId, config: mode === 'new' ? launchConfig(input?.config ?? {}, base) : null, note: string(input?.note, 4000) };
}
export function collectionSessionPolicy(input?: Partial<TodoSessionPolicy>): TodoSessionPolicy {
  if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input))) throw new TodoError('会话配置无效');
  const mode = input?.mode ?? 'new', idleMinutes = input?.idleMinutes ?? 10;
  if (!['new', 'reuse'].includes(mode) || !Number.isInteger(idleMinutes) || idleMinutes < 0 || idleMinutes > 43200) throw new TodoError('回收时间须为 0 至 43200 的整数分钟（0 表示关闭）');
  const targetSessionId = string(input?.targetSessionId ?? undefined, 200) || null;
  return { mode, targetSessionId: mode === 'reuse' ? targetSessionId : null, beforePrompt: string(input?.beforePrompt, 4000), idleMinutes };
}
const blank = (): Document => ({ version: 1, todos: [], collectors: [], runs: [], requests: {}, defaults: { agentSlug: '', command: '', cwd: '', prompt: '' } });
export class TodoStore {
  private doc: Document = blank();
  private storage: JsonStorageBudget;
  constructor(file: string, options: JsonStorageOptions = {}) {
    this.storage = new JsonStorageBudget(file, 'todos', 'VEYMUX_TODO_STORAGE_MAX_BYTES', 32 * 1024 * 1024,
      () => new TodoError('待办新增内容已达容量上限；可完成或释放已有工作，或调整 VEYMUX_TODO_STORAGE_MAX_BYTES', 409), options);
    try {
      const doc = JSON.parse(fs.readFileSync(file, 'utf8')) as Document;
      if (doc.version !== 1 || !Array.isArray(doc.todos) || !Array.isArray(doc.collectors) || !Array.isArray(doc.runs) || !doc.requests || !doc.defaults) throw new Error('无效的 Todo 数据文件');
      this.doc = doc;
      // Never replay an unconfirmed terminal operation after restart.
      if (doc.runs.some(run => run.status === 'launching' || run.kind === 'collect' && (run.collection?.state === 'active' || run.status === 'delivered' && !run.result))) this.transaction(next => {
        for (const run of next.runs) {
          if (run.kind === 'collect' && (run.collection?.state === 'active' || !run.collection && ['launching', 'delivered'].includes(run.status) && !run.result)) {
            run.collection = { ...run.collection, state: 'interrupted', revision: (run.collection?.revision ?? 0) + 1 };
            run.status = 'failed'; run.error = '服务重启，本轮结果待核对；请关闭原收集终端后显式重试'; run.updatedAt = Date.now();
          } else if (run.status === 'launching') { run.status = 'failed'; run.error = '服务重启中断了启动确认，请检查已有终端后重新发起'; run.updatedAt = Date.now(); }
        }
      }, true);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  storageStatus() { return this.storage.status(); }
  private transaction<T>(change: (doc: Document) => T, control = false): T {
    const next = structuredClone(this.doc), result = change(next);
    const bytes = JSON.stringify(next);
    this.storage.write(bytes, control);
    this.doc = next; return structuredClone(result);
  }
  openCount(collectorId?: string): number { return this.doc.todos.filter(t => t.status === 'open' && (!collectorId || t.collectorId === collectorId)).length; }
  /** Session provenance survives direction removal and display-name edits. */
  collectionSessions(): Map<string, string> {
    const latest = new Map<string, TodoRun>();
    for (const run of this.doc.runs) if (run.sessionId) latest.set(run.sessionId, run);
    return new Map([...latest.values()].filter(run => run.kind === 'collect' && run.collectionSession?.owned !== false && !run.collectionSession?.recycledAt).map(run => [run.sessionId!, run.id]));
  }
  snapshot(): TodoSnapshot { const { requests: _, version: _v, ...snapshot } = this.doc; return { ...structuredClone(snapshot), collectorProtocolVersion: COLLECTOR_PROTOCOL_VERSION }; }
  get(id: string): TodoItem { const todo = this.doc.todos.find(t => t.id === id); if (!todo) throw new TodoError('待办不存在', 404); return structuredClone(todo); }
  assertCollector(todo: TodoItem, collectorId: unknown): void {
    if (collectorId !== undefined && (typeof collectorId !== 'string' || !collectorId || todo.collectorId !== collectorId)) throw new TodoError('ownership mismatch: 待办不属于此 collector', 403, undefined, 'TODO_OWNERSHIP_MISMATCH');
  }
  /** A handoff must never promote a collector process back to owner privileges. */
  collectorForSession(sessionId: string): string | null {
    const latest = [...this.doc.runs].reverse().find(run => run.kind === 'collect' && run.sessionId === sessionId);
    return latest?.collectorId ?? null;
  }
  collector(id: string): TodoCollector { const collector = this.doc.collectors.find(c => c.id === id); if (!collector) throw new TodoError('收集方向不存在', 404); return structuredClone(collector); }
  run(id: string): TodoRun { const run = this.doc.runs.find(r => r.id === id); if (!run) throw new TodoError('执行记录不存在', 404); return structuredClone(run); }
  private check(revision: unknown, current: number) { if (revision !== current) throw new TodoError('记录已更新，请刷新后重试', 409, current); }
  create(input: TodoCreateInput): TodoItem {
    if (input.runId !== undefined) assertCollectionWrite(this.doc, input.collectorId, input.runId);
    const sourceUrl = sourceLink(input.sourceUrl);
    const collectorId = string(input.collectorId, 100) || null;
    const collectorName = collectorId ? this.doc.collectors.find(c => c.id === collectorId)?.name ?? this.doc.runs.find(r => r.collectorId === collectorId)?.name : null;
    if (collectorId && !collectorName) throw new TodoError('收集方向不存在', 404);
    const values = { title: title(input.title), description: string(input.description, 40000), source: string(input.source, 200, collectorName ?? '手动添加') || '外部注入',
      sourceUrl, externalId: string(input.externalId, 500), collectorId, ...(input.category === undefined ? {} : { category: category(input.category) }) };
    const key = string(input.idempotencyKey, 200);
    const hash = this.hash(values);
    const previous = key && this.doc.requests[`create:${key}`];
    if (previous) { if (previous.hash !== hash) throw new TodoError('同一请求标识的内容不一致', 409); return this.get(previous.id); }
    const existing = values.externalId && this.doc.todos.find(t => (values.collectorId ? t.collectorId === values.collectorId : !t.collectorId && t.source === values.source) && t.externalId === values.externalId);
    if (existing) return structuredClone(existing);
    return this.transaction(doc => {
      const now = Date.now(); const todo: TodoItem = { ...values, id: randomUUID(), status: 'open', createdAt: now, updatedAt: now, revision: 1 };
      const collector = collectorId ? doc.collectors.find(c => c.id === collectorId) : null;
      if (collector?.enabled && collector.processing?.mode && collector.processing.mode !== 'manual') todo.autoProcessing = { policy: structuredClone(collector.processing), state: 'pending', runId: null, error: '' };
      doc.todos.unshift(todo); if (key) doc.requests[`create:${key}`] = { hash, id: todo.id }; return todo;
    });
  }
  update(id: string, input: TodoUpdateInput): TodoItem {
    if (input.runId !== undefined) assertCollectionWrite(this.doc, input.collectorId, input.runId);
    if ('source' in input || 'sourceId' in input) throw new TodoError('待办来源命名空间不可修改');
    return this.transaction(doc => {
      const todo = doc.todos.find(t => t.id === id); if (!todo) throw new TodoError('待办不存在', 404);
      this.assertCollector(todo, input.collectorId); this.check(input.revision, todo.revision);
      if (input.title !== undefined) todo.title = title(input.title);
      if (input.description !== undefined) todo.description = string(input.description, 40000);
      if (input.category !== undefined) todo.category = category(input.category);
      if (input.sourceUrl !== undefined) todo.sourceUrl = sourceLink(input.sourceUrl);
      if (input.externalId !== undefined) {
        const externalId = string(input.externalId, 500);
        if (externalId && doc.todos.some(other => other.id !== id && other.externalId === externalId
          && (todo.collectorId ? other.collectorId === todo.collectorId : !other.collectorId && other.source === todo.source))) throw new TodoError('同一来源已存在此外部标识', 409);
        todo.externalId = externalId;
      }
      if (input.status !== undefined) { if (!['open', 'completed', 'ignored'].includes(input.status)) throw new TodoError('待办状态无效'); todo.status = input.status; if (input.status !== 'open') todo.claim = null; }
      todo.revision++; todo.updatedAt = Date.now(); return todo;
    }, input.title === undefined && input.description === undefined && input.category === undefined && input.sourceUrl === undefined && input.externalId === undefined && (input.status === 'completed' || input.status === 'ignored'));
  }
  defaults(input: Partial<TodoLaunchConfig>): TodoLaunchConfig { const config = launchConfig(input, this.doc.defaults); return this.transaction(doc => doc.defaults = config); }
  saveCollector(input: Partial<TodoCollector> & { name: string; config: TodoLaunchConfig }): TodoCollector {
    const name = title(input.name), config = launchConfig(input.config);
    if (!config.agentSlug || !config.command || !config.prompt) throw new TodoError('请选择 Agent 并填写收集提示词');
    if (input.webhook !== undefined && (!input.webhook || typeof input.webhook !== 'object' || Array.isArray(input.webhook) || typeof input.webhook.enabled !== 'boolean')) throw new TodoError('Webhook 配置无效');
    const schedule = input.schedule == null ? null : normalizeAutomationSchedule(input.schedule);
    if (input.schedule != null && !schedule) throw new TodoError('运行频率无效');
    return this.transaction(doc => {
      const previous = input.id ? doc.collectors.find(c => c.id === input.id) : null;
      if (input.id && !previous) throw new TodoError('收集方向不存在', 404);
      if (previous) this.check(input.revision, previous.revision);
      if (input.checkpoints !== undefined && JSON.stringify(input.checkpoints) !== JSON.stringify(previous?.checkpoints ?? [])) throw new TodoError('checkpoint 只能通过 collector finish 成功提交');
      const now = Date.now(), enabled = input.enabled !== false;
      const session = collectionSessionPolicy(input.session ?? previous?.session);
      const processing = processingPolicy(input.processing ?? previous?.processing, config);
      const webhook = { enabled: input.webhook?.enabled ?? previous?.webhook?.enabled ?? false,
        secret: previous?.webhook?.secret || (input.webhook?.enabled ? randomBytes(32).toString('base64url') : '') };
      const collector: TodoCollector = { session, processing, webhook, id: previous?.id ?? randomUUID(), name, config, enabled, schedule,
        nextRunAt: schedule && enabled ? (previous?.enabled && JSON.stringify(previous.schedule) === JSON.stringify(schedule) ? previous.nextRunAt : nextAutomationRunAt(schedule, now, now)) : null,
        ...(previous?.checkpoints ? { checkpoints: previous.checkpoints } : {}),
        createdAt: previous?.createdAt ?? now, updatedAt: now, revision: (previous?.revision ?? 0) + 1 };
      if (previous) Object.assign(previous, collector); else doc.collectors.push(collector); return collector;
    });
  }
  removeCollector(id: string, revision: number): void { this.transaction(doc => { const c = doc.collectors.find(c => c.id === id); if (!c) throw new TodoError('收集方向不存在', 404); this.check(revision, c.revision); doc.collectors = doc.collectors.filter(c => c.id !== id); }); }
  due(now = Date.now()): TodoCollector[] { return this.doc.collectors.filter(c => c.enabled && c.nextRunAt !== null && c.nextRunAt <= now).map(c => structuredClone(c)); }
  activeCollection(collectorId: string): TodoRun | undefined { return structuredClone(activeCollection(this.doc, collectorId)); }
  assertCollectionWrite(collectorId: unknown, runId: unknown): TodoRun { return structuredClone(assertCollectionWrite(this.doc, collectorId, runId)); }
  checkpoints(collectorId: string, key?: string) {
    const points = this.collector(collectorId).checkpoints ?? [];
    if (key === undefined) return points;
    const normalized = sourceKey(key);
    return points.find(point => point.sourceKey === normalized) ?? { sourceKey: normalized, revision: 0, cursor: null, lastSuccessfulAt: null, lastSuccessfulRunId: null };
  }
  previousCollection(id: string, key: string, trigger: CollectorTriggerInput, overrides?: Partial<TodoLaunchConfig>): TodoRun | undefined {
    return structuredClone(previousCollection(this.doc, id, key, trigger, overrides));
  }
  beginCollection(id: string, config: TodoLaunchConfig, key: string, trigger: CollectorTriggerInput, overrides?: Partial<TodoLaunchConfig>): { run: TodoRun; fresh: boolean } {
    return this.transaction(doc => {
      const result = reserveCollection(doc, id, config, key, trigger, overrides);
      if (result.fresh) { const policy = collectionSessionPolicy(doc.collectors.find(c => c.id === id)!.session); result.run.collectionSession = { ...policy, owned: !policy.targetSessionId }; }
      return result;
    });
  }
  finishCollection(id: string, input: CollectorFinishInput): TodoRun { return this.transaction(doc => commitCollection(doc, id, input)); }
  cancelCollection(id: string, revision: number): TodoRun {
    return this.transaction(doc => {
      const run = doc.runs.find(run => run.id === id);
      if (!run || run.kind !== 'collect' || !run.collection) throw new TodoError('收集记录不存在', 404);
      this.check(revision, run.collection.revision);
      if (!['active', 'interrupted'].includes(run.collection.state)) throw new TodoError('本轮已结束', 409);
      run.collection.state = 'cancelled'; run.collection.revision++;
      run.status = 'failed'; run.error = '已结束本轮；checkpoint 未推进'; run.updatedAt = Date.now(); return run;
    }, true);
  }
  retryCollection(id: string, revision: number, key: string): { run: TodoRun; fresh: boolean } {
    key = collectionKey(key);
    return this.transaction(doc => {
      const old = doc.runs.find(run => run.id === id);
      if (!old || !old.trigger || !old.collection) throw new TodoError('旧版收集记录不能直接重试，请核对后新建一轮', 409);
      if (old.collection.retryRunId) {
        const retried = doc.runs.find(run => run.id === old.collection!.retryRunId)!;
        if (retried.trigger?.idempotencyKey !== key) throw new TodoError('此轮已重试，请检查关联的新一轮', 409);
        return { run: retried, fresh: false };
      }
      this.check(revision, old.collection.revision);
      if (key === old.trigger.idempotencyKey) throw new TodoError('显式重试须使用新的请求标识');
      if (old.collection.state === 'complete') throw new TodoError('成功轮次不重试，请发起新的收集', 409);
      old.collection.state = 'cancelled'; old.collection.revision++; old.status = 'failed'; old.error = '已显式重试，旧轮次写入被拒绝'; old.updatedAt = Date.now();
      const { triggerType, scheduledAt, payload } = old.trigger;
      const result = reserveCollection(doc, old.collectorId!, old.config, key, { triggerType, scheduledAt, payload }, undefined, old.id);
      if (!result.fresh) throw new TodoError('重试标识已用于其他收集请求', 409);
      const policy = collectionSessionPolicy(doc.collectors.find(c => c.id === old.collectorId)!.session);
      result.run.collectionSession = { ...policy, owned: !policy.targetSessionId };
      old.collection.retryRunId = result.run.id; return result;
    });
  }
  begin(kind: TodoRun['kind'], id: string, config: TodoLaunchConfig, key: string): { run: TodoRun; fresh: boolean } {
    if (kind === 'collect') return this.beginCollection(id, config, key, { triggerType: 'manual' }, config);
    if (!key || key.length > 200) throw new TodoError('缺少有效的请求标识');
    const hash = this.hash({ kind, id, config }), previous = this.doc.requests[`run:${key}`];
    if (previous) { if (previous.hash !== hash) throw new TodoError('同一请求标识的内容不一致', 409); return { run: this.run(previous.id), fresh: false }; }
    const item = this.get(id);
    if (item.claim && item.claim.expiresAt > Date.now()) throw new TodoError('待办已被领取，请先释放领取', 409);
    if (item.status !== 'open') throw new TodoError('请先重新打开这条待办', 409);
    if (this.doc.runs.some(r => r.status === 'launching' && (r.todoId === id || r.handoff?.todoIds.includes(id)))) throw new TodoError('此项正在启动，请稍候', 409);
    return this.transaction(doc => {
      const now = Date.now(); const run: TodoRun = { id: randomUUID(), kind, todoId: id, collectorId: null,
        name: item.title, config, status: 'launching', createdAt: now, updatedAt: now, sessionId: null, result: '', error: '' };
      const todo = doc.todos.find(t => t.id === id)!;
      if (todo.autoProcessing?.state === 'pending') { todo.autoProcessing.state = 'dispatched'; todo.autoProcessing.runId = run.id; todo.updatedAt = now; todo.revision++; }
      doc.runs.push(run); doc.requests[`run:${key}`] = { hash, id: run.id }; return { run, fresh: true };
    });
  }
  previousHandoff(input: TodoHandoffInput): TodoRun | undefined {
    if (!input.idempotencyKey || input.idempotencyKey.length > 200) throw new TodoError('缺少有效的请求标识');
    const previous = this.doc.requests[`handoff:${input.idempotencyKey}`];
    if (!previous) return;
    if (previous.hash !== this.handoffHash(input)) throw new TodoError('同一请求标识的内容不一致', 409);
    return this.run(previous.id);
  }
  beginHandoff(input: TodoHandoffInput, config: TodoLaunchConfig, sessionName: string): TodoRun {
    const todos = input.todoIds.map(id => this.get(id));
    if (input.idempotencyKey.startsWith('automatic:') && todos.some(todo => todo.autoProcessing?.state !== 'pending')) throw new TodoError('此待办已交接，不重复自动处理', 409);
    if (todos.some(todo => todo.claim && todo.claim.expiresAt > Date.now())) throw new TodoError('待办已被领取，请先释放领取再交接', 409);
    if (todos.some(todo => todo.status !== 'open')) throw new TodoError('请先重新打开已完成或忽略的待办', 409);
    if (this.doc.runs.some(run => run.status === 'launching' && input.todoIds.some(id => run.todoId === id || run.handoff?.todoIds.includes(id)))) throw new TodoError('这些待办正在发送，请稍候', 409);
    return this.transaction(doc => {
      const now = Date.now();
      const run: TodoRun = { id: randomUUID(), kind: 'execute', todoId: todos[0].id, collectorId: null,
        name: todos.length === 1 ? todos[0].title : `${todos.length} 条待办`, config, createdAt: now, updatedAt: now,
        status: 'launching', sessionId: input.sessionId ?? null, result: '', error: '',
        handoff: { todoIds: input.todoIds, note: input.note, targetSessionId: input.sessionId ?? null, sessionName } };
      for (const todo of doc.todos) if (input.todoIds.includes(todo.id) && todo.autoProcessing?.state === 'pending') {
        todo.autoProcessing.state = 'dispatched'; todo.autoProcessing.runId = run.id; todo.updatedAt = now; todo.revision++;
      }
      doc.runs.push(run); doc.requests[`handoff:${input.idempotencyKey}`] = { hash: this.handoffHash(input), id: run.id };
      return run;
    });
  }
  private handoffHash(input: TodoHandoffInput): string {
    return this.hash({ todoIds: input.todoIds, note: input.note, sessionId: input.sessionId ?? null, config: input.sessionId ? null : input.config });
  }
  mark(id: string, update: { sessionId?: string; status?: 'delivered' | 'failed'; error?: string }): TodoRun {
    if (update.error) update = { ...update, error: update.error.slice(0, 4000) };
    return this.transaction(doc => {
      const run = doc.runs.find(r => r.id === id); if (!run) throw new TodoError('执行记录不存在', 404);
      if (update.sessionId) run.sessionId = update.sessionId;
      // An Agent can submit its report before launch delivery acknowledgement returns.
      if (run.status === 'launching') { if (update.status) run.status = update.status; if (update.error) run.error = update.error; }
      if (run.collection?.state === 'active') {
        if (update.status === 'failed') run.collection.state = run.sessionId ? 'interrupted' : 'failed';
        run.collection.revision++;
      } else if (run.collection && update.sessionId) run.collection.revision++;
      run.updatedAt = Date.now(); return run;
    }, true);
  }
  automaticFailed(id: string, error: string): void {
    this.transaction(doc => { const todo = doc.todos.find(t => t.id === id); if (todo?.status === 'open' && todo.autoProcessing?.state === 'pending') {
      todo.autoProcessing.state = 'failed'; todo.autoProcessing.error = error.slice(0, 4000); todo.updatedAt = Date.now(); todo.revision++;
    } }, true);
  }
  claim(input: { source?: string; collectorId?: string; todoId?: string; sessionId: string; sessionName: string; config: TodoLaunchConfig; leaseMinutes: number; requestId: string }): { todo: TodoItem | null; run: TodoRun | null } {
    if (![input.source, input.collectorId, input.todoId].some(value => typeof value === 'string' && value.trim())) throw new TodoError('请先向用户确认领取来源或具体待办，再指定 --source、--collector 或 --todo');
    if (!Number.isInteger(input.leaseMinutes) || input.leaseMinutes < 1 || input.leaseMinutes > 1440 || typeof input.requestId !== 'string' || !input.requestId || input.requestId.length > 200) throw new TodoError('领取期限或请求标识无效');
    const requestKey = `claim:${input.requestId}`, hash = this.hash(input), previous = this.doc.requests[requestKey];
    if (previous) {
      if (previous.hash !== hash) throw new TodoError('同一领取请求的内容不一致', 409);
      const run = this.run(previous.id), todo = this.get(run.todoId!);
      if (!todo.claim || todo.claim.runId !== run.id || todo.claim.expiresAt <= Date.now()) throw new TodoError('原领取已结束或过期，请重新确认后发起新的领取', 409);
      return { todo, run };
    }
    return this.transaction(doc => {
      const now = Date.now();
      const todo = doc.todos.slice().reverse().find(todo => todo.status === 'open'
        && (!input.source || todo.source === input.source) && (!input.collectorId || todo.collectorId === input.collectorId) && (!input.todoId || todo.id === input.todoId)
        && canClaimTodo(todo, doc.runs, now));
      if (!todo) return { todo: null, run: null };
      if (todo.claim) { const expired = doc.runs.find(r => r.id === todo.claim!.runId); if (expired && !expired.result) { expired.status = 'failed'; expired.error = '领取已过期并被重新领取'; expired.updatedAt = now; } }
      const run: TodoRun = { id: randomUUID(), kind: 'execute', todoId: todo.id, collectorId: null, name: todo.title, config: input.config,
        createdAt: now, updatedAt: now, status: 'delivered', sessionId: input.sessionId, result: '', error: '',
        handoff: { todoIds: [todo.id], note: '', targetSessionId: input.sessionId, sessionName: input.sessionName } };
      todo.claim = { id: randomUUID(), sessionId: input.sessionId, sessionName: input.sessionName, claimedAt: now, expiresAt: now + input.leaseMinutes * 60_000, runId: run.id };
      todo.updatedAt = now; todo.revision++; doc.runs.push(run); doc.requests[requestKey] = { hash, id: run.id };
      return { todo, run };
    });
  }
  releaseClaim(id: string, revision: number, token?: string): TodoItem {
    return this.transaction(doc => {
      const todo = doc.todos.find(t => t.id === id); if (!todo) throw new TodoError('待办不存在', 404);
      this.check(revision, todo.revision);
      if (token && todo.claim?.id !== token) throw new TodoError('领取已变化，不能释放其他领取', 409);
      if (todo.claim) { const run = doc.runs.find(r => r.id === todo.claim!.runId); if (run && !run.result) { run.status = 'failed'; run.error = '领取已释放'; run.updatedAt = Date.now(); } }
      todo.claim = null; todo.revision++; todo.updatedAt = Date.now(); return todo;
    }, true);
  }
  renewClaim(id: string, token: string, minutes: number): TodoItem {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new TodoError('续期时间无效');
    return this.transaction(doc => {
      const todo = doc.todos.find(t => t.id === id); if (!todo) throw new TodoError('待办不存在', 404);
      if (!todo.claim || todo.claim.id !== token || todo.claim.expiresAt <= Date.now()) throw new TodoError('领取已过期或已变化，请重新领取', 409);
      todo.claim.expiresAt = Date.now() + minutes * 60_000; todo.revision++; todo.updatedAt = Date.now(); return todo;
    }, true);
  }
  bindCollectionSession(sessionId: string, runtimeIdentity: string): void {
    this.transaction(doc => { for (const run of doc.runs) if (run.kind === 'collect' && run.sessionId === sessionId && run.collectionSession?.owned !== false && !run.collectionSession?.recycledAt) {
      run.collectionSession = { ...collectionSessionPolicy(run.collectionSession), ...run.collectionSession, owned: true, runtimeIdentity };
    } }, true);
  }
  recycled(sessionId: string): void {
    this.transaction(doc => { for (const run of doc.runs) if (run.kind === 'collect' && run.sessionId === sessionId && run.collectionSession?.owned !== false) {
      run.collectionSession = { ...collectionSessionPolicy(run.collectionSession), owned: true, recycledAt: Date.now() };
      if (run.collection?.state === 'active') { run.collection.state = 'interrupted'; run.collection.revision++; run.status = 'failed'; run.error = '收集终端已回收，本轮结果待核对'; }
    } }, true);
  }
  report(id: string, status: 'complete' | 'blocked' | 'failed', content: string): TodoRun {
    if (!['complete', 'blocked', 'failed'].includes(status)) throw new TodoError('结果状态无效');
    const result = string(content, 40000); if (!result) throw new TodoError('请填写结果');
    return this.transaction(doc => { const run = doc.runs.find(r => r.id === id); if (!run) throw new TodoError('执行记录不存在', 404);
      if (run.result) { if (run.status !== status || run.result !== result) throw new TodoError('此轮已有结果，请发起新一轮执行', 409); return run; }
      if (run.collection) {
        if (!['active', 'interrupted'].includes(run.collection.state) || activeCollection(doc, run.collectorId!)?.id !== id) throw new TodoError('此轮已失效，不能提交结果', 409, run.collection.revision, 'COLLECTOR_RUN_FENCED');
        run.collection.state = status === 'complete' ? 'complete' : status === 'blocked' ? 'partial' : 'failed'; run.collection.revision++;
      }
      run.status = status; run.result = result; run.updatedAt = Date.now(); return run; }, true);
  }
  private hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
}
