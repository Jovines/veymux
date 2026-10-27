import os from 'node:os';

export function configuredTmuxRecoveryLoadBudget(env: NodeJS.ProcessEnv = process.env) {
  const maxClients = Number(env.TD_TMUX_RECOVERY_MAX_CLIENTS?.trim() || 96);
  if (!Number.isSafeInteger(maxClients) || maxClients < 3) throw new Error('TD_TMUX_RECOVERY_MAX_CLIENTS must be an integer of at least 3');
  const maxLoadPerCpu = Number(env.TD_TMUX_RECOVERY_MAX_LOAD_PER_CPU?.trim() || 0.9);
  if (!Number.isFinite(maxLoadPerCpu) || maxLoadPerCpu <= 0) throw new Error('TD_TMUX_RECOVERY_MAX_LOAD_PER_CPU must be positive');
  return { maxClients, maxLoadPerCpu };
}

/** Reserve two observation clients and one display client for the next launch.
 * This gate complements the existing memory/Agent budget and queue limit. */
export function assessTmuxRecoveryLoad(clientCount: number, budget: ReturnType<typeof configuredTmuxRecoveryLoadBudget>,
  loadPerCpu = os.loadavg()[0] / os.availableParallelism(), reservedClients = 0) {
  if (clientCount + reservedClients + 3 > budget.maxClients) return { admitted: false, reason: 'TMUX_CLIENT_BUDGET_HIGH' };
  if (loadPerCpu >= budget.maxLoadPerCpu) return { admitted: false, reason: 'CPU_LOAD_HIGH' };
  return { admitted: true };
}
