import type { CollaborationPaneBinding } from './collaborationRouting.js';
import { serializeTerminalInput } from './terminalInput.js';
import { probeTerminalReadiness, type InputFrame, type InputCheckResult } from './terminalReadinessProbe.js';
import { RenderedTerminalContext } from './renderedTerminalContext.js';

/** Shares the delivery queue with normal TD messages to this exact pane. */
export function probeTmuxReadiness(input: {
  pane: CollaborationPaneBinding;
  run: (args: string[]) => Promise<string>;
  stdin: (args: string[], text: string) => Promise<string>;
  assertCurrent: () => void;
  shouldStart?: () => boolean;
  beforePaste?: () => void;
}): Promise<InputCheckResult> {
  const { pane, run, stdin, assertCurrent } = input;
  const key = `${pane.serverPid}:${pane.sessionId}:${pane.paneId}:${pane.panePid}`;
  const buffer = `termdock-input-check-${process.pid}-${crypto.randomUUID()}`;
  const read = async (): Promise<InputFrame> => {
    assertCurrent();
    const [header, ...lines] = (await run(['display-message', '-p', '-t', pane.paneId,
      '#{pid}:#{session_id}:#{pane_id}:#{pane_pid}:#{cursor_x}:#{cursor_y}:#{pane_width}:#{pane_height}:#{pane_in_mode}:#{pane_dead}:#{pane_input_off}',
      ';', 'capture-pane', '-p', '-t', pane.paneId])).split('\n');
    const fields = header.split(':');
    if (fields.slice(0, 4).join(':') !== key || fields.slice(8).join(':') !== '0:0:0') throw new Error('INPUT_CHECK_TARGET_CHANGED');
    assertCurrent();
    const cols = Number(fields[6]), rows = Number(fields[7]);
    const frame = new RenderedTerminalContext(cols, rows);
    try {
      frame.write(lines.slice(0, rows).join('\r\n') + `\x1b[${Number(fields[5]) + 1};${Number(fields[4]) + 1}H`);
      return await frame.inputFrame();
    } finally { frame.dispose(); }
  };
  return serializeTerminalInput(key, async () => {
    try {
      return await probeTerminalReadiness({ read, assertCurrent, shouldStart: input.shouldStart,
        paste: async marker => {
          await read(); assertCurrent();
          input.beforePaste?.();
          await stdin(['load-buffer', '-b', buffer, '-', ';', 'paste-buffer', '-p', '-r', '-d', '-b', buffer, '-t', pane.paneId], marker);
        },
        erase: async count => { assertCurrent(); await run(['send-keys', '-t', pane.paneId, '-N', String(count), 'BSpace']); },
      });
    } finally { await run(['delete-buffer', '-b', buffer]).catch(() => undefined); }
  });
}
