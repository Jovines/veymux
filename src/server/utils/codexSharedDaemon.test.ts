import { expect, it } from 'vitest';
import { isSharedCodexDaemonCommand } from './codexSharedDaemon';

it('recognizes only the local managed Unix daemon, preserving independent writer conflicts', () => {
  const home = '/home/user/.codex';
  const exe = `${home}/packages/app-server-daemon/releases/0.164.0/bin/codex`;
  const argv = [exe, 'app-server', '--listen', 'unix://', '--managed-daemon'];
  expect(isSharedCodexDaemonCommand(exe, argv, home)).toBe(true);
  for (const other of [argv.filter(x => x !== '--managed-daemon'), [exe, 'resume', 'native'],
    argv.map(x => x === 'unix://' ? 'ws://localhost:9000' : x)]) {
    expect(isSharedCodexDaemonCommand(exe, other, home)).toBe(false);
  }
  expect(isSharedCodexDaemonCommand('/other/codex', argv, home)).toBe(false);
  expect(isSharedCodexDaemonCommand(exe, argv, '/home/other/.codex')).toBe(false);
});
