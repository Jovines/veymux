import { createTerminalProbeMarker } from './terminalProbeMarker.js';

export interface InputFrame {
  lines: string[]; x: number; y: number; cols: number;
  /** Cell-based cursor slices; JS string offsets cannot represent CJK/emoji. */
  prefix?: string; suffix?: string; endX?: number;
}
export interface InputCheckResult {
  status: 'ready' | 'unconfirmed' | 'skipped';
  /** Only set after a paste was attempted; never blindly retry that paste. */
  residual?: string;
  echoOnly?: boolean;
}

interface TerminalInputProbe {
  read: () => Promise<string>;
  paste: (text: string) => Promise<void>;
  erase: (count: number) => Promise<void>;
  assertCurrent: () => void;
  shouldStart?: () => boolean;
  timeoutMs?: number;
}

/** Callers establish the no-draft/eligible-input conditions before starting.
 * Always pair the two-symbol paste with two backspaces on the same runtime,
 * even if echo times out. Screen text/cursor layout must never gate cleanup.
 * No Enter, draft detection, or retry of an uncertain edit. */
export async function probeTerminalInput(input: TerminalInputProbe): Promise<InputCheckResult> {
  const timeout = input.timeoutMs ?? 700;
  let marker: string | null = null;
  let attempted = false;
  const read = async (remaining = timeout) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([input.read(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('INPUT_CHECK_TIMEOUT')), Math.max(1, remaining));
      })]);
    } finally { clearTimeout(timer); }
  };
  const contains = (screen: string) => screen.replace(/\r?\n/g, '').includes(marker!);
  const waitFor = async (predicate: (screen: string) => boolean) => {
    const deadline = Date.now() + timeout;
    for (;;) {
      input.assertCurrent();
      const screen = await read(deadline - Date.now()); input.assertCurrent();
      if (predicate(screen)) return true;
      if (Date.now() >= deadline) return false;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  try {
    if (input.shouldStart?.() === false) return { status: 'skipped' };
    input.assertCurrent();
    const before = await read(); input.assertCurrent();
    marker = createTerminalProbeMarker(before);
    if (!marker || input.shouldStart?.() === false) return { status: 'skipped' };
    let echoed = false;
    attempted = true;
    try {
      await input.paste(marker);
      echoed = await waitFor(contains);
    } finally {
      // Snapshot failures and missing echo must not leave an attempted paste
      // without its cleanup. A replaced runtime must never receive these keys.
      input.assertCurrent();
      await input.erase(marker.length);
    }
    if (!await waitFor(screen => !contains(screen))) return { status: 'unconfirmed', residual: marker };
    if (!echoed) return { status: 'unconfirmed' };
    // Allow the independent output observer to consume the echo/erase packets.
    await new Promise(resolve => setTimeout(resolve, 60));
    input.assertCurrent();
    const after = await read(); input.assertCurrent();
    if (contains(after)) return { status: 'unconfirmed', residual: marker };
    // Screen equality only quarantines probe output; it never gates deletion
    // or readiness, and does not interpret any part of the screen as a draft.
    return { status: 'ready', echoOnly: before === after };
  } catch {
    return { status: attempted ? 'unconfirmed' : 'skipped', ...(attempted && marker ? { residual: marker } : {}) };
  }
}

export function probeTerminalReadiness(input: Omit<TerminalInputProbe, 'read'> & {
  read: () => Promise<InputFrame>;
}): Promise<InputCheckResult> {
  return probeTerminalInput({ ...input, read: async () => (await input.read()).lines.join('\n') });
}
