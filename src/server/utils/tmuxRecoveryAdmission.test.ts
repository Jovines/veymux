import { expect, it } from 'vitest';
import { assessTmuxRecoveryLoad, configuredTmuxRecoveryLoadBudget } from './tmuxRecoveryAdmission.js';

it('reserves client capacity and pauses launches under CPU pressure', () => {
  const budget = { maxClients: 5, maxLoadPerCpu: 0.9 };
  expect(assessTmuxRecoveryLoad(2, budget, 0.5)).toEqual({ admitted: true });
  expect(assessTmuxRecoveryLoad(2, budget, 0.5, 3)).toEqual({ admitted: false, reason: 'TMUX_CLIENT_BUDGET_HIGH' });
  expect(assessTmuxRecoveryLoad(3, budget, 0.5)).toEqual({ admitted: false, reason: 'TMUX_CLIENT_BUDGET_HIGH' });
  expect(assessTmuxRecoveryLoad(0, budget, 0.9)).toEqual({ admitted: false, reason: 'CPU_LOAD_HIGH' });
});

it('validates recovery gate configuration', () => {
  expect(configuredTmuxRecoveryLoadBudget({})).toEqual({ maxClients: 96, maxLoadPerCpu: 0.9 });
  expect(configuredTmuxRecoveryLoadBudget({ VEYMUX_TMUX_RECOVERY_MAX_CLIENTS: '150', VEYMUX_TMUX_RECOVERY_MAX_LOAD_PER_CPU: '1.2' }))
    .toEqual({ maxClients: 150, maxLoadPerCpu: 1.2 });
  for (const value of ['0', '-1', 'NaN', '2.5']) expect(() => configuredTmuxRecoveryLoadBudget({ VEYMUX_TMUX_RECOVERY_MAX_CLIENTS: value })).toThrow();
});
