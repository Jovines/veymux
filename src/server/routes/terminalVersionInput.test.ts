// @vitest-environment node
import fs from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { serializeTerminalInput } from '../agent/terminalInput.js';
import { TerminalInputQueue } from '../utils/terminalInputQueue.js';
import { TerminalPasteBuffer } from '../utils/terminalPasteBuffer.js';
import { TerminalOutputDelivery, resolveTerminalReplayCursor } from '../utils/terminalOutputDelivery.js';
import { filterTerminalVersionReplies, TERMINAL_VERSION_REPLY, TerminalVersionReplies } from '../utils/terminalVersionReplies.js';
import { PtySpawnDeferredError } from '../utils/ptySpawnBackoff.js';

// Exercise the production entry points without booting persistent user state.
const source = fs.readFileSync(new URL('./terminal.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('terminal.ts', source, ts.ScriptTarget.Latest, true);
const declarations = ['setupPtyHandlers', 'handleTerminalWebSocket'].map(name => ast.statements.find(node =>
  ts.isFunctionDeclaration(node) && node.name?.text === name)!.getText(ast).replace(/^export /, ''));
const httpRoute = ast.statements.find(node => ts.isExpressionStatement(node)
  && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === 'router.post'
  && node.expression.arguments[0]?.getText(ast) === "'/:sessionId/input'")!.getText(ast);
const version = '\x1bP>|xterm.js(6.1.0-beta.315)\x1b\\';

function fixture(mode: 'tmux' | 'shell') {
  let output!: (data: string) => void;
  let httpInput!: (req: unknown, res: unknown) => Promise<void>;
  const write = vi.fn();
  const session = { mode, tmuxSessionName: 'probe', cols: 80, rows: 24, paneOutputObserver: {},
    ptyProcess: { write, onData: (handler: typeof output) => { output = handler; }, onExit: () => ({ dispose() {} }) } };
  const context = vm.createContext({
    Date, Buffer, performance, setTimeout, clearTimeout, console,
    TerminalVersionReplies, filterTerminalVersionReplies, TerminalInputQueue, TerminalPasteBuffer,
    TerminalOutputDelivery, resolveTerminalReplayCursor, serializeTerminalInput, PtySpawnDeferredError,
    router: { post: (_path: string, _parser: unknown, handler: typeof httpInput) => { httpInput = handler; } },
    express: { text: () => null }, shuttingDown: false,
    terminalSessions: new Map([['backend', session]]), globalSessionState: { sessions: [] },
    wsClients: new Map(), tmuxAttachments: new WeakMap(), outputDeliveries: new WeakMap(),
    TERMINAL_STREAM_EPOCH: 'test', processSessionOutput() {},
    getCachedTmuxLayout: async () => null, getCachedShellActiveProgram: async () => null,
    getActiveProgramFromTmuxLayout: () => null, getPersistedActiveProgramForBackend: () => null,
    getRestoreHistory: async () => ['restored'], getReconnectionHistory: () => ['restored'],
    getHistoryLastSeq: () => 0,
    subscribeTerminalSampling: () => () => {}, getErrorMessage: String,
    syncClientCountToTmux() {}, updateGlobalBindingForBackendSession: () => false,
    removeClientFocus() {}, removeClientFlowPaused() {}, broadcastClientState() {},
    enqueueTmuxIo: (_session: unknown, operation: () => unknown) => operation(),
  });
  vm.runInContext(ts.transpileModule([...declarations, httpRoute].join('\n'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { write, session, context, output: (data: string) => output(data), http: async (data: string) => {
    const response = { json: vi.fn(), status: vi.fn().mockReturnThis() };
    await httpInput({ params: { sessionId: 'backend' }, body: data }, response);
    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith({ success: true });
  } };
}

class Socket extends EventEmitter {
  OPEN = 1;
  readyState = 1;
  send = vi.fn();
  close() { this.readyState = 3; this.emit('close'); }
  async input(data: string) { await this.listeners('message')[0](JSON.stringify({ type: 'input', data })); }
}

it('answers the shared tmux observer locally before broadcasting its query', () => {
  const probe = fixture('tmux');
  probe.context.setupPtyHandlers('backend', probe.session);
  probe.output('\x1b[>'); probe.output('q');
  expect(probe.write.mock.calls).toEqual([[TERMINAL_VERSION_REPLY]]);
});

it.each(['tmux', 'shell'] as const)('protects %s HTTP input while preserving literal paste and keys', async mode => {
  const probe = fixture(mode);
  await probe.http(version + version);
  await probe.http('typed');
  await probe.http('\x1b[200~' + version + '\x1b[201~');
  await probe.http('\x1b[1;2R');
  expect(probe.write.mock.calls.map(([data]) => data)).toEqual([
    ...(mode === 'shell' ? [version + version] : []), 'typed', '\x1b[200~' + version + '\x1b[201~', '\x1b[1;2R',
  ]);
});

it.each(['tmux', 'shell'] as const)('protects %s legacy WebSockets across multiple observers and reconnect', async mode => {
  const probe = fixture(mode);
  const sockets = [new Socket(), new Socket()];
  try {
    for (const [index, socket] of sockets.entries()) {
      probe.context.handleTerminalWebSocket(socket, 'backend', `client-${index}`);
      await vi.waitFor(() => expect(socket.send.mock.calls.some(([frame]) => JSON.parse(frame).type === 'connected')).toBe(true));
      await socket.input(version);
    }
    sockets[0].close();
    const reopened = new Socket(); sockets.push(reopened);
    probe.context.handleTerminalWebSocket(reopened, 'backend', 'client-0');
    await reopened.input(version + version);
    await reopened.input('sentinel');
    await vi.waitFor(() => expect(probe.write).toHaveBeenCalledWith('sentinel'));
    expect(probe.write.mock.calls.map(([data]) => data)).toEqual(mode === 'tmux'
      ? ['sentinel'] : [version, version, version + version, 'sentinel']);
  } finally { sockets.forEach(socket => socket.close()); }
});
