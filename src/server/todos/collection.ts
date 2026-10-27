import { createHash, randomUUID } from 'node:crypto';
import { nextAutomationRunAt } from '../agent/automationStore.js';
import { TodoError } from './errors.js';
import { isOpenCollection, type CollectorCheckpoint, type CollectorFinishInput, type CollectorOutcome, type CollectorTriggerInput, type TodoLaunchConfig, type TodoRun, type TodoSnapshot } from './types.js';

export interface CollectionDocument extends TodoSnapshot { requests: Record<string, { hash: string; id: string }> }
export const COLLECTION_LIMITS = { payloadBytes: 16000, cursorBytes: 16000, outcomeBytes: 40000, sources: 128, runsPerCollector: 10000 };
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) throw new TodoError('收集字段格式或长度无效');
  return value.trim();
}
export const collectionKey = (value: unknown) => text(value, 200);
export const sourceKey = (value: unknown) => text(value, 120);
function boundedJSON(value: unknown, max: number): unknown {
  let raw: string | undefined;
  try { raw = JSON.stringify(value); } catch { throw new TodoError('收集数据须为 JSON'); }
  if (raw === undefined || Buffer.byteLength(raw) > max) throw new TodoError('收集数据超出大小上限', 413);
  return JSON.parse(raw);
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => [key, canonical(value)]));
  return value;
}
export const collectionHash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function safePayload(value: unknown): unknown {
  const json = boundedJSON(value, COLLECTION_LIMITS.payloadBytes);
  const walk = (value: unknown, depth: number) => {
    if (depth > 20) throw new TodoError('通知数据嵌套过深');
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      if (/^(authorization|proxyauthorization|cookie|setcookie|password|secret|clientsecret|accesstoken|refreshtoken|token|apikey|xapikey|credentials|headers)$/i.test(key.replace(/[_-]/g, ''))) throw new TodoError('通知不能包含认证或凭据字段');
      walk(child, depth + 1);
    }
  };
  walk(json, 0); return json;
}
export function normalizeTrigger(input: CollectorTriggerInput = { triggerType: 'manual' }): CollectorTriggerInput {
  if (!input || !['manual', 'schedule', 'webhook'].includes(input.triggerType)) throw new TodoError('收集触发类型无效');
  if (input.triggerType === 'schedule' && (!Number.isSafeInteger(input.scheduledAt) || input.scheduledAt! < 0)) throw new TodoError('定时触发缺少 scheduledAt');
  return { triggerType: input.triggerType, ...(input.triggerType === 'schedule' ? { scheduledAt: input.scheduledAt } : {}), ...(input.payload === undefined ? {} : { payload: safePayload(input.payload) }) };
}
export function activeCollection(doc: Pick<TodoSnapshot, 'runs'>, collectorId: string): TodoRun | undefined {
  return doc.runs.find(run => run.collectorId === collectorId && isOpenCollection(run));
}
export function assertCollectionWrite(doc: Pick<TodoSnapshot, 'runs'>, collectorId: unknown, runId: unknown): TodoRun {
  const run = typeof runId === 'string' ? doc.runs.find(run => run.id === runId) : undefined;
  if (run && run.collectorId !== collectorId) throw new TodoError('ownership mismatch: 收集轮次不属于此 collector', 403, undefined, 'TODO_OWNERSHIP_MISMATCH');
  if (!run || run.kind !== 'collect' || run.collectorId !== collectorId || run.collection?.state !== 'active' || activeCollection(doc, run.collectorId!)?.id !== run.id) {
    throw new TodoError('本轮已结束或需要核对，不能继续写入；请读取当前收集记录', 409, run?.collection?.revision, 'COLLECTOR_RUN_FENCED', typeof collectorId === 'string' ? activeCollection(doc, collectorId)?.id : undefined);
  }
  return run;
}
function requestIdentity(collectorId: string, key: string, trigger: CollectorTriggerInput, overrides?: Partial<TodoLaunchConfig>) {
  return { key: `collect:${collectorId}:${collectionKey(key)}`, hash: collectionHash({ trigger: normalizeTrigger(trigger), overrides: overrides ?? null }) };
}
export function previousCollection(doc: CollectionDocument, collectorId: string, key: string, trigger: CollectorTriggerInput, overrides?: Partial<TodoLaunchConfig>): TodoRun | undefined {
  const identity = requestIdentity(collectorId, collectionKey(key), trigger, overrides), old = doc.requests[identity.key];
  if (!old) return;
  if (old.hash !== identity.hash) throw new TodoError('同一收集请求标识的业务内容不一致', 409, undefined, 'COLLECTOR_TRIGGER_CONFLICT');
  const run = doc.runs.find(run => run.id === old.id); if (!run) throw new TodoError('原收集记录已不可用', 409);
  return run;
}
export function beginCollection(doc: CollectionDocument, collectorId: string, config: TodoLaunchConfig, key: string, input: CollectorTriggerInput,
  overrides?: Partial<TodoLaunchConfig>, previousRunId?: string): { run: TodoRun; fresh: boolean } {
  key = collectionKey(key);
  const trigger = normalizeTrigger(input), old = previousCollection(doc, collectorId, key, trigger, overrides);
  if (old) return { run: old, fresh: false };
  const collector = doc.collectors.find(c => c.id === collectorId); if (!collector) throw new TodoError('收集方向不存在', 404);
  const busy = activeCollection(doc, collectorId);
  if (busy) throw new TodoError('本轮尚未结束，请等待结果或核对原终端后重试', 409, busy.collection?.revision, 'COLLECTOR_BUSY', busy.id);
  if (doc.runs.filter(run => run.collectorId === collectorId).length >= COLLECTION_LIMITS.runsPerCollector) throw new TodoError('收集记录已达上限，请先导出并清理记录', 409, undefined, 'COLLECTOR_LEDGER_FULL');
  const now = Date.now(), id = randomUUID();
  const run: TodoRun = { id, kind: 'collect', todoId: null, collectorId, name: collector.name, config: structuredClone(config), createdAt: now, updatedAt: now,
    status: 'launching', sessionId: null, result: '', error: '',
    trigger: { ...trigger, collectorId, runId: id, receivedAt: now, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', idempotencyKey: key },
    collection: { revision: 1, state: 'active', ...(previousRunId ? { previousRunId } : {}) } };
  doc.runs.push(run); doc.requests[requestIdentity(collectorId, key, trigger, overrides).key] = { id, hash: requestIdentity(collectorId, key, trigger, overrides).hash };
  if (trigger.triggerType === 'schedule') collector.nextRunAt = collector.schedule && collector.enabled ? nextAutomationRunAt(collector.schedule, Math.max(now, trigger.scheduledAt!) + 1, collector.createdAt) : null;
  collector.updatedAt = now; collector.revision++;
  return { run, fresh: true };
}
export function normalizeOutcome(input: CollectorOutcome): CollectorOutcome {
  boundedJSON(input, COLLECTION_LIMITS.outcomeBytes);
  if (!input || !['success', 'partial', 'failed'].includes(input.status) || !Array.isArray(input.coverage) || input.coverage.length > COLLECTION_LIMITS.sources) throw new TodoError('请声明本轮结果和来源覆盖范围');
  const coverage = input.coverage.map(item => {
    if (!item || !['success', 'partial', 'failed'].includes(item.status)) throw new TodoError('来源覆盖状态无效');
    return { sourceKey: sourceKey(item.sourceKey), status: item.status, ...(item.note === undefined ? {} : { note: text(item.note, 2000) }) };
  });
  if (new Set(coverage.map(item => item.sourceKey)).size !== coverage.length) throw new TodoError('来源覆盖不能重复');
  if (input.status === 'success' && (!coverage.length || coverage.some(item => item.status !== 'success'))) throw new TodoError('成功提交须明确所有声明来源均成功');
  if (input.checkpoints !== undefined && !Array.isArray(input.checkpoints)) throw new TodoError('checkpoint 格式无效');
  const checkpoints = (input.checkpoints ?? []).map(item => {
    if (!item || !Number.isSafeInteger(item.expectedRevision) || item.expectedRevision < 0) throw new TodoError('checkpoint 须提供有效 expectedRevision');
    const key = sourceKey(item.sourceKey);
    if (input.status !== 'success' || !coverage.some(source => source.sourceKey === key && source.status === 'success')) throw new TodoError('只有显式成功且声明覆盖的来源才能推进 checkpoint');
    return { sourceKey: key, expectedRevision: item.expectedRevision, cursor: boundedJSON(item.cursor, COLLECTION_LIMITS.cursorBytes) };
  });
  if (new Set(checkpoints.map(item => item.sourceKey)).size !== checkpoints.length || checkpoints.length > COLLECTION_LIMITS.sources) throw new TodoError('checkpoint 重复或过多');
  return { status: input.status, summary: text(input.summary, 10000), coverage, checkpoints };
}
export function finishCollection(doc: CollectionDocument, id: string, input: CollectorFinishInput): TodoRun {
  const key = collectionKey(input.idempotencyKey), outcome = normalizeOutcome(input), hash = collectionHash(outcome);
  const run = doc.runs.find(run => run.id === id); if (!run || run.kind !== 'collect' || !run.collection) throw new TodoError('收集记录不存在', 404);
  if (run.collection.commit?.key === key) {
    if (run.collection.commit.hash !== hash) throw new TodoError('同一提交标识的结果不一致', 409);
    return run;
  }
  assertCollectionWrite(doc, run.collectorId, id);
  if (input.revision !== run.collection.revision) throw new TodoError('收集记录已更新', 409, run.collection.revision);
  const collector = doc.collectors.find(c => c.id === run.collectorId); if (!collector) throw new TodoError('收集方向已删除，不能推进 checkpoint', 409);
  const points: CollectorCheckpoint[] = structuredClone(collector.checkpoints ?? []), now = Date.now();
  for (const point of outcome.checkpoints ?? []) {
    const old = points.find(item => item.sourceKey === point.sourceKey), current = old?.revision ?? 0;
    if (point.expectedRevision !== current) throw new TodoError(`checkpoint ${point.sourceKey} 已更新`, 409, current, 'CHECKPOINT_CONFLICT');
    const next = { sourceKey: point.sourceKey, cursor: point.cursor, revision: current + 1, lastSuccessfulAt: now, lastSuccessfulRunId: id };
    if (old) Object.assign(old, next); else points.push(next);
  }
  if (points.length > COLLECTION_LIMITS.sources) throw new TodoError('checkpoint 来源数量已达上限', 409);
  if (outcome.checkpoints?.length) { collector.checkpoints = points; collector.updatedAt = now; collector.revision++; }
  run.collection = { ...run.collection, state: outcome.status === 'success' ? 'complete' : outcome.status, revision: run.collection.revision + 1, outcome, commit: { key, hash } };
  run.status = outcome.status === 'success' ? 'complete' : outcome.status === 'partial' ? 'blocked' : 'failed';
  run.result = outcome.summary; run.updatedAt = now; return run;
}
