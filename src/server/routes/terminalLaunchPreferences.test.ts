// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { afterEach, expect, it, vi } from 'vitest';
import { AutomationStore } from '../agent/automationStore.js';

const source = fs.readFileSync(new URL('./terminal.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('terminal.ts', source, ts.ScriptTarget.Latest, true);
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'td-launch-preferences-'));
  directories.push(directory);
  const filePath = path.join(directory, 'automations.json');
  const automationStore = new AutomationStore(filePath);
  const routes = new Map<string, (...args: any[]) => Promise<any>>();
  const state = { sessions: [] as any[] };
  const terminals = new Map();
  const entry = { sessionId: 'archived', title: 'Original title', cwd: directory, agent: { slug: 'codex', sessionId: 'original-native' },
    groups: [], workspace: {}, cleanup: {}, restoredAt: null as number | null };
  const open = vi.fn(async (_req, input) => {
    const session = { sessionId: input.preferredFrontendSessionId ?? 'new', backendSessionId: 'backend', mode: input.mode, cwd: input.cwd };
    state.sessions.push(session); terminals.set('backend', {});
    return { session, terminalSession: { sessionId: 'backend' } };
  });
  class HttpStatusError extends Error {
    constructor(public status: number, message: string, public code: string) { super(message); }
  }
  const deps = {
    Date, Math, console, os, automationStore, globalSessionState: state, terminalSessions: terminals,
    router: { post: (url: string, handler: any) => routes.set(url, handler) },
    executionArchiveAction: (handler: any) => handler,
    normalizeAutomationSchedule: (schedule: unknown) => schedule,
    resolveWorkingDirectory: vi.fn(async (_req, cwd) => cwd),
    openInventorySession: open, getErrorMessage: String, detectAgentFromCommand: () => null, agentCustomCommands: () => [],
    writeAutomaticTerminalPrompt: vi.fn(), deliverAutomationPromptWhenReady: vi.fn(),
    executionArchives: { get: () => entry, save: vi.fn() },
    agentBySlug: () => ({ slug: 'codex' }), buildResumeCommand: () => 'codex resume original-native',
    findActiveAgentResumeOwner: () => null, findExternalCodexWriter: async () => false,
    restoreTaskWorkspace: vi.fn(), pathValidator: { allowSessionCwd: vi.fn() },
    upsertGlobalSessionRecord: vi.fn(), beginAgentLaunchCheck: vi.fn(), restoreArchivedMembership: vi.fn(),
    persistGlobalStateNow: vi.fn(), broadcastClientState: vi.fn(), orchestrationSessionSnapshot: (session: unknown) => session,
    getTmuxStatus: vi.fn(async () => ({ available: false })), HttpStatusError,
  };
  const context = vm.createContext(deps);
  const names = ['normalizeMode', 'runAgentAutomation', 'spawnTerminalSessionUnlocked'];
  const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? ''));
  const handlers = ast.statements.filter(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(ast) === 'router.post'
    && ["'/operations/automations'", "'/operations/execution-archives/:sessionId/restore'"].includes(node.expression.arguments[0]?.getText(ast)));
  vm.runInContext(ts.transpileModule([...functions, ...handlers].map(node => node.getText(ast)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText, context);
  const response = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn() });
  return { context, routes, automationStore, filePath, open, state, entry, deps, response };
}

it.each(['shell', 'tmux'] as const)('runs persisted %s automations identically by schedule and by manual request', async mode => {
  const f = fixture(), res = f.response();
  await f.routes.get('/operations/automations')!({ body: { name: 'Review', cwd: '/work', command: 'codex', mode,
    schedule: { kind: 'interval', everyMinutes: 60 } } }, res);
  const saved = new AutomationStore(f.filePath).list()[0];
  expect(saved.mode).toBe(mode);
  await f.context.runAgentAutomation(saved);
  await f.context.runAgentAutomation(saved, { body: {} });
  expect(f.open.mock.calls.map(call => call[1].mode)).toEqual([mode, mode]);
  expect(f.automationStore.listRuns(saved.id).every(run => run.status === 'success')).toBe(true);
});

it('preserves the backend when an older automation client edits without a mode', async () => {
  const f = fixture(), res = f.response();
  const body = { name: 'Review', cwd: '/work', command: 'codex', schedule: { kind: 'interval', everyMinutes: 60 } };
  await f.routes.get('/operations/automations')!({ body: { ...body, mode: 'tmux' } }, res);
  const saved = res.json.mock.calls[0][0].automation;
  await f.routes.get('/operations/automations')!({ body: { ...body, id: saved.id } }, f.response());
  expect(f.automationStore.get(saved.id)?.mode).toBe('tmux');
});

it.each(['shell', 'tmux', undefined])('restores a closed execution using requested backend %s', async mode => {
  const f = fixture();
  const restored = await f.routes.get('/operations/execution-archives/:sessionId/restore')!({ params: { sessionId: 'archived' }, body: { mode } });
  expect(f.open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ mode: mode ?? 'tmux', preferredFrontendSessionId: 'archived' }));
  expect(restored.session.mode).toBe(mode ?? 'tmux');
  expect(f.deps.writeAutomaticTerminalPrompt).toHaveBeenCalledWith('archived', 'codex resume original-native', undefined, undefined);
});

it('reuses the existing restored process when the current preference changes', async () => {
  const f = fixture();
  f.entry.restoredAt = 1;
  f.state.sessions.push({ sessionId: 'archived', mode: 'tmux' });
  const result = await f.routes.get('/operations/execution-archives/:sessionId/restore')!({ params: { sessionId: 'archived' }, body: { mode: 'shell' } });
  expect(result.session.mode).toBe('tmux');
  expect(f.open).not.toHaveBeenCalled();
  expect(f.deps.writeAutomaticTerminalPrompt).not.toHaveBeenCalled();
});

it('rejects invalid backend choices before modifying an archive or saving an automation', async () => {
  const f = fixture(), res = f.response();
  await f.routes.get('/operations/automations')!({ body: { mode: 'invalid' } }, res);
  expect(res.status).toHaveBeenCalledWith(400);
  await expect(f.routes.get('/operations/execution-archives/:sessionId/restore')!({ body: { mode: 'invalid' } })).rejects.toThrow('无效的终端类型');
  expect(f.deps.restoreTaskWorkspace).not.toHaveBeenCalled();
  expect(f.open).not.toHaveBeenCalled();
});

it.each([false, true])('refuses unavailable tmux instead of silently creating Shell (reattach=%s)', async attachExistingOnly => {
  const f = fixture();
  await expect(f.context.spawnTerminalSessionUnlocked({}, { mode: 'tmux', cwd: '/work', attachExistingOnly })).rejects.toThrow(/tmux|TMUX/);
  expect(f.deps.getTmuxStatus).toHaveBeenCalledOnce();
});
