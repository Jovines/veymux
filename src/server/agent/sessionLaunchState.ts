import { isDeepStrictEqual } from 'node:util';
import type { PersistedAgentResumeInfo } from './resumePersistence.js';
import type { AgentLaunchAttempt } from './agentLaunchAttempt.js';
import type { AgentLaunchCheck } from './agentLaunchCheck.js';
import { TerminalInputTargetChangedError } from './terminalInput.js';
import type { NativeProcessIdentityConfig } from './nativeProcessIdentity.js';

export interface SessionLaunchState {
  backendSessionId: string | null;
  agentLaunchGeneration?: string | null;
  agentLaunchCheck?: AgentLaunchCheck | null;
  agentLaunchAttempt?: AgentLaunchAttempt | null;
  agentResume?: PersistedAgentResumeInfo | null;
  agentNativeIdentity?: NativeProcessIdentityConfig | null;
}

export interface LaunchStateChange {
  expectedGeneration: string | null;
  expectedCheckId: string | null;
  generation: string | null;
  check: AgentLaunchCheck | null;
  attempt?: AgentLaunchAttempt | null;
  nativeIdentity?: NativeProcessIdentityConfig | null;
}

/** Display/identity metadata may have crossed an await with an old snapshot.
 * Only the launch lifecycle can change these server-owned control fields. */
export function mergeSessionLaunchState<T extends SessionLaunchState>(
  candidate: T, current: T | undefined, change?: LaunchStateChange,
): T {
  if (!change) return current ? { ...candidate,
    agentResume: current.agentResume && ((candidate.agentLaunchGeneration ?? null) !== (current.agentLaunchGeneration ?? null)
      || current.agentLaunchCheck?.nativeSessionId === current.agentResume.sessionId && candidate.agentResume?.sessionId !== current.agentResume.sessionId)
      ? current.agentResume : candidate.agentResume,
    agentLaunchGeneration: current.agentLaunchGeneration ?? null,
    agentLaunchCheck: current.agentLaunchCheck ?? null,
    agentLaunchAttempt: current.agentLaunchAttempt ?? null,
    agentNativeIdentity: current.agentNativeIdentity ?? null,
  } : candidate;
  if (!current || (current.agentLaunchGeneration ?? null) !== change.expectedGeneration
    || (current.agentLaunchCheck?.id ?? null) !== change.expectedCheckId) {
    throw new TerminalInputTargetChangedError({
      expected_backend_session_id: candidate.backendSessionId, current_backend_session_id: current?.backendSessionId ?? null,
      expected_launch_id: change.expectedGeneration, current_launch_id: current?.agentLaunchGeneration ?? null,
      backend_instance_matches: !!current && candidate.backendSessionId === current.backendSessionId,
      check_phase: 'launch_state_commit', checked_at: Date.now(),
    });
  }
  return { ...candidate, agentLaunchGeneration: change.generation, agentLaunchCheck: change.check,
    agentLaunchAttempt: change.attempt === undefined ? current.agentLaunchAttempt ?? null : change.attempt,
    agentNativeIdentity: change.nativeIdentity === undefined ? current.agentNativeIdentity ?? null : change.nativeIdentity };
}

/** Merge disk against the last synchronized baseline, preserving pending local
 * changes even when they predate the watcher read. Never revert server-owned
 * launch fields or resurrect a locally deleted ID. */
export function mergeReloadedSessionState<T extends SessionLaunchState & { sessionId: string }>(
  disk: T[], baseline: T[], current: T[],
): T[] {
  const before = new Map(baseline.map(record => [record.sessionId, record]));
  const live = new Map(current.map(record => [record.sessionId, record]));
  const unchanged = (record: T, previous: T | undefined) => !!previous && isDeepStrictEqual(
    mergeSessionLaunchState(record, record), mergeSessionLaunchState(previous, previous));
  const result: T[] = [];
  const seen = new Set<string>();
  for (const candidate of disk) {
    const id = candidate.sessionId, now = live.get(id), old = before.get(id);
    if (seen.has(id) || old && !now) continue;
    seen.add(id);
    result.push(now ? !unchanged(now, old) ? now
      : mergeSessionLaunchState(candidate, now) : candidate);
  }
  for (const record of current) {
    if (!seen.has(record.sessionId) && (!unchanged(record, before.get(record.sessionId))
      || record.agentLaunchGeneration || record.agentNativeIdentity)) result.push(record);
  }
  return result;
}

/** Serialize durable global snapshots, taking a fresh value when each write
 * acquires the queue. A delayed old rename must not overwrite a later launch. */
export function createSessionStateWriter<T>(current: () => T, write: (snapshot: T) => Promise<void>): () => Promise<void> {
  let pending: Promise<void> = Promise.resolve();
  return () => {
    const next = pending.catch(() => undefined).then(() => write(structuredClone(current())));
    pending = next;
    return next;
  };
}

/** Watcher reads and writes share one queue and a durable merge baseline.
 * Comparing only with memory at read start loses mutations made before that
 * read but still waiting for the debounced write. Failed I/O never advances
 * the baseline; memory changes made during I/O remain pending as well. */
export function createSessionStatePersistence<S extends { sessions: Array<SessionLaunchState & { sessionId: string }> }>(
  current: () => S,
  read: () => Promise<S | null>,
  write: (snapshot: S) => Promise<void>,
  apply: (state: S) => void,
) {
  let baseline: S['sessions'] = [];
  let pending: Promise<unknown> = Promise.resolve();
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = pending.catch(() => undefined).then(operation);
    pending = next;
    return next;
  }
  return {
    load: (reload = true) => enqueue(async () => {
      const disk = await read();
      if (!disk) return false;
      const sessions = reload ? mergeReloadedSessionState(disk.sessions, baseline, current().sessions) : disk.sessions;
      apply({ ...disk, sessions });
      baseline = structuredClone(disk.sessions);
      return true;
    }),
    write: () => enqueue(async () => {
      const snapshot = structuredClone(current());
      await write(snapshot);
      baseline = snapshot.sessions;
    }),
  };
}
