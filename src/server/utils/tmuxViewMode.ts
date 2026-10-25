import type { SessionViewMode, SessionViewModeStore } from '../agent/sessionViewModeRoutes.js';

export const TMUX_VIEW_MODE_OPTION = '@termdock-view-mode';
export const TMUX_FRONTEND_SESSION_OPTION = '@termdock-frontend-session-id';
export const isSessionViewMode = (mode: unknown): mode is SessionViewMode => mode === 'chat' || mode === 'terminal';

/** Adopt the surviving tmux preference before replacing its frontend identity.
 * Older versions only saved preferences under that previous frontend ID.
 */
export async function restoreTmuxViewMode(store: SessionViewModeStore, sessionId: string, tmuxName: string,
  readOption: (name: string, option: string) => Promise<string | null>): Promise<SessionViewMode | null> {
  const current = store.get(sessionId);
  if (current) return current.mode;
  const saved = await readOption(tmuxName, TMUX_VIEW_MODE_OPTION);
  const previousId = isSessionViewMode(saved) ? null : await readOption(tmuxName, TMUX_FRONTEND_SESSION_OPTION);
  const mode = isSessionViewMode(saved) ? saved : previousId ? store.get(previousId)?.mode : null;
  if (!mode) return null;
  store.set(sessionId, mode);
  return mode;
}
