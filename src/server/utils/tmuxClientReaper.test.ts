// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { isLegacyTmuxClient, parseTmuxProcessList, TmuxClientReaper, type TmuxClientProcess } from './tmuxClientReaper.js';

afterEach(() => vi.useRealTimers());
const record = (pid: number, patch: Partial<TmuxClientProcess> = {}): TmuxClientProcess => ({
  pid, parentPid: 1, uid: process.getuid!(), started: 'birth-1', command: 'tmux -u -T RGB,sync attach-session -f ignore-size -t wt-old', ...patch,
});
function fixture() {
  vi.useFakeTimers();
  const processes = new Map<number, TmuxClientProcess>();
  const signal = vi.fn();
  const reaper = new TmuxClientReaper({ read: pid => processes.get(pid) ?? null, signal, graceMs: 100 });
  function pty(pid: number) {
    processes.set(pid, record(pid, { parentPid: process.pid }));
    const listeners = new Set<() => void>();
    return { pid, kill: vi.fn(),
      onExit: (handler: () => void) => { listeners.add(handler); return { dispose: () => listeners.delete(handler) }; },
      exit: () => { processes.delete(pid); [...listeners].forEach(fn => fn()); },
    };
  }
  return { processes, signal, reaper, pty };
}

it('parses both Linux and macOS ps rows without splitting executable arguments', () => {
  expect(parseTmuxProcessList(' 123 1 501 Mon Oct 26 10:00:00 2026 /opt/homebrew/bin/tmux -u attach-session -t wt-old\ninvalid'))
    .toEqual([{ pid: 123, parentPid: 1, uid: 501, started: 'Mon Oct 26 10:00:00 2026', command: '/opt/homebrew/bin/tmux -u attach-session -t wt-old' }]);
});

it('recognizes legacy displays, control clients and numeric session IDs only on confirmed Veymux targets', () => {
  const targets = new Set(['wt-old', '$10', 'named project']);
  for (const command of ['tmux -u -T RGB,sync attach-session -f ignore-size -t wt-old',
    '/opt/homebrew/bin/tmux -u -C attach-session -r -t =wt-old', 'tmux -C attach -r -t wt-old',
    'tmux -u attach-session -t $10 -f ignore-size']) expect(isLegacyTmuxClient(command, targets)).toBe(true);
  for (const command of ['tmux -u attach-session -t wt-unknown', 'tmux attach-session -t wt-old',
    'node tmux -u attach-session -t wt-old', 'tmux -u new-session -s wt-old', 'tmux -u attach-session -t wt-old extra',
    'tmux -L other -u attach-session -t wt-old', 'tmux -C attach -t wt-old', 'sh -c tmux -u attach-session -t wt-old']) {
    expect(isLegacyTmuxClient(command, targets)).toBe(false);
  }
});

it('gracefully closes a client once and escalates a stuck client without signalling any pane', async () => {
  const f = fixture(), a = f.pty(101), b = f.pty(102);
  f.reaper.trackPty(a); f.reaper.trackPty(b);
  f.reaper.stop(a); f.reaper.stop(a); a.exit();
  f.reaper.stop(b);
  await vi.advanceTimersByTimeAsync(100);
  expect(f.signal.mock.calls).toEqual([[101, 'SIGTERM'], [102, 'SIGTERM'], [102, 'SIGKILL']]);
  expect(a.kill).not.toHaveBeenCalled(); expect(b.kill).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('does not signal a reused PID, an exited client or a client now owned by another process', async () => {
  const f = fixture(), a = f.pty(101), b = f.pty(102), c = f.pty(103);
  f.reaper.trackPty(a); f.reaper.trackPty(b); f.reaper.trackPty(c);
  f.reaper.stop(a); f.processes.set(101, record(101, { parentPid: process.pid, started: 'reused' }));
  b.exit(); f.reaper.stop(b);
  f.processes.set(103, record(103, { parentPid: 999 })); f.reaper.stop(c);
  await vi.advanceTimersByTimeAsync(100);
  expect(f.signal.mock.calls).toEqual([[101, 'SIGTERM']]);
});

it('shutdown and synchronous exit cover pending clients, control clients and late asynchronous spawns', async () => {
  const f = fixture(), a = f.pty(101), b = f.pty(102);
  f.reaper.trackPty(a);
  const control = { pid: 103, kill: vi.fn(), once: vi.fn() };
  f.processes.set(103, record(103, { parentPid: process.pid }));
  f.reaper.trackControl(control);
  const shutdown = f.reaper.shutdown();
  f.reaper.trackPty(b); // An asynchronous spawn finished during shutdown.
  f.reaper.killOnExit();
  await shutdown;
  expect(f.signal.mock.calls.filter(([, signal]) => signal === 'SIGKILL').map(([pid]) => pid)).toEqual([101, 103, 102]);
  expect(vi.getTimerCount()).toBe(0);
});

it('upgrades reclaim only orphaned, same-user attach clients on verified historical sessions', async () => {
  const f = fixture();
  const rows = [record(101), record(102, { parentPid: 456 }), record(103, { uid: process.getuid!() + 1 }),
    record(104, { command: 'tmux -u new-session -s wt-old' }), record(105, { command: 'tmux -u attach-session -t private' }),
    record(106, { command: 'claude' }), record(107)];
  rows.forEach(row => f.processes.set(row.pid, row));
  f.processes.set(107, record(107, { parentPid: 456 })); // Revalidated after the ps snapshot.
  expect(await f.reaper.sweepLegacy(new Set(['wt-old']), rows)).toBe(1);
  await vi.advanceTimersByTimeAsync(100);
  expect(f.signal.mock.calls).toEqual([[101, 'SIGTERM'], [101, 'SIGKILL']]);
});

it('runs the upgrade check at startup and every minute, then stops maintenance on shutdown', async () => {
  const f = fixture();
  const check = vi.spyOn(f.reaper, 'sweepLegacy').mockResolvedValueOnce(2).mockResolvedValue(0);
  const targets = vi.fn(async () => new Set(['wt-old'])), log = vi.fn();
  await f.reaper.startMaintenance(targets, log);
  expect(check).toHaveBeenCalledOnce();
  expect(log).toHaveBeenCalledWith(expect.stringContaining('2 orphaned'));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(check).toHaveBeenCalledTimes(2);
  await f.reaper.shutdown();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(check).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});
