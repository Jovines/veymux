import { hasUnconfirmedTerminalWrite, type TransportDiagnostic } from '../agent/collaborationProtocol.js';

/** Transport facts only; never an Agent's queue, activity or read state. */
export interface ChatDelivery {
  state: 'binding-required' | 'retrying' | 'starting' | 'shell-confirmation-required' | 'outcome-unknown';
  inputCheckFailed?: boolean;
  canReconnect?: boolean;
  attemptCount?: number;
  canRetry?: boolean;
  /** Owner-only recovery for an earlier message blocking this recipient. */
  blockedBy?: { messageId: string; attemptCount: number };
}

export function chatDelivery(status: string, diagnostic: TransportDiagnostic | null, sessionId: string, fullService: boolean,
  blocker?: { messageId: string; diagnostic: TransportDiagnostic | null }): ChatDelivery | undefined {
  let own = messageChatDelivery(status, diagnostic, sessionId, fullService);
  if (status === 'pending' && blocker?.diagnostic?.last_error && blocker.diagnostic.last_error !== 'DELIVERY_IN_PROGRESS'
    && hasUnconfirmedTerminalWrite(blocker.diagnostic)) {
    const inputCheckFailed = blocker.diagnostic.write_stage === 'probe_attempted'
      || /TERMINAL_INPUT_ECHO_UNCONFIRMED|TERMINAL_INPUT_UNAVAILABLE/.test(blocker.diagnostic.last_error);
    return { ...own ?? { state: 'retrying' }, ...(inputCheckFailed ? { inputCheckFailed: true } : {}),
      ...(fullService ? { blockedBy: { messageId: blocker.messageId, attemptCount: blocker.diagnostic.attempt_count } } : {}) };
  }
  if (own?.state === 'retrying' && fullService && diagnostic && !hasUnconfirmedTerminalWrite(diagnostic)) {
    own = { ...own, canRetry: true, attemptCount: diagnostic.attempt_count };
  }
  return own;
}

function messageChatDelivery(status: string, diagnostic: TransportDiagnostic | null, sessionId: string, fullService: boolean): ChatDelivery | undefined {
  if (status !== 'pending' || !diagnostic?.last_error) return;
  // Intermediate paste/submit stages belong to a live attempt. Only a
  // failed attempt or restart reconciliation can make its outcome uncertain.
  if (diagnostic.last_error === 'DELIVERY_IN_PROGRESS') return;
  if (/TERMINAL_INPUT_ECHO_UNCONFIRMED|TERMINAL_INPUT_UNAVAILABLE/.test(diagnostic.last_error)) {
    // Cached clients still understand these existing states and recovery
    // actions; newer clients add the specific check/cleanup guidance.
    return hasUnconfirmedTerminalWrite(diagnostic)
      ? { state: 'outcome-unknown', inputCheckFailed: true, ...(fullService ? { attemptCount: diagnostic.attempt_count } : {}) }
      : { state: 'retrying', inputCheckFailed: true, ...(fullService && diagnostic.attempt_count > 0 ? { attemptCount: diagnostic.attempt_count } : {}) };
  }
  if (hasUnconfirmedTerminalWrite(diagnostic)) return { state: 'outcome-unknown', ...(fullService ? { attemptCount: diagnostic.attempt_count } : {}) };
  if (diagnostic.route_state === 'identity-mismatch') {
    // An unknown write outcome cannot be fixed by reconnecting and replaying.
    const canRebind = diagnostic.route_diagnostics?.recovery === 'confirmation-required'
      && diagnostic.route_diagnostics.reason !== 'DELIVERY_OUTCOME_UNCONFIRMED'
      && /^[a-zA-Z0-9-]+$/.test(sessionId);
    return { state: 'binding-required', ...(fullService && canRebind ? { canReconnect: true } : {}) };
  }
  if (diagnostic.last_error.startsWith('SHELL_CONFIRMATION_REQUIRED')) return { state: 'shell-confirmation-required' };
  if (/AGENT_LAUNCH_|SESSION_STARTUP_/.test(diagnostic.last_error)) return { state: 'starting' };
  if (diagnostic.last_error !== 'DELIVERY_IN_PROGRESS') return { state: 'retrying' };
}
