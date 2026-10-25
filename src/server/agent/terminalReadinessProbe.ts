import { randomBytes } from 'node:crypto';

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
const same = (a: InputFrame, b: InputFrame) => a.x === b.x && a.y === b.y && a.cols === b.cols && JSON.stringify(a.lines) === JSON.stringify(b.lines);
const sameInput = (a: InputFrame, b: InputFrame) => a.x === b.x && a.y === b.y && a.cols === b.cols && a.lines[a.y] === b.lines[b.y];

/** A single reversible edit, never a submitted prompt or an approval key.
 * Delete only a proven insertion at the unchanged cursor, then verify restoration.
 * Missing echo means unknown, not a blocked or dead Agent. */
export async function probeTerminalReadiness(input: {
  read: () => Promise<InputFrame>;
  paste: (text: string) => Promise<void>;
  erase: (count: number) => Promise<void>;
  assertCurrent: () => void;
  shouldStart?: () => boolean;
  timeoutMs?: number;
}): Promise<InputCheckResult> {
  const marker = `td${randomBytes(4).toString('hex')}`;
  const timeout = input.timeoutMs ?? 700;
  let attempted = false;
  let before: InputFrame | undefined;
  let unrelatedOutput = false;
  const read = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([input.read(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('INPUT_CHECK_TIMEOUT')), timeout);
      })]);
    } finally { clearTimeout(timer); }
  };
  try {
    if (input.shouldStart?.() === false) return { status: 'skipped' };
    input.assertCurrent(); before = await read(); input.assertCurrent();
    // Keep the entire marker on one row so cursor proof and cleanup cannot
    // cross a wrap boundary, overwrite the draft or depend on Unicode width.
    if (Math.max(before.x, before.endX ?? before.lines[before.y]?.length ?? 0) + marker.length >= before.cols || before.lines.join('\n').includes(marker)) return { status: 'skipped' };
    const expected = structuredClone(before);
    const row = expected.lines[before.y] ?? '';
    const prefix = before.prefix ?? row.padEnd(before.x, ' ').slice(0, before.x);
    const suffix = before.suffix ?? row.slice(before.x);
    if ((prefix + suffix).trimEnd() !== row) return { status: 'skipped' };
    expected.lines[before.y] = (prefix + marker + suffix).trimEnd();
    expected.x += marker.length;
    if (!same(await read(), before)) return { status: 'skipped' };
    input.assertCurrent();
    if (input.shouldStart?.() === false) return { status: 'skipped' };
    attempted = true;
    await input.paste(marker);
    const deadline = Date.now() + timeout;
    for (;;) {
      input.assertCurrent();
      const frame = await read(); input.assertCurrent();
      unrelatedOutput ||= frame.lines.some((line, row) => row !== before!.y && line !== before!.lines[row]);
      if (sameInput(frame, expected)) {
        // Re-read immediately before erasing: output or an external tmux
        // keyboard may have moved the cursor since the first echo.
        if (!sameInput(await read(), expected)) return { status: 'unconfirmed', residual: marker };
        input.assertCurrent(); await input.erase(marker.length);
        const cleanupDeadline = Date.now() + timeout;
        for (;;) {
          input.assertCurrent();
          const restored = await read();
          unrelatedOutput ||= restored.lines.some((line, row) => row !== before!.y && line !== before!.lines[row]);
          if (sameInput(restored, before)) {
            // Let the independent output observer consume the echo/erase
            // packets before releasing the activity quarantine.
            await new Promise(resolve => setTimeout(resolve, 60));
            input.assertCurrent();
            return { status: 'ready', echoOnly: !unrelatedOutput && same(await read(), before) };
          }
          if (Date.now() >= cleanupDeadline) return { status: 'unconfirmed', residual: marker };
          await new Promise(resolve => setTimeout(resolve, 20));
        }
      }
      if (Date.now() >= deadline) return { status: 'unconfirmed', residual: marker };
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  } catch {
    return { status: attempted ? 'unconfirmed' : 'skipped', ...(attempted ? { residual: marker } : {}) };
  }
}
