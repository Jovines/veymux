import type { AutomationSchedule } from '../agent/automationStore.js';

export const TODO_CATEGORIES = ['short', 'long', 'delegated', 'uncategorized'] as const;
export type TodoCategory = typeof TODO_CATEGORIES[number];
export function isTodoCategory(value: unknown): value is TodoCategory { return TODO_CATEGORIES.some(category => category === value); }

export interface TodoLaunchConfig { agentSlug: string; command: string; cwd: string; prompt: string }
export interface TodoSessionPolicy { mode: 'new' | 'reuse'; targetSessionId: string | null; beforePrompt: string; idleMinutes: number }
export interface TodoProcessing { mode: 'manual' | 'new' | 'existing'; sessionId: string | null; config: TodoLaunchConfig | null; note: string }
export interface TodoClaim { id: string; sessionId: string; sessionName: string; claimedAt: number; expiresAt: number; runId: string }
export interface CollectorTriggerInput { triggerType: 'manual' | 'schedule' | 'webhook'; scheduledAt?: number; payload?: unknown }
export interface CollectorTrigger extends CollectorTriggerInput { collectorId: string; runId: string; receivedAt: number; timezone: string; idempotencyKey: string }
export interface CollectorCheckpoint { sourceKey: string; revision: number; cursor: unknown; lastSuccessfulAt: number; lastSuccessfulRunId: string }
export interface CollectorOutcome {
  status: 'success' | 'partial' | 'failed'; summary: string;
  coverage: Array<{ sourceKey: string; status: 'success' | 'partial' | 'failed'; note?: string }>;
  checkpoints?: Array<{ sourceKey: string; expectedRevision: number; cursor: unknown }>;
}
export interface CollectorFinishInput extends CollectorOutcome { revision: number; idempotencyKey: string }
export interface CollectorRunState {
  revision: number; state: 'active' | 'interrupted' | 'complete' | 'partial' | 'failed' | 'cancelled';
  previousRunId?: string; retryRunId?: string; outcome?: CollectorOutcome;
  commit?: { key: string; hash: string };
}
export interface TodoRun {
  id: string; kind: 'execute' | 'collect'; todoId: string | null; collectorId: string | null;
  name: string; config: TodoLaunchConfig; createdAt: number; updatedAt: number;
  status: 'launching' | 'delivered' | 'complete' | 'blocked' | 'failed';
  sessionId: string | null; result: string; error: string;
  trigger?: CollectorTrigger;
  collection?: CollectorRunState;
  collectionSession?: TodoSessionPolicy & { owned: boolean; runtimeIdentity?: string; recycledAt?: number };
  handoff?: { todoIds: string[]; note: string; targetSessionId: string | null; sessionName: string };
}
export interface TodoHandoffInput { todoIds: string[]; sessionId?: string; config?: TodoLaunchConfig; note: string; idempotencyKey: string }
export interface TodoItem {
  id: string; title: string; description: string; source: string; sourceUrl: string;
  category?: TodoCategory;
  claim?: TodoClaim | null;
  autoProcessing?: { policy: TodoProcessing; state: 'pending' | 'dispatched' | 'failed'; runId: string | null; error: string };
  externalId: string; collectorId: string | null; status: 'open' | 'completed' | 'ignored';
  createdAt: number; updatedAt: number; revision: number;
}
export interface TodoCollector {
  id: string; name: string; enabled: boolean; config: TodoLaunchConfig;
  processing?: TodoProcessing;
  webhook?: { enabled: boolean; secret: string };
  session?: TodoSessionPolicy;
  checkpoints?: CollectorCheckpoint[];
  schedule: AutomationSchedule | null; nextRunAt: number | null; createdAt: number; updatedAt: number; revision: number;
}
export interface TodoSnapshot { todos: TodoItem[]; collectors: TodoCollector[]; runs: TodoRun[]; defaults: TodoLaunchConfig }
export interface TodoCreateInput { title: string; description?: string; category?: TodoCategory; source?: string; sourceUrl?: string; externalId?: string; collectorId?: string; runId?: string; idempotencyKey?: string }
export interface TodoUpdateInput { revision: number; collectorId?: string; runId?: string; title?: string; description?: string; category?: TodoCategory; sourceUrl?: string; externalId?: string; status?: TodoItem['status'] }
export interface TodoCallerContext { backendSessionId?: string | null; tmuxSessionName?: string | null }
export function isOpenCollection(run: TodoRun): boolean {
  return run.kind === 'collect' && (run.collection ? ['active', 'interrupted'].includes(run.collection.state) : ['launching', 'delivered'].includes(run.status) && !run.result);
}
