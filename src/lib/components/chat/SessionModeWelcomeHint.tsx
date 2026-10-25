import { ArrowRight } from 'lucide-react';
import { useSessionCapabilities } from '../../federation/ShareAccessContext';
import { acknowledgeSessionModes } from './sessionModeOnboarding';

/** Part of the chat empty state, never frequency-capped or persisted. */
export function SessionModeWelcomeHint({ onTerminal }: { onTerminal: () => void }) {
  const capabilities = useSessionCapabilities();
  if (!capabilities.has('session.view')) return null;
  return <div data-session-mode-welcome className="mt-2 text-xs leading-6 text-muted-foreground">
    <p>更习惯命令行？<button type="button" className="inline-flex min-h-11 items-center gap-1 rounded px-1 text-xs text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onPointerDown={event => event.preventDefault()} onClick={() => {
        acknowledgeSessionModes();
        const focused = document.activeElement;
        if (focused instanceof HTMLElement && focused.matches('textarea,input,[contenteditable="true"]')) focused.blur();
        onTerminal();
      }}>切换到终端<ArrowRight size={12} aria-hidden="true" /></button></p>
  </div>;
}
