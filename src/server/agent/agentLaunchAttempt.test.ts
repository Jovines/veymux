import { expect, it } from 'vitest';
import { normalizeAgentLaunchAttempt, replayAgentLaunchAttempt } from './agentLaunchAttempt';
import { mergeSessionLaunchState, type SessionLaunchState } from './sessionLaunchState';
const attempt = { id: 'launch-1', commandHash: 'a'.repeat(64), state: 'submitted' as const, updatedAt: 1 };
it('replays a submitted intent without authorizing a second terminal write', () => {
  expect(replayAgentLaunchAttempt(attempt, 'launch-1', attempt.commandHash)).toBe('submitted');
  expect(replayAgentLaunchAttempt(attempt, 'new-launch', attempt.commandHash)).toBeNull();
  expect(() => replayAgentLaunchAttempt(attempt, 'launch-1', 'b'.repeat(64))).toThrow('changed');
  for (const state of ['preparing', 'prepared', 'unconfirmed', 'failed'] as const) {
    expect(() => replayAgentLaunchAttempt({ ...attempt, state }, attempt.id, attempt.commandHash)).toThrow('needs confirmation');
  }
});
it('retains launch intent when stale presentation metadata arrives', () => {
  const current: SessionLaunchState = { backendSessionId: 'backend', agentLaunchGeneration: 'generation', agentLaunchCheck: null, agentLaunchAttempt: attempt };
  expect(mergeSessionLaunchState({ ...current, agentLaunchAttempt: null }, current).agentLaunchAttempt).toEqual(attempt);
  expect(mergeSessionLaunchState(current, current, { expectedGeneration: 'generation', expectedCheckId: null,
    generation: 'generation', check: null, attempt: { ...attempt, state: 'unconfirmed' } }).agentLaunchAttempt?.state).toBe('unconfirmed');
});
it('rejects malformed persisted intents', () => {
  expect(normalizeAgentLaunchAttempt(attempt)).toEqual(attempt);
  expect(normalizeAgentLaunchAttempt({ ...attempt, commandHash: 'unsafe' })).toBeNull();
  expect(normalizeAgentLaunchAttempt({ ...attempt, state: 'ready' })).toBeNull();
});


it('keeps a prepared conversation ID when earlier shell metadata races its durable save', () => {
  const current: SessionLaunchState = { backendSessionId: 'backend', agentLaunchGeneration: 'generation', agentLaunchCheck: { id: 'generation', agentSlug: 'codex', nativeSessionId: 'native', deadline: 100 },
    agentResume: { slug: 'codex', sessionId: 'native', launchArgv: ['codex'], updatedAt: 1 } };
  expect(mergeSessionLaunchState({ ...current, agentResume: null }, current).agentResume).toEqual(current.agentResume);
  expect(mergeSessionLaunchState({ ...current, agentLaunchGeneration: 'older', agentResume: null }, { ...current, agentLaunchCheck: null }).agentResume).toEqual(current.agentResume);
});
