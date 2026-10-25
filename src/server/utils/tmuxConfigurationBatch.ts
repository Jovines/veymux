import type { TmuxCommandRunner } from './terminalColorEnvironment.js';

/** Data ending in a semicolon must not become a tmux command separator. */
export function batchTmuxCommands(commands: readonly string[][]): string[] {
  return commands.flatMap((command, index) => [
    ...(index ? [';'] : []),
    ...command.map(value => value.endsWith(';') ? `${value.slice(0, -1)}\\;` : value),
  ]);
}

/** Only use for idempotent configuration writes, never queries or lifecycle
 * commands. Replay the original per-command handling if a legacy tmux rejects
 * any part of the batch; a failed batch may already have applied earlier writes. */
export async function batchTmuxConfiguration(
  run: TmuxCommandRunner,
  configure: (run: TmuxCommandRunner) => Promise<void>,
): Promise<void> {
  const commands: string[][] = [];
  await configure(async command => { commands.push(command); });
  if (!commands.length) return;
  try {
    await run(batchTmuxCommands(commands));
  } catch {
    await configure(run);
  }
}
