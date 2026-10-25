import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSessionCapabilities } from '../../federation/ShareAccessContext';
import { useTerminalStore } from '../../stores/useTerminalStore';
import { useViewportKeyboardState } from '../../hooks/useViewportKeyboardState';
import { usesTouchTerminalLayout } from '../../utils/touchTerminalLayout';
import { isWorkspaceActive, WORKSPACE_VISIBILITY_EVENT } from '../../services/workspaceHost';
import { isKeyboardLayerOpen } from '../../hooks/useKeyboardLayer';
import { getChatEligibility } from './chatModeEntry';
import { claimTerminalModeHint, dismissTerminalModeHint, hasSeenTerminalModeHint, TERMINAL_MODE_HINT_EVENT, TERMINAL_MODE_HINT_KEY } from './sessionModeOnboarding';
import { findTerminalModeHintAnchor, TerminalModeHintBubble } from './TerminalModeHintBubble';

/** Once-per-client guidance anchored to an existing mode switch. */
export function TerminalModeHint({ sessionId, active, ready }: { sessionId: string; active: boolean; ready: boolean }) {
  const capabilities = useSessionCapabilities();
  const enabled = active && capabilities.has('session.view') && capabilities.has('session.owner-menu');
  const connected = useTerminalStore(state => { const session = state.sessions.get(sessionId); return !!session?.terminalSessionId && !session.isConnecting; });
  const program = useTerminalStore(state => state.sessions.get(sessionId)?.activeProgram);
  const touch = usesTouchTerminalLayout();
  const keyboard = useViewportKeyboardState({ enabled: enabled && touch });
  const keyboardOpen = useRef(false); keyboardOpen.current = keyboard.isOpen;
  const owner = useRef(Symbol('terminal-mode-hint'));
  const interrupted = useRef(false), shown = useRef(false);
  const [visible, setVisible] = useState(false);
  const close = (resolution: 'dismissed' | 'interrupted') => {
    interrupted.current = true;
    if (shown.current) dismissTerminalModeHint(resolution);
    shown.current = false; setVisible(false);
  };
  useLayoutEffect(() => {
    interrupted.current = false; shown.current = false; setVisible(false);
    if (!enabled) return;
    const activity = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[data-terminal-mode-hint]')) return;
      if (event instanceof KeyboardEvent && ['Tab', 'Shift', 'Control', 'Meta', 'Alt'].includes(event.key)) return;
      // Merely focusing the native input must not move its layout or keyboard.
      if (event.type === 'pointerdown' && target?.closest('input,textarea,[contenteditable="true"]')) return;
      if (event.type === 'selectionchange' && !window.getSelection()?.toString()) return;
      close(event instanceof KeyboardEvent && event.key === 'Escape' ? 'dismissed' : 'interrupted');
    };
    const claimed = (event: Event) => {
      if ((event as CustomEvent).detail !== owner.current) {
        interrupted.current = true; shown.current = false; setVisible(false);
      }
    };
    const stored = (event: StorageEvent) => {
      if (event.key === TERMINAL_MODE_HINT_KEY && hasSeenTerminalModeHint()) claimed(event);
    };
    const hidden = () => { if (document.hidden || !isWorkspaceActive()) close('interrupted'); };
    const events = ['keydown', 'input', 'compositionstart', 'pointerdown', 'wheel', 'touchmove', 'dragstart', 'selectionchange'];
    for (const event of events) document.addEventListener(event, activity, { capture: true, passive: true });
    window.addEventListener(TERMINAL_MODE_HINT_EVENT, claimed);
    window.addEventListener('storage', stored);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener(WORKSPACE_VISIBILITY_EVENT, hidden);
    return () => {
      for (const event of events) document.removeEventListener(event, activity, true);
      window.removeEventListener(TERMINAL_MODE_HINT_EVENT, claimed);
      window.removeEventListener('storage', stored);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener(WORKSPACE_VISIBILITY_EVENT, hidden);
    };
  }, [sessionId, enabled]);
  useLayoutEffect(() => {
    if (shown.current && (!ready || !connected)) close('interrupted');
  }, [ready, connected]);
  useLayoutEffect(() => { if (shown.current) close('interrupted'); }, [program]);
  useLayoutEffect(() => { if (shown.current && keyboard.isOpen) close('interrupted'); }, [keyboard.isOpen]);
  useEffect(() => {
    if (!enabled || !ready || !connected || hasSeenTerminalModeHint() || interrupted.current) return;
    let cancelled = false;
    const current = () => !cancelled && !interrupted.current && document.visibilityState === 'visible' && isWorkspaceActive()
      && !keyboardOpen.current && !isKeyboardLayerOpen() && !window.getSelection()?.toString()
      && !!findTerminalModeHintAnchor(sessionId)
      && !(touch && document.activeElement instanceof Element && document.activeElement.matches('input,textarea,[contenteditable="true"]'));
    if (current()) void getChatEligibility(sessionId).then(async result => {
      if (!result.allowed || !current()) return;
      const claimed = await claimTerminalModeHint(owner.current, current);
      if (claimed && current()) { shown.current = true; setVisible(true); }
    }).catch(() => { /* Eligibility or connection failure leaves the terminal untouched. */ });
    return () => { cancelled = true; };
  }, [sessionId, enabled, ready, connected, program, touch]);
  if (!enabled || !ready || !connected || !visible) return null;
  return <TerminalModeHintBubble sessionId={sessionId} close={close} />;
}
