// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { afterEach, expect, it, vi } from 'vitest';
import { SessionSearchStore } from '../agent/sessionSearchStore.js';
import { AgentResumeHistoryStore } from '../agent/resumeHistory.js';
import { normalizePersistedAgentResumeInfo } from '../agent/resumePersistence.js';
import { getSessionPresentation } from '../utils/sessionDisplayName.js';

const source = fs.readFileSync(new URL('./terminal.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('terminal.ts', source, ts.ScriptTarget.Latest, true);
const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'veymux-search-routes-')); directories.push(directory);
  const search = new SessionSearchStore(path.join(directory, 'search'));
  const history = new AgentResumeHistoryStore(path.join(directory, 'history.json'));
  const routes = new Map<string, (...args: any[]) => Promise<unknown>>();
  const state = { sessions: [] as any[] };
  const native = { search: vi.fn(async (_query: string, _limit: number, _titles: unknown) => ({ results: [], matchedSessions: [], total: 0, index: {} })), get: vi.fn() };
  const deps = { Date, console, AbortController, globalSessionState: state, terminalSessions: new Map(),
    sessionSearchStore: search, agentResumeHistory: history, nativeSessionSearch: native, normalizePersistedAgentResumeInfo,
    getSessionPresentation, shellNamesBackend: new Set(['bash', 'zsh']),
    router: { get: (url: string, fn: any) => routes.set(`get:${url}`, fn), post: (url: string, fn: any) => routes.set(`post:${url}`, fn) },
    resolveWorkingDirectory: vi.fn(async (_req, cwd) => cwd), tmuxSessionExists: vi.fn(async (_target: string) => false),
    agentBySlug: vi.fn(slug => ({ slug, command: slug })), buildResumeCommand: vi.fn((_agent, id) => `codex resume ${id}`),
    findActiveAgentResumeOwner: vi.fn(() => null), findExternalCodexWriter: vi.fn(async () => false), getErrorMessage: String };
  const context = vm.createContext(deps);
  const functions = ast.statements.filter(n => ts.isFunctionDeclaration(n) && ['searchMetadataForRecord', 'archiveAgentResumeRecord'].includes(n.name?.text ?? ''));
  const handlers = ast.statements.filter(n => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression)
    && ['router.get', 'router.post'].includes(n.expression.expression.getText(ast))
    && ["'/operations/session-search'", "'/operations/session-search/prepare'"].includes(n.expression.arguments[0]?.getText(ast)));
  vm.runInContext(ts.transpileModule([...functions, ...handlers].map(n => n.getText(ast)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText, context);
  const response = () => ({ writableEnded: false, status: vi.fn().mockReturnThis(), json: vi.fn(), once: vi.fn(), off: vi.fn() });
  return { search, history, routes, state, native, deps, context, response };
}
const record = { sessionId: 'closed', backendSessionId: null, name: '恢复历史搜索体验', customName: true,
  mode: 'tmux', tmuxSessionName: 'wt-history', cwd: '/work', lastActivity: 10,
  agentResume: { slug: 'codex', sessionId: 'native-history', launchArgv: ['codex'], updatedAt: 1 } };

it('archives a tmux name and native recovery identity even with no terminal output', async () => {
  const f = fixture();
  expect(f.context.archiveAgentResumeRecord(record, 'closed')).toBe(true);
  expect(f.history.list()[0]).toMatchObject({ title: record.name, agent: { sessionId: 'native-history' } });
  const res = f.response();
  await f.routes.get('get:/operations/session-search')!({ query: { q: '恢复历史' } }, res);
  expect(res.json.mock.calls[0][0]).toMatchObject({ total: 1, results: [{ title: record.name, live: false, terminalSessionId: 'closed' }] });
});
it('includes saved conversations whose terminal index and native transcript are absent', async () => {
  const f = fixture(); f.history.archive({ title: record.name, titleSource: 'custom', agent: record.agentResume, cwd: '/work', reason: 'closed' });
  const res = f.response(); await f.routes.get('get:/operations/session-search')!({ query: { q: '恢复历史' } }, res);
  expect(res.json.mock.calls[0][0].results[0]).toMatchObject({ title: record.name, live: false, resumeHistoryId: expect.any(String) });
});
it('uses live renamed presentation as an alias without waiting for new output', async () => {
  const f = fixture(); f.state.sessions.push(record);
  const res = f.response(); await f.routes.get('get:/operations/session-search')!({ query: { q: record.name } }, res);
  expect(f.native.search.mock.calls[0]?.[2]).toEqual(expect.arrayContaining([expect.objectContaining({ title: record.name })]));
  expect(res.json.mock.calls[0][0].results[0]).toMatchObject({ title: record.name, live: true });
});
it('reattaches an existing closed tmux without starting its Agent twice', async () => {
  const f = fixture(); f.context.archiveAgentResumeRecord(record, 'closed'); f.deps.tmuxSessionExists.mockResolvedValue(true);
  const res = f.response(); await f.routes.get('post:/operations/session-search/prepare')!({ body: { terminalSessionId: 'closed', cwd: '/untrusted', command: 'malicious' } }, res);
  expect(res.json).toHaveBeenCalledWith({ mode: 'tmux', tmuxSessionName: 'wt-history', cwd: '/work', title: record.name });
  expect(f.deps.buildResumeCommand).not.toHaveBeenCalled();
});
it('resumes the original Agent after tmux is gone and blocks an external writer', async () => {
  const f = fixture(); f.context.archiveAgentResumeRecord(record, 'closed');
  const req = { body: { terminalSessionId: 'closed' } }, res = f.response();
  await f.routes.get('post:/operations/session-search/prepare')!(req, res);
  expect(res.json.mock.calls[0][0]).toMatchObject({ command: 'codex resume native-history', cwd: '/work' });
  f.deps.findExternalCodexWriter.mockResolvedValue(true);
  const blocked = f.response(); await f.routes.get('post:/operations/session-search/prepare')!(req, blocked);
  expect(blocked.status).toHaveBeenCalledWith(409);
});
it('reopens plain terminal directories and reports deleted directories or missing records', async () => {
  const f = fixture(); f.context.archiveAgentResumeRecord({ ...record, agentResume: null }, 'closed');
  const req = { body: { terminalSessionId: 'closed' } }, res = f.response();
  await f.routes.get('post:/operations/session-search/prepare')!(req, res);
  expect(res.json).toHaveBeenCalledWith({ cwd: '/work', title: record.name });
  f.deps.resolveWorkingDirectory.mockRejectedValue(new Error('directory does not exist'));
  const missing = f.response(); await f.routes.get('post:/operations/session-search/prepare')!(req, missing);
  expect(missing.status).toHaveBeenCalledWith(400);
  const unknown = f.response(); await f.routes.get('post:/operations/session-search/prepare')!({ body: { terminalSessionId: 'unknown' } }, unknown);
  expect(unknown.status).toHaveBeenCalledWith(404);
});

it('recovers the same real tmux process and its retained output after close and store reload', async () => {
  const f = fixture(), socket = path.join(directories.at(-1)!, 'tmux.sock');
  const tmux = (...args: string[]) => execFileSync('tmux', ['-S', socket, ...args], { encoding: 'utf8' });
  try {
    tmux('new-session', '-d', '-s', 'wt-history', '-c', directories.at(-1)!, 'printf "retained-history-marker\\n"; exec /bin/sh');
    const panePid = tmux('display-message', '-p', '-t', '=wt-history', '#{pane_pid}').trim();
    f.context.archiveAgentResumeRecord(record, 'closed');
    const reloaded = new SessionSearchStore(path.join(directories.at(-1)!, 'search'));
    expect(reloaded.search(record.name)[0]?.title).toBe(record.name);
    f.deps.tmuxSessionExists.mockImplementation(async target => {
      try { tmux('has-session', '-t', target); return true; } catch { return false; }
    });
    const res = f.response();
    await f.routes.get('post:/operations/session-search/prepare')!({ body: { terminalSessionId: 'closed' } }, res);
    const prepared = res.json.mock.calls[0][0];
    expect(prepared.mode).toBe('tmux');
    expect(tmux('display-message', '-p', '-t', `=${prepared.tmuxSessionName}`, '#{pane_pid}').trim()).toBe(panePid);
    const paneId = tmux('display-message', '-p', '-t', `=${prepared.tmuxSessionName}`, '#{pane_id}').trim();
    await expect.poll(() => tmux('capture-pane', '-p', '-t', paneId)).toContain('retained-history-marker');
    expect(f.deps.buildResumeCommand).not.toHaveBeenCalled();
  } finally { try { tmux('kill-server'); } catch { /* already exited */ } }
});

it('deduplicates a reopened tmux and opens its current inventory identity', async () => {
  const f = fixture(); f.context.archiveAgentResumeRecord({ ...record, agentResume: null }, 'closed');
  f.context.archiveAgentResumeRecord({ ...record, sessionId: 'reopened', agentResume: null }, 'closed');
  const res = f.response(); await f.routes.get('get:/operations/session-search')!({ query: { q: record.name } }, res);
  expect(res.json.mock.calls[0][0].results).toHaveLength(1);
  f.state.sessions.push({ ...record, sessionId: 'live-again', agentResume: null });
  const live = f.response(); await f.routes.get('get:/operations/session-search')!({ query: { q: record.name } }, live);
  expect(live.json.mock.calls[0][0]).toMatchObject({ total: 1, results: [{ sessionId: 'live-again', title: record.name, live: true }] });
});
