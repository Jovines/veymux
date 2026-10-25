import { expect, it } from 'vitest';
import { chatDelivery } from './chatDelivery';
import type { TransportDiagnostic } from '../agent/collaborationProtocol';

it('projects a failed input probe with owner-only resolution and keeps active probes quiet', () => {
  const failed: TransportDiagnostic = { relay_online: null, peer_reachable: true, next_retry_at: null, checked_at: 1, attempt_count: 1,
    write_stage: 'paste_attempted', last_error: 'TERMINAL_WRITE_FAILED: TERMINAL_INPUT_ECHO_UNCONFIRMED' };
  expect(chatDelivery('pending', failed, 'session', true)).toEqual({ state: 'outcome-unknown', inputCheckFailed: true, attemptCount: 1 });
  expect(chatDelivery('pending', failed, 'session', false)).toEqual({ state: 'outcome-unknown', inputCheckFailed: true });
  expect(chatDelivery('pending', { ...failed, write_stage: 'not_started', last_error: 'TERMINAL_WRITE_FAILED: TERMINAL_INPUT_UNAVAILABLE' }, 'session', true)).toEqual({ state: 'retrying', inputCheckFailed: true });
  expect(chatDelivery('pending', { ...failed, last_error: 'DELIVERY_IN_PROGRESS' }, 'session', true)).toBeUndefined();
});

const diagnostic: TransportDiagnostic = { relay_online: null, peer_reachable: false, attempt_count: 0,
  next_retry_at: 30000, last_error: 'TMUX_PANE_CHANGED', checked_at: 1, route_state: 'identity-mismatch',
  route_diagnostics: { expected: null, observed: [], truncated: false, recovery: 'confirmation-required', reason: 'NATIVE_IDENTITY_UNCONFIRMED', rebind_command: 'untrusted' } };

it('never recommends replaying an uncertain previous write', () => {
  expect(chatDelivery('pending', { ...diagnostic, route_diagnostics: { ...diagnostic.route_diagnostics!, reason: 'DELIVERY_OUTCOME_UNCONFIRMED' } }, 'original', true)).toEqual({ state: 'binding-required' });
  expect(chatDelivery('delivered', diagnostic, 'original', true)).toBeUndefined();
  expect(chatDelivery('pending', diagnostic, 'original;whoami', true)).toEqual({ state: 'binding-required' });
});

it('describes only observed transport failures and launch waits', () => {
  expect(chatDelivery('pending', null, 'original', true)).toBeUndefined();
  expect(chatDelivery('pending', { ...diagnostic, route_state: 'ready', last_error: 'DELIVERY_IN_PROGRESS' }, 'original', true)).toBeUndefined();
  expect(chatDelivery('pending', { ...diagnostic, route_state: 'offline', last_error: 'TMUX_SESSION_NOT_RUNNING' }, 'original', true)).toEqual({ state: 'retrying' });
  expect(chatDelivery('pending', { ...diagnostic, route_state: 'recovering', last_error: 'AGENT_LAUNCH_PENDING' }, 'original', true)).toEqual({ state: 'starting' });
  expect(chatDelivery('pending', { ...diagnostic, route_state: 'shell', last_error: 'SHELL_CONFIRMATION_REQUIRED: private details' }, 'original', false)).toEqual({ state: 'shell-confirmation-required' });
});
it('does not offer automatic retry or rebind for an uncertain previous paste', () => {
  expect(chatDelivery('pending', { ...diagnostic, attempt_count: 1, write_stage: 'paste_written', last_error: 'DELIVERY_OUTCOME_UNCONFIRMED' }, 'original', true)).toEqual({ state: 'outcome-unknown', attemptCount: 1 });
  expect(chatDelivery('pending', { ...diagnostic, attempt_count: 1, write_stage: 'not_started' }, 'original', true)).toMatchObject({ state: 'binding-required' });
  expect(chatDelivery('pending', { ...diagnostic, attempt_count: 1, write_stage: 'paste_written', last_error: 'TERMINAL_WRITE_FAILED: disconnected' }, 'original', true)).toEqual({ state: 'outcome-unknown', attemptCount: 1 });
});
it.each(['unknown', 'not_started', 'paste_attempted', 'paste_written', 'submit_attempted', 'submit_written'] as const)('does not call an active write interrupted (%s)', stage => {
  const active = { ...diagnostic, route_state: 'ready', attempt_count: 1, write_stage: stage, last_error: 'DELIVERY_IN_PROGRESS' };
  expect(chatDelivery('pending', active, 'original', true)).toBeUndefined();
  expect(chatDelivery('pending', active, 'original', false)).toBeUndefined();
});
