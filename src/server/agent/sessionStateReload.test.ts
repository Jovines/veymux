// @vitest-environment node
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { createSessionStatePersistence } from './sessionLaunchState.js';

// Exercise the route's real read/commit boundary without importing the router
// and its live service, watchers, or user-owned session store.
const source = fs.readFileSync(new URL('../routes/terminal.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('terminal.ts', source, ts.ScriptTarget.Latest, true);
const loader = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'loadGlobalSessionStateFromDisk')!;
const persistence = ast.statements.find(node => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(declaration => declaration.name.getText(ast) === 'globalSessionStatePersistence'))!;
function install(context: vm.Context) {
  vm.runInContext(ts.transpileModule(`${persistence.getText(ast)}\n${loader.getText(ast)}`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
}
it('does not clear a live launch token when a real loader await receives an old disk snapshot', async () => {
  const old = { sessionId: 'role', backendSessionId: 'backend', agentLaunchGeneration: null, agentLaunchCheck: null };
  let finish!: (value: unknown) => void;
  const diskRead = new Promise(resolve => { finish = resolve; });
  const read = vi.fn().mockResolvedValueOnce({ sessions: [old], updatedAt: 1 }).mockImplementation(() => diskRead);
  const context = vm.createContext({ structuredClone, createSessionStatePersistence,
    console: { log: vi.fn(), warn: vi.fn() }, getErrorMessage: String,
    GLOBAL_SESSION_STATE_FILE: 'isolated-fixture', globalSessionState: { sessions: [old], updatedAt: 1 },
    readJsonFileIfExists: read, deduplicateGlobalSessions: (items: unknown) => items,
    normalizePersistedClientSession: (item: unknown) => item, migrateFromClientStatesFile: vi.fn(), schedulePersistGlobalState: vi.fn() });
  install(context);
  await context.loadGlobalSessionStateFromDisk();
  const pending = vm.runInContext('loadGlobalSessionStateFromDisk(true)', context) as Promise<void>;
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  const live = { ...old, agentLaunchGeneration: 'new-launch', agentLaunchCheck: { id: 'new-launch' } };
  context.globalSessionState = { sessions: [live], updatedAt: 2 };
  finish({ sessions: [old], updatedAt: 1 }); await pending;
  expect(context.globalSessionState.sessions).toMatchObject([{ backendSessionId: 'backend', agentLaunchGeneration: 'new-launch', agentLaunchCheck: { id: 'new-launch' } }]);
});

it('keeps a session created before a watcher reads the previous disk snapshot', async () => {
  const existing = { sessionId: 'existing', backendSessionId: 'backend' };
  const created = { sessionId: 'created', backendSessionId: 'new-backend' };
  const context = vm.createContext({ structuredClone, createSessionStatePersistence,
    console: { log: vi.fn(), warn: vi.fn() }, getErrorMessage: String,
    GLOBAL_SESSION_STATE_FILE: 'isolated-fixture', globalSessionState: { sessions: [], updatedAt: 0 },
    readJsonFileIfExists: async () => ({ sessions: [existing], updatedAt: 1 }),
    deduplicateGlobalSessions: (items: unknown) => items, normalizePersistedClientSession: (item: unknown) => item,
    migrateFromClientStatesFile: vi.fn(), schedulePersistGlobalState: vi.fn() });
  install(context);
  await context.loadGlobalSessionStateFromDisk();
  context.globalSessionState = { sessions: [existing, created], updatedAt: 2 };
  await context.loadGlobalSessionStateFromDisk(true);
  expect(context.globalSessionState.sessions).toMatchObject([existing, created]);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

it('queues a watcher behind an in-flight write and preserves changes made while writing', async () => {
  const existing = { sessionId: 'existing', backendSessionId: 'backend' };
  const created = { sessionId: 'created', backendSessionId: 'new-backend' };
  let current = { sessions: [existing], updatedAt: 1 };
  let disk = structuredClone(current);
  const gate = deferred<void>();
  const read = vi.fn(async () => structuredClone(disk));
  const write = vi.fn(async snapshot => { await gate.promise; disk = snapshot; });
  const store = createSessionStatePersistence(() => current, read, write, state => { current = state; });
  await store.load(false);
  const pendingWrite = store.write();
  await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
  current = { sessions: [existing, created], updatedAt: 2 };
  const reload = store.load();
  expect(read).toHaveBeenCalledOnce();
  gate.resolve();
  await Promise.all([pendingWrite, reload]);
  expect(current.sessions).toMatchObject([existing, created]);
  await store.write();
  expect(disk.sessions).toMatchObject([existing, created]);
});

it('does not resurrect locally closed sessions on repeated old watcher snapshots', async () => {
  const record = { sessionId: 'closed', backendSessionId: 'backend' };
  let current = { sessions: [record] };
  const store = createSessionStatePersistence(() => current, async () => ({ sessions: [record] }),
    vi.fn(), state => { current = state; });
  await store.load(false);
  current = { sessions: [] };
  await store.load();
  await store.load();
  expect(current.sessions).toEqual([]);
});

it('accepts external renames and deletions of unchanged, already persisted records', async () => {
  const record = { sessionId: 'existing', backendSessionId: 'backend', name: 'old' };
  let current = { sessions: [record] };
  let disk = structuredClone(current);
  const store = createSessionStatePersistence(() => current, async () => structuredClone(disk),
    vi.fn(), state => { current = state; });
  await store.load(false);
  disk.sessions[0].name = 'renamed externally';
  await store.load();
  expect(current.sessions[0].name).toBe('renamed externally');
  disk = { sessions: [] };
  await store.load();
  expect(current.sessions).toEqual([]);
});

it('keeps unpersisted changes after failed I/O and allows the queue to recover', async () => {
  const created = { sessionId: 'created', backendSessionId: 'backend' };
  let current = { sessions: [] as typeof created[] };
  let disk = structuredClone(current);
  const read = vi.fn(async () => structuredClone(disk));
  const write = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockImplementation(async snapshot => { disk = snapshot; });
  const store = createSessionStatePersistence(() => current, read, write, state => { current = state; });
  await store.load(false);
  current = { sessions: [created] };
  await expect(store.write()).rejects.toThrow('disk full');
  await store.load();
  expect(current.sessions).toEqual([created]);
  read.mockRejectedValueOnce(new Error('read failed'));
  await expect(store.load()).rejects.toThrow('read failed');
  await store.write();
  await store.load();
  expect(disk.sessions).toMatchObject([created]);
  expect(current.sessions).toMatchObject([created]);
});
