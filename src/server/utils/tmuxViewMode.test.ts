import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SessionViewModeStore } from '../agent/sessionViewModeRoutes';
import { restoreTmuxViewMode, TMUX_FRONTEND_SESSION_OPTION, TMUX_VIEW_MODE_OPTION } from './tmuxViewMode';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));
function store() {
  const directory = mkdtempSync(join(tmpdir(), 'td-tmux-view-')); directories.push(directory);
  return new SessionViewModeStore(join(directory, 'modes.json'));
}

it.each(['chat', 'terminal'] as const)('adopts the surviving tmux %s mode under a new frontend ID', async mode => {
  const preferences = store();
  const read = vi.fn(async (_name: string, option: string) => option === TMUX_VIEW_MODE_OPTION ? mode : null);
  expect(await restoreTmuxViewMode(preferences, 'new-id', 'wt-alive', read)).toBe(mode);
  expect(preferences.get('new-id')?.mode).toBe(mode);
  expect(preferences.get('other-session')).toBeNull();
});

it('migrates older sessions using their original frontend ID before it is replaced', async () => {
  const preferences = store(); preferences.set('old-id', 'chat');
  const read = vi.fn(async (_name: string, option: string) => option === TMUX_FRONTEND_SESSION_OPTION ? 'old-id' : null);
  expect(await restoreTmuxViewMode(preferences, 'new-id', 'wt-alive', read)).toBe('chat');
  expect(preferences.get('old-id')?.mode).toBe('chat');
  expect(preferences.get('new-id')?.mode).toBe('chat');
});

it('preserves a current explicit terminal choice and does not invent missing preferences', async () => {
  const preferences = store(); preferences.set('current', 'terminal');
  const read = vi.fn(async () => 'chat');
  expect(await restoreTmuxViewMode(preferences, 'current', 'wt-alive', read)).toBe('terminal');
  expect(read).not.toHaveBeenCalled();
  expect(await restoreTmuxViewMode(preferences, 'unknown', 'wt-alive', async () => 'invalid')).toBeNull();
  expect(preferences.get('unknown')).toBeNull();
});

it.skipIf(process.platform === 'win32')('retains the view mode in a real surviving tmux session across frontend IDs and a store restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'td-real-tmux-view-')); directories.push(directory);
  const execute = promisify(execFile);
  const run = async (args: string[]) => (await execute('tmux', ['-S', join(directory, 'tmux.sock'), ...args], { timeout: 5000 })).stdout.trim();
  const read = async (name: string, option: string) => (await run(['show-option', '-vqt', name, option])) || null;
  try {
    await run(['-f', '/dev/null', 'new-session', '-d', '-s', 'preserved', '-x', '120', '-y', '40', 'sleep 60']);
    const before = await run(['display-message', '-p', '-t', 'preserved', '#{pane_pid}:#{pane_width}x#{pane_height}']);
    const path = join(directory, 'modes.json'), preferences = new SessionViewModeStore(path);
    preferences.set('original-frontend', 'chat');
    await run(['set-option', '-t', 'preserved', TMUX_FRONTEND_SESSION_OPTION, 'original-frontend']);
    const migrated = await restoreTmuxViewMode(preferences, 'restored-frontend', 'preserved', read);
    expect(migrated).toBe('chat');
    await run(['set-option', '-t', 'preserved', TMUX_VIEW_MODE_OPTION, migrated!]);
    await run(['set-option', '-t', 'preserved', TMUX_FRONTEND_SESSION_OPTION, 'restored-frontend']);
    expect(await restoreTmuxViewMode(new SessionViewModeStore(path), 'another-frontend', 'preserved', read)).toBe('chat');
    await run(['set-option', '-t', 'preserved', TMUX_VIEW_MODE_OPTION, 'terminal']);
    expect(await restoreTmuxViewMode(preferences, 'terminal-frontend', 'preserved', read)).toBe('terminal');
    expect(await run(['display-message', '-p', '-t', 'preserved', '#{pane_pid}:#{pane_width}x#{pane_height}'])).toBe(before);
  } finally { await run(['kill-server']).catch(() => {}); }
});
