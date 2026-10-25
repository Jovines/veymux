// @vitest-environment node
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';

const source = fs.readFileSync(new URL('./terminal.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('terminal.ts', source, ts.ScriptTarget.Latest, true);
const names = new Set(['getSessionInventorySnapshot', 'openInventorySession', 'getClientSessionView']);
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text ?? ''))
  .map(node => node.getText(ast)).join('\n');

it.each([false, true])('waits for a current directory after an older shared scan, without creating twice (reopen=%s)', async reopen => {
  const state = { sessions: reopen ? [{ sessionId: 'frontend', backendSessionId: 'old-backend', mode: 'shell' }] : [] };
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const build = vi.fn(async () => {
    // Capture exactly what a scan started before the mutation could observe.
    const clientSessions = state.sessions.map(session => ({ ...session }));
    if (build.mock.calls.length === 1) await gate;
    return { clientSessions, updatedAt: Date.now() };
  });
  const ensure = vi.fn(async (_req, record) => {
    record.backendSessionId = 'new-backend';
    return { backendSessionId: 'new-backend', session: {}, cols: 80, rows: 24 };
  });
  const context = vm.createContext({
    Date, console, globalSessionState: state, buildSessionInventory: build,
    normalizeMode: () => 'shell', generateFrontendSessionId: () => 'frontend',
    ensureBackendSessionForRecord: ensure, persistAndBroadcastGlobalState: vi.fn(),
    upsertGlobalSessionRecord: (record: typeof state.sessions[number]) => { state.sessions = [record]; return record; },
    makeTerminalSessionPayload: (sessionId: string) => ({ sessionId }),
  });
  vm.runInContext(ts.transpileModule(`
    let sessionInventoryBuildPromise = null, latestSessionInventory = null, latestSessionInventoryAt = 0;
    const SESSION_INVENTORY_CACHE_TTL_MS = 1500;
    ${functions}
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const previousScan = context.getSessionInventorySnapshot({ refresh: true });
  const opened = context.openInventorySession({}, { preferredFrontendSessionId: reopen ? 'frontend' : undefined, cwd: '/work' });
  await vi.waitFor(() => expect(ensure).toHaveBeenCalledOnce());
  release();
  await previousScan;
  const result = await opened;
  expect(result.session).toMatchObject({ sessionId: 'frontend', backendSessionId: 'new-backend' });
  expect(result.terminalSession.sessionId).toBe('new-backend');
  expect(result.reused).toBe(reopen);
  expect(build).toHaveBeenCalledTimes(2);
  expect(ensure).toHaveBeenCalledOnce();
});
