import { randomBytes } from 'node:crypto';
import type { TerminalInputGuard } from './terminalInput.js';

/** A printable delivery header, retained as part of the same message. Never
 * submit a test task, send editing keys, or infer that the Agent consumed it. */
export async function probeTerminalEcho(input: {
  read: () => Promise<string>;
  write: (header: string) => Promise<void>;
  assertCurrent?: TerminalInputGuard;
  timeoutMs?: number;
}): Promise<void> {
  const timeoutMs = input.timeoutMs ?? 1500;
  const read = async (ms: number) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([input.read(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('TERMINAL_INPUT_ECHO_UNCONFIRMED')), Math.max(1, ms));
      })]);
    } finally { clearTimeout(timer); }
  };
  const before = await read(timeoutMs);
  let marker: string;
  do { marker = `td.${randomBytes(6).toString('hex')}`; } while (before.includes(marker));
  input.assertCurrent?.('before_paste');
  await input.write(`[${marker}] `);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    input.assertCurrent?.('before_paste');
    // Wrapped lines are equivalent; the fresh random marker cannot match old
    // terminal history. Capture failures stop the operation too.
    if ((await read(deadline - Date.now())).replace(/\r?\n/g, '').includes(marker)) return;
    if (Date.now() >= deadline) throw new Error('TERMINAL_INPUT_ECHO_UNCONFIRMED');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}
