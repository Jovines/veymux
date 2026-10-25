import { useEffect, useState, type RefObject } from 'react';

const idleMs = 3000;
/** Track human interaction on the retained DOM host, including children whose
 * React portal ancestry bypasses the popover. Terminal output is not activity. */
export function useTerminalPeekIdleClose(panel: RefObject<HTMLElement>, enabled: boolean, close: () => void) {
  const [seconds, setSeconds] = useState<number | null>(idleMs / 1000);
  useEffect(() => {
    const node = panel.current;
    if (!enabled || !node) { setSeconds(idleMs / 1000); return; }
    const deadline = performance.now() + idleMs;
    let engaged = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      clearTimeout(timer);
      if (engaged) return;
      const remaining = deadline - performance.now();
      if (remaining <= 0) { close(); return; }
      const next = Math.ceil(remaining / 1000);
      setSeconds(next);
      timer = setTimeout(tick, Math.max(1, remaining - (next - 1) * 1000));
    };
    const engage = () => {
      if (engaged) return;
      engaged = true;
      clearTimeout(timer);
      setSeconds(null);
    };
    const options = { capture: true, passive: true };
    // Observe the gesture rather than scroll events: live output can scroll
    // xterm programmatically. Once the user operates the preview it stays
    // open, without a countdown, until explicitly dismissed or reopened.
    const activity = ['pointerdown', 'touchmove', 'wheel', 'keydown', 'input', 'focusin', 'compositionstart'] as const;
    activity.forEach(event => node.addEventListener(event, engage, options));
    setSeconds(idleMs / 1000); tick();
    return () => {
      clearTimeout(timer);
      activity.forEach(event => node.removeEventListener(event, engage, true));
    };
  }, [panel, enabled, close]);
  return enabled ? seconds : null;
}
