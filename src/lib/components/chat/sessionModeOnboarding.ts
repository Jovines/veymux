/** Client-local guidance, deliberately excluded from server/client-state sync. */
export const TERMINAL_MODE_HINT_KEY = 'termdock:onboarding:terminal-chat-hint';
export const TERMINAL_MODE_HINT_EVENT = 'termdock:terminal-mode-hint';
interface HintRecord { version: 1; shownAt?: number; understoodAt?: number; dismissedAt?: number; resolution?: 'dismissed' | 'interrupted' | 'acknowledged' }
let memory: HintRecord | null = null;
let memoryOnly = false;
function read(): HintRecord | null {
  if (memoryOnly) return memory;
  try {
    const value = JSON.parse(localStorage.getItem(TERMINAL_MODE_HINT_KEY) || 'null');
    return value?.version === 1 && (Number.isFinite(value.shownAt) || Number.isFinite(value.understoodAt)) ? value : null;
  } catch { memoryOnly = true; return memory; }
}
function write(value: HintRecord) {
  memory = value;
  if (!memoryOnly) try { localStorage.setItem(TERMINAL_MODE_HINT_KEY, JSON.stringify(value)); } catch { memoryOnly = true; }
}
export const hasSeenTerminalModeHint = () => read() !== null;
/** Explicitly choosing a named mode proves awareness of the entry, not switch success. */
export function acknowledgeSessionModes() {
  write({ ...read(), version: 1, understoodAt: Date.now(), resolution: 'acknowledged' });
  window.dispatchEvent(new CustomEvent(TERMINAL_MODE_HINT_EVENT));
}
/** A synchronous claim also deduplicates panes when Web Locks is unavailable. */
export async function claimTerminalModeHint(owner: symbol, current: () => boolean): Promise<boolean> {
  const claim = () => {
    if (!current() || hasSeenTerminalModeHint()) return false;
    write({ version: 1, shownAt: Date.now() });
    window.dispatchEvent(new CustomEvent(TERMINAL_MODE_HINT_EVENT, { detail: owner }));
    return true;
  };
  // Same-origin tabs and retained workspaces share this lock and storage key.
  // An unavailable lock service must not interfere with terminal use.
  try { if (navigator.locks) return await navigator.locks.request(TERMINAL_MODE_HINT_KEY, claim); }
  catch { /* Fall back to the page's synchronous claim. */ }
  return claim();
}
export function dismissTerminalModeHint(resolution: 'dismissed' | 'interrupted') {
  const record = read();
  if (record) write({ ...record, dismissedAt: Date.now(), resolution });
}
