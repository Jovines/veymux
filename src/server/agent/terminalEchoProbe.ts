import type { TerminalInputGuard } from './terminalInput.js';
import { probeTerminalInput } from './terminalReadinessProbe.js';

/** Verify and remove the same two-symbol probe before pasting the message.
 * The probe never becomes part of the message or a separately submitted task. */
export async function probeTerminalEcho(input: {
  read: () => Promise<string>;
  write: (marker: string) => Promise<void>;
  erase: (count: number) => Promise<void>;
  assertCurrent?: TerminalInputGuard;
  timeoutMs?: number;
}): Promise<void> {
  const result = await probeTerminalInput({ read: input.read, paste: input.write, erase: input.erase,
    assertCurrent: () => input.assertCurrent?.('before_paste'), timeoutMs: input.timeoutMs ?? 1500 });
  if (result.status !== 'ready') throw new Error('TERMINAL_INPUT_ECHO_UNCONFIRMED');
}
