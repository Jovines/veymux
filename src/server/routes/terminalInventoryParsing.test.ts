// @vitest-environment node
import fs from 'node:fs';
import vm from 'node:vm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { getSessionPresentation } from '../utils/sessionDisplayName.js';

// Run the real list -> inventory -> reconciliation path without importing the
// route's boot-time side effects or touching the user's saved sessions.
const source = fs.readFileSync(new URL('./terminal.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('terminal.ts', source, ts.ScriptTarget.Latest, true);
const functions = new Set([
  'runTmux', 'runTmuxStdin', 'listLiveTmuxInventorySessions', 'parseDelimitedRow',
  'parseNumberOption', 'getErrorMessage', 'isTmuxServerMissingMessage',
  'buildSessionInventory', 'reconcileClientState', 'reconcileClientStateOnce',
]);
function routeCode(names: Set<string>) {
  return ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text ?? ''))
    .map(node => node.getText(ast)).join('\n');
}
const delimiter = '\x1f';
const row = (name = 'task') => [name, '1', '0', '', '', '', '', '', '', '', '', '', '', '', ''].join(delimiter);

function fixture(run: (args: string[]) => Promise<string>) {
  const record = { sessionId: 'frontend', mode: 'tmux', tmuxSessionName: 'task', backendSessionId: null, name: 'Terminal' };
  const persist = vi.fn(), observe = vi.fn(), retain = vi.fn();
  const context = vm.createContext({
    Date, Buffer, console: { log: vi.fn(), warn: vi.fn() },
    globalSessionState: { sessions: [record], updatedAt: 1 },
    runTmux: run, terminalSessions: new Map(), inventoryTmuxLiveness: new WeakMap(),
    getTmuxStatus: async () => ({ available: true }),
    isTermdockManagedTmuxSession: () => false, observeTmuxServerGeneration: observe,
    dynamicTmuxMetadata: { retain }, getTmuxRecoveryView: () => null,
    tmuxRecoveryState: { incident: null },
    todoStore: { collectionSessions: () => new Map() }, sessionViewModes: new Map(),
    shellNamesBackend: new Set(['sh', 'zsh']), agentCustomCommands: () => [],
    detectAgentFromCommand: () => null, serializeAgentIdentity: () => null, agentBySlug: () => null,
    getSessionPresentation, isTmuxRecoveryCandidate: () => false,
    schedulePersistGlobalState: persist, broadcastClientState: vi.fn(),
  });
  // runTmux is supplied for unit cases; its actual wrappers are tested below.
  const listCode = routeCode(new Set([...functions].filter(name => name !== 'runTmux' && name !== 'runTmuxStdin')));
  vm.runInContext(ts.transpileModule(`const TMUX_DELIMITER = '\\x1f';
    const TERMDOCK_GUI_DETACHED_AT_OPTION = '@termdock-gui-detached-at';
    const TERMDOCK_FRONTEND_SESSION_ID_OPTION = '@termdock-frontend-session-id';
    let reconcileInFlight = null;
    ${listCode}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  context.getSessionInventorySnapshot = () => context.buildSessionInventory();
  return { context, record, persist, observe, retain };
}

it.each([delimiter, '\\037', '\\x1f'])('retains empty metadata fields and live sessions with separator %j', async separator => {
  const run = vi.fn(async () => row().replaceAll(delimiter, separator) + '\n');
  const f = fixture(run);
  await f.context.reconcileClientState();
  await f.context.reconcileClientState();
  expect(f.context.globalSessionState.sessions).toEqual([f.record]);
  expect(f.persist).not.toHaveBeenCalled();
  const inventory = await f.context.buildSessionInventory();
  expect(inventory.clientSessions[0]).toMatchObject({ live: true, restorable: true });
  expect(inventory.tmuxSessions[0].name).toBe('task');
});

it('preserves Unicode names and metadata whitespace', async () => {
  const fields = row('任务_one').split(delimiter);
  fields[3] = ' 项目名称 ';
  fields[5] = '/tmp/project with spaces ';
  const f = fixture(async () => fields.join(delimiter) + '\n');
  expect(await f.context.listLiveTmuxInventorySessions()).toMatchObject([
    { name: '任务_one', friendlyName: ' 项目名称 ', cwd: '/tmp/project with spaces ', sourceFrontendSessionId: null },
  ]);
});

it.each([
  'task_1_0____________\n',
  row('other') + '\ntask_1_0____________\n',
  row().replace(`${delimiter}1${delimiter}`, `${delimiter}invalid${delimiter}`) + '\n',
  '   \n',
])('treats an unparseable whole or partial scan as unknown and preserves persisted sessions: %j', async raw => {
  const f = fixture(async () => raw);
  await expect(f.context.listLiveTmuxInventorySessions()).rejects.toThrow('Invalid tmux session inventory row');
  await f.context.reconcileClientState();
  expect(f.context.globalSessionState.sessions).toEqual([f.record]);
  expect(f.persist).not.toHaveBeenCalled();
  expect(f.observe).toHaveBeenCalledWith([], false);
  expect(f.retain).not.toHaveBeenCalled();
});

it('preserves state after a command failure, then prunes only after a valid empty scan', async () => {
  const run = vi.fn().mockRejectedValueOnce(new Error('tmux timed out')).mockResolvedValue('');
  const f = fixture(run);
  await f.context.reconcileClientState();
  expect(f.context.globalSessionState.sessions).toEqual([f.record]);
  expect(f.persist).not.toHaveBeenCalled();
  await f.context.reconcileClientState();
  expect(f.context.globalSessionState.sessions).toEqual([]);
  expect(f.persist).toHaveBeenCalledOnce();
});

const exec = promisify(execFile);
it.skipIf(process.platform === 'win32')('keeps real tmux inventory and stdin-command delimiters without a UTF-8 locale or TMUX environment', async () => {
  const binary = process.env.TERMDOCK_TEST_TMUX_BIN ?? 'tmux';
  const socket = `td-inventory-${process.pid}-${Date.now()}`;
  const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: 'C', LC_CTYPE: 'C', LANG: 'C' };
  delete env.TMUX;
  const execute = (file: string, args: string[], options: object) => exec(file, ['-L', socket, ...args], options);
  const run = async (args: string[]) => (await execute(binary, args, { env, timeout: 5000 })).stdout;
  const f = fixture(run);
  Object.assign(f.context, {
    process: { env }, getTmuxBinary: () => binary, execFileAsync: execute,
    execFile: (file: string, args: string[], options: object) => execFile(file, ['-L', socket, ...args], options),
    buildInteractiveColorEnvironment: (value: unknown) => value,
  });
  const wrappers = routeCode(new Set(['runTmux', 'runTmuxStdin']));
  vm.runInContext(ts.transpileModule(wrappers, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, f.context);
  try {
    await run(['-f', '/dev/null', 'new-session', '-d', '-s', 'task', '/bin/sleep', '120']);
    await run(['new-session', '-d', '-s', '任务_one', '/bin/sleep', '120']);
    await run(['set-option', '-t', 'task', '@termdock-friendly-name', '项目 名称']);
    Object.assign(f.record, { name: '项目 名称', customName: true });
    for (let scan = 0; scan < 3; scan++) {
      await f.context.reconcileClientState();
      expect(f.context.globalSessionState.sessions).toHaveLength(1);
      const sessions = await f.context.listLiveTmuxInventorySessions();
      expect(sessions.map((session: { name: string }) => session.name).sort()).toEqual(['task', '任务_one']);
      expect(sessions.find((session: { name: string }) => session.name === 'task').friendlyName).toBe('项目 名称');
    }
    const output = await f.context.runTmuxStdin(['load-buffer', '-b', 'test', '-', ';',
      'list-sessions', '-F', `#{session_name}${delimiter}#{session_windows}`], 'payload');
    expect(output.replaceAll('\\037', delimiter)).toContain(`task${delimiter}1`);
    expect(await run(['list-clients', '-F', '#{client_pid}'])).toBe('');
    expect(f.persist).not.toHaveBeenCalled();
    await run(['kill-session', '-t', '=task']);
    await f.context.reconcileClientState();
    expect(f.context.globalSessionState.sessions).toEqual([]);
    expect(f.persist).toHaveBeenCalledOnce();
  } finally {
    await run(['kill-server']).catch(() => {});
  }
}, 15000);
