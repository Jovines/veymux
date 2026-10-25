import { expect, it, vi } from 'vitest';
import { batchTmuxCommands, batchTmuxConfiguration } from './tmuxConfigurationBatch.js';
import type { TmuxCommandRunner } from './terminalColorEnvironment.js';

it('batches writes in order and preserves argument data containing separators', async () => {
  const run = vi.fn();
  await batchTmuxConfiguration(run, async write => {
    await write(['set-option', '-t', 'task;', '@label', 'ends;']);
    await write(['set-environment', '-t', 'task;', 'NAME', 'with spaces']);
  });
  expect(run).toHaveBeenCalledOnce();
  expect(run).toHaveBeenCalledWith([
    'set-option', '-t', 'task\\;', '@label', 'ends\\;', ';',
    'set-environment', '-t', 'task\\;', 'NAME', 'with spaces',
  ]);
  expect(batchTmuxCommands([])).toEqual([]);
});

it('replays legacy fallbacks after a partially applied batch and keeps applying later settings', async () => {
  const run = vi.fn(async (args: string[]) => {
    if (args.includes(';') || args.includes('modern')) throw new Error('unknown option');
  });
  const configure = async (write: TmuxCommandRunner) => {
    await write(['set-option', '@first', 'on']);
    try { await write(['set-option', 'modern', 'on']); }
    catch { await write(['set-option', 'legacy', 'on']); }
    await write(['set-option', '@last', 'on']);
  };
  await batchTmuxConfiguration(run, configure);
  expect(run.mock.calls.slice(1).map(([args]) => args)).toEqual([
    ['set-option', '@first', 'on'], ['set-option', 'modern', 'on'],
    ['set-option', 'legacy', 'on'], ['set-option', '@last', 'on'],
  ]);
  // There is no sticky success cache: external edits and tmux restarts get repaired.
  run.mockClear();
  await batchTmuxConfiguration(run, configure);
  expect(run.mock.calls).toHaveLength(5);
});

it('propagates a required setting failure rather than declaring preparation successful', async () => {
  const run = vi.fn().mockRejectedValue(new Error('tmux unavailable'));
  await expect(batchTmuxConfiguration(run, async write => {
    await write(['set-option', '@required', 'on']);
  })).rejects.toThrow('tmux unavailable');
  expect(run).toHaveBeenCalledTimes(2);
});
