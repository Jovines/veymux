import { useEffect, useRef, useState } from 'react';
import { useTerminalStore } from '../../stores/useTerminalStore';
import { currentSecureClient } from '../../federation/browserIntegration';

/** Check a foreground idle entry or a working -> idle edge; never poll input. */
export function useChatTerminalInputCheck(sessionId: string, phase: string | null, enabled: boolean, active = enabled) {
  const previous = useRef<{ sessionId: string; phase: string | null; active: boolean; backendSessionId: string | null | undefined }>();
  const pendingEntry = useRef<string>();
  const backendSessionId = useTerminalStore(state => state.sessions.get(sessionId)?.terminalSessionId);
  const request = useRef<AbortController>();
  const [unconfirmed, setUnconfirmed] = useState(false);
  useEffect(() => {
    const prior = previous.current;
    const entering = active && (!prior?.active || prior.sessionId !== sessionId);
    if (entering) pendingEntry.current = crypto.randomUUID();
    if (!active || phase !== null) pendingEntry.current = undefined;
    previous.current = { sessionId, phase, active, backendSessionId };
    request.current?.abort(); request.current = undefined;
    if (phase || !active || entering) setUnconfirmed(false);
    const stopped = prior?.sessionId === sessionId && prior.active && prior.phase === 'output' && prior.backendSessionId === backendSessionId;
    const ownTerminalOpen = Array.from(document.querySelectorAll('[data-terminal-peek-trigger][aria-expanded="true"]')).some(trigger => {
      const workspace = trigger.closest('[data-session-workspace]');
      return !workspace || workspace.getAttribute('data-session-workspace') === sessionId;
    });
    if (!active || !enabled || phase !== null || !pendingEntry.current && !stopped
      || document.visibilityState !== 'visible' || !document.hasFocus()
      || ownTerminalOpen) return;
    if (!backendSessionId) return;
    const entryId = pendingEntry.current;
    const controller = new AbortController(), client = currentSecureClient();
    request.current = controller;
    const cancel = () => controller.abort();
    const visibility = () => { if (document.visibilityState !== 'visible') cancel(); };
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', visibility);
    void (async () => {
      // StrictMode may replay mount effects. Consume the entry only when its
      // request really starts, so cleanup cannot swallow or duplicate it.
      await Promise.resolve();
      if (controller.signal.aborted) return;
      if (pendingEntry.current === entryId) pendingEntry.current = undefined;
      try {
        const response = await fetch(`/api/terminal/${encodeURIComponent(sessionId)}/input-check`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ backendSessionId, ...(entryId ? { entryId } : {}) }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(6000)]),
        });
        const result = response.ok ? await response.json() : { status: response.status === 409 || response.status === 404 ? 'skipped' : 'unconfirmed' };
        if (!controller.signal.aborted && currentSecureClient() === client
          && useTerminalStore.getState().sessions.get(sessionId)?.terminalSessionId === backendSessionId) {
          setUnconfirmed(result.status === 'unconfirmed');
        }
      } catch {
        if (!controller.signal.aborted && currentSecureClient() === client) setUnconfirmed(true);
      }
    })();
    return () => {
      cancel(); window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [sessionId, phase, enabled, active, backendSessionId]);
  return unconfirmed;
}
