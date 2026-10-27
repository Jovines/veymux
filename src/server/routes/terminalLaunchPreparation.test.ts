// @vitest-environment node
import fs from 'node:fs';
import vm from 'node:vm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { batchTmuxConfiguration, batchTmuxCommands } from '../utils/tmuxConfigurationBatch.js';
import { buildTmuxColorEnvironmentCommands, ensureTmuxColorCapabilities } from '../utils/terminalColorEnvironment.js';

const source = fs.readFileSync(new URL('./terminal.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('terminal.ts', source, ts.ScriptTarget.Latest, true);
const names = new Set(['configureTmuxWheelBindings', 'configureTmuxWheelBindingsIndividually',
  'applyTmuxScrollbackProfile', 'ensureTmuxColorEnvironment', 'ensureManagedTmuxColorCapabilities',
  'configureManagedTmuxSessionBatch', 'tmuxSessionStamp', 'prepareManagedTmuxSessionUnlocked']);
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text ?? ''))
  .map(node => node.getText(ast)).join('\n');

it.skipIf(process.platform === 'win32')('preserves real tmux mouse, copy, color and multi-window scrollback settings with fewer subprocesses', async () => {
  const socket = `veymux-launch-config-${process.pid}-${Date.now()}`;
  let activeSocket = socket;
  const exec = promisify(execFile);
  const run = async (args: string[]) => (await exec('tmux', ['-L', activeSocket, ...args], { timeout: 5000 })).stdout;
  let calls = 0;
  const context = vm.createContext({
    console, process, batchTmuxConfiguration, batchTmuxCommands, buildTmuxColorEnvironmentCommands, ensureTmuxColorCapabilities,
    runTmux: (args: string[]) => { calls++; return run(args); },
    resolveTmuxInnerTerm: async () => 'tmux-256color', VEYMUX_TMUX_HISTORY_LIMIT: 9876, getErrorMessage: String,
    getTmuxOption: async (name: string, key: string) => (await run(['show-option', '-vqt', name, key])).trim() || null,
    VEYMUX_VERSION: 'test', VEYMUX_HOST: 'test-host', VEYMUX_PID: String(process.pid),
  });
  vm.runInContext(ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  try {
    await run(['-f', '/dev/null', 'new-session', '-d', '-s', 'target']);
    await run(['new-session', '-d', '-s', 'untouched']);
    await run(['new-window', '-t', 'target']);
    await context.configureTmuxWheelBindingsIndividually(context.runTmux);
    const originalCalls = calls;
    const original = await run(['list-keys']);
    calls = 0;
    await context.configureTmuxWheelBindings();
    expect(calls).toBe(1);
    expect(originalCalls).toBeGreaterThan(10);
    expect(await run(['list-keys'])).toBe(original);

    await context.ensureTmuxColorEnvironment('target');
    await context.ensureManagedTmuxColorCapabilities('target');
    await context.applyTmuxScrollbackProfile('target');
    expect((await run(['show-environment', '-t', 'target', 'COLORTERM'])).trim()).toBe('COLORTERM=truecolor');
    expect((await run(['show-environment', '-t', 'target', 'TERM'])).trim()).toBe('TERM=tmux-256color');
    expect((await run(['show-option', '-v', '-t', 'target', 'history-limit'])).trim()).toBe('9876');
    for (const windowId of (await run(['list-windows', '-t', 'target', '-F', '#{window_id}'])).trim().split('\n')) {
      expect((await run(['show-option', '-wv', '-t', windowId, 'scroll-on-clear'])).trim()).toBe('off');
    }
    for (const label of ['ends;', 'backslash\\;', 'with spaces; 中文']) {
      await run(batchTmuxCommands([['set-option', '-t', 'target', '@launch-test', label], ['set-option', '-t', 'target', '@done', 'on']]));
      expect((await run(['show-option', '-vqt', 'target', '@launch-test'])).trim()).toBe(label);
      expect((await run(['show-option', '-vqt', 'untouched', '@launch-test'])).trim()).toBe('');
    }
    // Apply again after external configuration edits; no cached success hides them.
    await run(['set-option', '-t', 'target', 'history-limit', '123']);
    await context.applyTmuxScrollbackProfile('target');
    expect((await run(['show-option', '-v', '-t', 'target', 'history-limit'])).trim()).toBe('9876');

    const size = await run(['display-message', '-p', '-t', 'target', '#{window_width}x#{window_height}']);
    calls = 0;
    await context.configureManagedTmuxSessionBatch('target');
    expect(calls).toBe(3); // Window/switch discovery and one configuration submission.
    const createdAt = await run(['show-option', '-vqt', 'target', '@veymux-created-at']);
    expect(createdAt.trim()).toMatch(/^\d+$/);
    expect((await run(['show-option', '-gv', 'focus-events'])).trim()).toBe('off');
    expect((await run(['show-option', '-v', '-t', 'target', 'mouse'])).trim()).toBe('on');
    expect((await run(['show-option', '-v', '-t', 'target', 'status'])).trim()).toBe('off');
    expect((await run(['show-environment', '-t', 'target', 'VEYMUX'])).trim()).toBe('VEYMUX=1');
    expect(await run(['display-message', '-p', '-t', 'target', '#{window_width}x#{window_height}'])).toBe(size);
    expect(await run(['list-keys'])).toBe(original);
    await run(['set-environment', '-t', 'target', 'NO_COLOR', '1']);
    await run(['set-option', '-t', 'target', 'mouse', 'off']);
    await context.configureManagedTmuxSessionBatch('target');
    expect(await run(['show-option', '-vqt', 'target', '@veymux-created-at'])).toBe(createdAt);
    expect((await run(['show-option', '-v', '-t', 'target', 'mouse'])).trim()).toBe('on');
    await expect(run(['show-environment', '-t', 'target', 'NO_COLOR'])).rejects.toThrow('unknown variable: NO_COLOR');
    await run(['kill-server']);
    // A distinct socket avoids racing the previous server's asynchronous socket
    // unlink while exercising a fresh server with the same target session name.
    activeSocket = `${socket}-restarted`;
    await run(['-f', '/dev/null', 'new-session', '-d', '-s', 'target']);
    await context.configureManagedTmuxSessionBatch('target');
    expect((await run(['show-option', '-v', '-t', 'target', 'mouse'])).trim()).toBe('on');
    expect((await run(['show-environment', '-t', 'target', 'VEYMUX'])).trim()).toBe('VEYMUX=1');
    const pty = createRequire(import.meta.url)('node-pty') as typeof import('node-pty');
    const serverPid = (await run(['display-message', '-p', '#{pid}'])).trim();
    for (let i = 0; i < 20; i++) {
      const name = `churn-${i}`;
      await run(['new-session', '-d', '-s', name]);
      await context.configureManagedTmuxSessionBatch(name);
      const display = pty.spawn('tmux', ['-L', activeSocket, 'attach-session', '-t', name], {
        cols: 80, rows: 24, name: 'xterm-256color', env: { ...process.env, TMUX: '' },
      });
      display.onData(() => {});
      try {
        await vi.waitFor(async () => expect((await run(['list-clients', '-t', name, '-F', '#{client_pid}'])).trim()).not.toBe(''));
        display.write('\x1b[I\x1b[O');
        await run(['set-option', '-g', 'focus-events', 'off', ';', 'detach-client', '-s', name]);
      } finally { display.kill(); }
      await run(['kill-session', '-t', name]);
      expect((await run(['display-message', '-p', '#{pid}'])).trim()).toBe(serverPid);
      expect((await run(['list-sessions', '-F', '#{session_name}'])).trim()).toBe('target');
    }
  } finally { await run(['kill-server']).catch(() => {}); }
}, 15000);

it('retains legacy preparation after a failed batch and reattempts batching on the next creation', async () => {
  const events: string[] = [];
  const context = vm.createContext({});
  const prepare = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'prepareManagedTmuxSessionUnlocked')!.getText(ast);
  Object.assign(context, {
    ensureTmuxSessionExists: vi.fn(async () => { events.push('exists'); }),
    configureManagedTmuxSessionBatch: vi.fn(async () => { events.push('batch'); throw new Error('unknown option: extended-keys'); }),
    ensureSharedTmuxServerReady: vi.fn(async () => { events.push('shared-compatibility'); }),
    ensureManagedTmuxSessionReady: vi.fn(async () => { events.push('session-compatibility'); }),
  });
  vm.runInContext(ts.transpileModule(prepare, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  await context.prepareManagedTmuxSessionUnlocked('old-tmux', '/work');
  await context.prepareManagedTmuxSessionUnlocked('next', '/work');
  expect(events).toEqual(['exists', 'batch', 'shared-compatibility', 'session-compatibility',
    'exists', 'batch', 'shared-compatibility', 'session-compatibility']);
  context.ensureTmuxSessionExists.mockRejectedValueOnce(new Error('spawn failed'));
  await expect(context.prepareManagedTmuxSessionUnlocked('failed', '/work')).rejects.toThrow('spawn failed');
  expect(context.configureManagedTmuxSessionBatch).toHaveBeenCalledTimes(2);
});
