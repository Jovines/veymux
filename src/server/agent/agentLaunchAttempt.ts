export interface AgentLaunchAttempt {
  id: string;
  commandHash: string;
  state: 'preparing' | 'prepared' | 'unconfirmed' | 'submitted' | 'failed';
  updatedAt: number;
}
export function normalizeAgentLaunchAttempt(value: unknown): AgentLaunchAttempt | null {
  if (!value || typeof value !== 'object') return null;
  const attempt = value as AgentLaunchAttempt;
  if (typeof attempt.id !== 'string' || !/^[A-Za-z0-9:._-]{1,200}$/.test(attempt.id)
    || typeof attempt.commandHash !== 'string' || !/^[a-f0-9]{64}$/.test(attempt.commandHash)
    || !['preparing', 'prepared', 'unconfirmed', 'submitted', 'failed'].includes(attempt.state)
    || !Number.isFinite(attempt.updatedAt)) return null;
  return { id: attempt.id, commandHash: attempt.commandHash, state: attempt.state, updatedAt: attempt.updatedAt };
}

export function replayAgentLaunchAttempt(attempt: AgentLaunchAttempt | null | undefined, id: string, commandHash: string): 'submitted' | null {
  if (!attempt || attempt.id !== id) return null;
  if (attempt.commandHash !== commandHash) throw Object.assign(new Error('Launch request changed; refresh the session'), { code: 'AGENT_LAUNCH_REQUEST_CHANGED' });
  if (attempt.state === 'submitted') return 'submitted';
  throw Object.assign(new Error('Previous launch needs confirmation; inspect the original terminal before retrying'), { code: 'AGENT_LAUNCH_OUTCOME_UNCONFIRMED' });
}
