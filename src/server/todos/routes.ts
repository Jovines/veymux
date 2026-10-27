import { isTodoCategory } from './types.js';
import { Router, type Request, type Response } from 'express';
import { collectionSessionPolicy, processingPolicy, launchConfig, TodoError, TodoStore } from './store.js';
import { CollectionSessionLifecycle, type CollectionSessionRuntime } from './sessionLifecycle.js';
import type { TodoCallerContext, TodoHandoffInput, TodoItem, TodoLaunchConfig, TodoRun } from './types.js';

export interface TodoRuntime {
  callerSession?(context: TodoCallerContext): string | null;
  collectionSessions?: CollectionSessionRuntime;
  validate(config: TodoLaunchConfig, req?: Request): Promise<TodoLaunchConfig>;
  launch(run: TodoRun, prompt: string, onSession: (id: string) => void, req?: Request): Promise<void>;
  claimTarget?(input: { sessionId?: string; backendSessionId?: string }): Promise<{ sessionId: string; name: string; config: TodoLaunchConfig }>;
  target?(id: string, req?: Request): Promise<{ config: TodoLaunchConfig; name: string; mode?: 'shell' | 'tmux' }>;
  deliver?(run: TodoRun, prompt: string, req?: Request): Promise<void>;
}
export function handoffPrompt(store: TodoStore, run: TodoRun): string {
  return [run.handoff!.todoIds.length === 1 ? '请处理这条待办：' : '请一起处理这些待办：',
    ...run.handoff!.todoIds.map((id, index) => { const todo = store.get(id); return `${index + 1}. ${todo.title}\n${todo.description}\n来源：${todo.source}${todo.sourceUrl ? `\n参考来源：${todo.sourceUrl}` : ''}`; }),
    run.handoff!.note ? `我的补充要求：\n${run.handoff!.note}` : '',
  ].filter(Boolean).join('\n\n');
}
function shellQuote(value: string): string { return "'" + value.replace(/'/g, "'\"'\"'") + "'"; }
export function todoPrompt(store: TodoStore, run: TodoRun): string {
  const report = `完成或受阻时，请将结果写入一个 UTF-8 文件，并调用 td todo report ${run.id} --status complete --file <文件路径>；受阻时将 complete 换为 blocked，失败时换为 failed。报告只记录本次结果，由用户决定待办是否完成。`;
  if (run.kind === 'collect') return `${run.config.prompt}\n\n请将收集到的每条可执行待办通过本机 CLI 写入 Termdock，避免只输出列表。使用：\ntd todo add --title <标题> --description <描述> --source ${shellQuote(run.name)} --collector ${run.collectorId} --external-id <在此方向中稳定且唯一的标识>\n请附带必要上下文和可选的 --url https://... ，用 --category 分类，取值 short、long 或 delegated（短期、长期、我分配出去待跟进），无法确定时留为未分类。先用 td todo list --collector ${run.collectorId} 查看已有待办。相同 external-id 再次 add 只去重，不覆盖。已有事项有新进展时用 td todo update <todo-id> --collector ${run.collectorId} --revision <已读取的 revision> 更新描述或分类；冲突时重新读取并核对，勿盲目覆盖。只收集待办，本轮不执行这些待办。\n${report}`;
  const todo = store.get(run.todoId!);
  return `${run.config.prompt || '请处理下面这条待办，完成后说明结果和验证情况。'}\n\n待办：${todo.title}\n${todo.description}\n来源：${todo.source}\n${todo.sourceUrl ? `来源链接：${todo.sourceUrl}\n` : ''}\n待办 ID：${todo.id}\n执行记录 ID：${run.id}\n${report}`;
}
export class TodoRunner {
  private readonly sessions?: CollectionSessionLifecycle;
  constructor(readonly store: TodoStore, private readonly runtime: TodoRuntime) {
    if (runtime.collectionSessions) this.sessions = new CollectionSessionLifecycle(store, runtime.collectionSessions);
  }
  async start(kind: TodoRun['kind'], id: string, input: Partial<TodoLaunchConfig> | undefined, key: string, req?: Request): Promise<TodoRun> {
    // Read-only validation happens before reserving a run; launch is always recorded before any side effect.
    const base = kind === 'collect' ? this.store.collector(id).config : this.store.snapshot().defaults;
    const config = await this.runtime.validate(launchConfig(input ?? {}, base), req);
    const { run, fresh } = this.store.begin(kind, id, config, key);
    const created = (sessionId: string) => { this.store.mark(run.id, { sessionId }); };
    const prompt = fresh ? todoPrompt(this.store, run) : '';
    const launch = () => this.runtime.launch(run, prompt, created, req);
    if (fresh) void (kind === 'collect' && this.sessions ? this.sessions.collect(run, prompt, created, launch) : launch())
      .then(() => this.store.mark(run.id, { status: 'delivered' }))
      .catch(error => { this.store.mark(run.id, { status: 'failed', error: error instanceof Error ? error.message : String(error) }); });
    return run;
  }
  async handoff(body: TodoHandoffInput, req?: Request): Promise<TodoRun> {
    if (!body || !Array.isArray(body.todoIds) || !body.todoIds.length || body.todoIds.length > 50 || body.todoIds.some(id => typeof id !== 'string')
      || typeof body.note !== 'string' || body.note.length > 4000 || body.note.includes('\0') || typeof body.idempotencyKey !== 'string'
      || (body.sessionId !== undefined && (typeof body.sessionId !== 'string' || !body.sessionId || body.sessionId.length > 200))
      || (body.sessionId && body.config)) throw new TodoError('请选择待办和目标会话，补充要求最多 4000 字');
    const input: TodoHandoffInput = { todoIds: [...new Set(body.todoIds)], note: body.note.trim(), idempotencyKey: body.idempotencyKey,
      ...(body.sessionId ? { sessionId: body.sessionId } : { config: launchConfig(body.config ?? {}, this.store.snapshot().defaults) }) };
    const previous = this.store.previousHandoff(input); if (previous) return previous;
    if (input.todoIds.some(id => this.store.get(id).status !== 'open')) throw new TodoError('请先重新打开这条待办', 409);
    const target = input.sessionId ? await this.runtime.target?.(input.sessionId, req) : undefined;
    if (input.sessionId && (!target || !this.runtime.deliver)) throw new TodoError('目标会话不可用，请重新选择', 409);
    const config = target?.config ?? await this.runtime.validate(input.config!, req);
    // Target validation can await; recheck the durable request before reserving any side effect.
    const concurrent = this.store.previousHandoff(input); if (concurrent) return concurrent;
    const run = this.store.beginHandoff(input, config, target?.name ?? `待办 · ${this.store.get(input.todoIds[0]).title}`.slice(0, 120));
    const prompt = handoffPrompt(this.store, run);
    void (input.sessionId ? this.runtime.deliver!(run, prompt, req)
      : this.runtime.launch(run, prompt, sessionId => this.store.mark(run.id, { sessionId }), req))
      .then(() => this.store.mark(run.id, { status: 'delivered' }))
      .catch(error => this.store.mark(run.id, { status: 'failed', error: error instanceof Error ? error.message : String(error) }));
    return this.store.run(run.id);
  }
  async dispatchAutomatic(): Promise<void> {
    for (const todo of this.store.snapshot().todos) {
      const automatic = todo.autoProcessing;
      if (todo.status !== 'open' || automatic?.state !== 'pending') continue;
      if (todo.collectorId && !this.store.snapshot().collectors.some(c => c.id === todo.collectorId && c.enabled)) continue;
      const policy = automatic.policy;
      try {
        await this.handoff({ todoIds: [todo.id], note: policy.note, idempotencyKey: `automatic:${todo.id}`,
          ...(policy.mode === 'existing' ? { sessionId: policy.sessionId! } : { config: policy.config! }) });
      } catch (error) { this.store.automaticFailed(todo.id, error instanceof Error ? error.message : String(error)); }
    }
  }
  async tick(): Promise<void> {
    await this.sessions?.recycle();
    await this.dispatchAutomatic();
    for (const collector of this.store.due()) {
      try { await this.start('collect', collector.id, undefined, `schedule:${collector.id}:${collector.nextRunAt}`); }
      catch (error) {
        // Scheduled configuration failures also need a visible record and a new due time.
        try {
          const { run, fresh } = this.store.begin('collect', collector.id, collector.config, `schedule:${collector.id}:${collector.nextRunAt}`);
          if (fresh) this.store.mark(run.id, { status: 'failed', error: error instanceof Error ? error.message : String(error) });
        } catch (recordError) { console.warn('[todo-collector]', collector.name, recordError instanceof Error ? recordError.message : recordError); }
      }
    }
  }
}
export function todoRoutes(store: TodoStore, runner: TodoRunner, runtime: TodoRuntime): Router {
  const router = Router();
  const fail = (res: Response, error: unknown) => res.status(error instanceof TodoError ? error.status : 400).json({ error: error instanceof Error ? error.message : String(error),
    ...(error instanceof TodoError && error.currentRevision !== undefined ? { currentRevision: error.currentRevision } : {}),
    ...(error instanceof TodoError && error.code ? { code: error.code } : {}) });
  // The OS owner remains administrator. Collector CLIs carry execution-location
  // hints; scope comes from the server's durable run/session association, never
  // from a requested collector ID. Older CLIs cannot silently create unowned work.
  router.use((req, res, next) => {
    try {
      const raw = req.header('X-Termdock-Todo-Context');
      if (!raw && req.header('X-Termdock-Local-Token') && req.method === 'POST') throw new TodoError('请升级 CLI：待办写入需要运行会话上下文', 403, undefined, 'TODO_CALLER_CONTEXT_REQUIRED');
      if (raw) {
        if (raw.length > 4096) throw new TodoError('调用会话上下文无效');
        const context = JSON.parse(decodeURIComponent(raw));
        if (!context || typeof context !== 'object' || Array.isArray(context) || Object.keys(context).some(key => !['backendSessionId', 'tmuxSessionName'].includes(key))
          || Object.values(context).some(value => value !== null && (typeof value !== 'string' || !value || value.length > 200 || /[\r\n\0]/.test(value)))) throw new TodoError('调用会话上下文无效');
        if (context.backendSessionId || context.tmuxSessionName) {
          const id = runtime.callerSession?.(context);
          if (!id) throw new TodoError('无法确认调用会话', 403);
          res.locals.collectorId = store.collectorForSession(id);
        }
      }
      const owner = res.locals.collectorId as string | undefined;
      if (owner && req.method === 'POST') {
        if (/^\/runs\/[^/]+\/report\/?$/.test(req.path)) {
          const run = store.run(decodeURIComponent(req.path.split('/')[2]));
          if (run.kind !== 'collect' || run.collectorId !== owner) throw new TodoError('ownership mismatch: 收集记录不属于此 collector', 403, undefined, 'TODO_OWNERSHIP_MISMATCH');
        } else {
          if ((!['/', ''].includes(req.path) && !/^\/[^/]+\/?$/.test(req.path)) || ['claim', 'handoff', 'defaults', 'collectors'].includes(req.path.split('/')[1])) throw new TodoError('collector 仅能收集和维护自己的待办', 403);
          if (!req.body?.collectorId) throw new TodoError('collector 写入必须显式指定 --collector', 403, undefined, 'TODO_COLLECTOR_REQUIRED');
          if (req.body.collectorId !== owner) throw new TodoError('ownership mismatch: 不能操作其他 collector', 403, undefined, 'TODO_OWNERSHIP_MISMATCH');
        }
      }
      next();
    } catch (error) { fail(res, error); }
  });
  const scopedSnapshot = (req: Request, res: Response) => {
    const snapshot = store.snapshot(), requested = req.query.collectorId;
    if (requested !== undefined && (typeof requested !== 'string' || !requested || requested.length > 100)) throw new TodoError('collectorId 无效');
    const owner = res.locals.collectorId as string | undefined;
    if (owner && requested && requested !== owner) throw new TodoError('ownership mismatch: 不能查询其他 collector', 403, undefined, 'TODO_OWNERSHIP_MISMATCH');
    const collectorId = owner || requested;
    if (collectorId) {
      snapshot.todos = snapshot.todos.filter(todo => todo.collectorId === collectorId);
      snapshot.collectors = snapshot.collectors.filter(collector => collector.id === collectorId);
      const ids = new Set(snapshot.todos.map(todo => todo.id));
      snapshot.runs = snapshot.runs.filter(run => run.collectorId === collectorId || run.todoId && ids.has(run.todoId) && (!run.handoff || run.handoff.todoIds.every(id => ids.has(id))));
      snapshot.defaults = { agentSlug: '', command: '', cwd: '', prompt: '' };
    }
    return snapshot;
  };
  const mutation = (todo: TodoItem) => ({ todo, collectorId: todo.collectorId, todoId: todo.id, revision: todo.revision });
  const route = (fn: (req: Request, res: Response) => unknown | Promise<unknown>) => async (req: Request, res: Response) => {
    try { await fn(req, res); } catch (error) { fail(res, error); }
  };
  router.get('/summary', route((req, res) => res.json({ count: scopedSnapshot(req, res).todos.filter(todo => todo.status === 'open').length })));
  router.get('/', route((req, res) => {
    const snapshot = scopedSnapshot(req, res), category = req.query.category;
    if (category !== undefined) {
      if (!isTodoCategory(category)) throw new TodoError('分类须为 short、long、delegated 或 uncategorized');
      snapshot.todos = snapshot.todos.filter(todo => (todo.category ?? 'uncategorized') === category);
    }
    res.json(snapshot);
  }));
  router.post('/', route((req, res) => { const todo = store.create(req.body ?? {}); res.json(mutation(todo)); void runner.dispatchAutomatic(); }));
  router.post('/claim', route(async (req, res) => {
    const input = req.body ?? {};
    if (!['source', 'collectorId', 'todoId'].some(key => typeof input[key] === 'string' && input[key].trim())) throw new TodoError('请先向用户确认来源，再指定 --source、--collector 或 --todo');
    for (const key of ['source', 'collectorId', 'todoId', 'sessionId', 'backendSessionId']) if (input[key] !== undefined && (typeof input[key] !== 'string' || input[key].length > 500 || input[key].includes('\0'))) throw new TodoError('领取参数无效');
    const target = await runtime.claimTarget?.(input); if (!target) throw new TodoError('请在 Termdock Agent 中领取，或用 --session 指定会话', 409);
    res.json(store.claim({ source: input.source, collectorId: input.collectorId, todoId: input.todoId, sessionId: target.sessionId, sessionName: target.name, config: target.config, leaseMinutes: input.leaseMinutes ?? 30, requestId: input.requestId }));
  }));
  router.post('/:id/release', route((req, res) => res.json({ todo: store.releaseClaim(req.params.id, req.body?.revision, req.body?.claimId) })));
  router.post('/:id/renew', route((req, res) => res.json({ todo: store.renewClaim(req.params.id, req.body?.claimId, req.body?.minutes ?? 30) })));
  router.post('/defaults', route(async (req, res) => res.json({ defaults: store.defaults(await runtime.validate(launchConfig(req.body ?? {}), req)) })));
  router.post('/handoff', route(async (req, res) => res.json({ run: await runner.handoff(req.body, req) })));
  router.post('/collectors', route(async (req, res) => {
    const input = req.body ?? {};
    const session = collectionSessionPolicy(input.session);
    if (session.targetSessionId) {
      const target = await runtime.target?.(session.targetSessionId, req);
      if (!target || target.mode !== 'tmux') throw new TodoError('请选择可用的 tmux Agent 会话', 409);
      if (input.config?.agentSlug !== target.config.agentSlug) throw new TodoError('请选择与复用会话一致的 Agent', 409);
    }
    const config = await runtime.validate(launchConfig(input.config ?? {}), req);
    const processing = processingPolicy(input.processing, config);
    if (input.processing !== undefined && processing.mode === 'new') processing.config = await runtime.validate(processing.config!, req);
    if (input.processing !== undefined && processing.mode === 'existing' && !await runtime.target?.(processing.sessionId!, req)) throw new TodoError('自动处理会话不可用', 409);
    res.json({ collector: store.saveCollector({ ...input, config, ...(input.processing !== undefined ? { processing } : {}), ...(input.session !== undefined ? { session } : {}) }) });
  }));
  router.post('/collectors/:id/remove', route((req, res) => { store.removeCollector(req.params.id, req.body?.revision); res.json({ ok: true }); }));
  router.post('/collectors/:id/run', route(async (req, res) => res.json({ run: await runner.start('collect', req.params.id, undefined, req.body?.idempotencyKey, req) })));
  router.post('/runs/:id/report', route((req, res) => res.json({ run: store.report(req.params.id, req.body?.status, req.body?.content) })));
  router.post('/:id', route((req, res) => res.json(mutation(store.update(req.params.id, req.body ?? {})))));
  router.post('/:id/run', route(async (req, res) => res.json({ run: await runner.start('execute', req.params.id, req.body?.config, req.body?.idempotencyKey, req) })));
  return router;
}
