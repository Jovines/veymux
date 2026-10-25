// @vitest-environment node
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import vm from 'node:vm';
import ts from 'typescript';
import express from 'express';
import { afterEach, expect, it, vi } from 'vitest';
import { agentBySlug, clearPluginAgents, detectAgentFromCommand, registerPluginAgents } from '../agent/registry';
import type { LoadedPlugin } from '../agent/plugins';
import { SessionViewModeStore, sessionViewModeRoutes } from '../agent/sessionViewModeRoutes';
import { markEncryptedRequest } from '../federation/requestContext';
import { chatProgramName, type ChatEligibility } from '../shared/chatProgramPolicy';

// Exercise the production eligibility callback without starting the terminal
// router or touching the developer's persisted sessions/plugin installation.
const source = readFileSync(new URL('./terminal.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('terminal.ts', source, ts.ScriptTarget.Latest, true);
const call = ast.statements.flatMap(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) ? [node.expression] : [])
  .flatMap(node => [...node.arguments]).find(node => ts.isCallExpression(node) && node.expression.getText(ast) === 'sessionViewModeRoutes') as ts.CallExpression;
const clean: (() => void)[] = [];
afterEach(() => { clean.splice(0).reverse().forEach(fn => fn()); clearPluginAgents(); });

async function fixture() {
  registerPluginAgents([{
    manifest: { slug: 'customagent-fixture', displayName: 'CustomAgent', aliases: ['customagent', 'customagent-cli'] }, iconPath: null,
  } as LoadedPlugin]);
  const record = { sessionId: 'stable', mode: 'tmux', tmuxSessionName: 'external', backendSessionId: null as string | null };
  const live = vi.fn().mockResolvedValue({ rawArgs: '/opt/bin/customagent --model fast', foregroundProgram: 'customagent' });
  const repair = vi.fn(() => { throw new Error('collaboration binding cannot be persisted'); });
  const backends = new Map();
  const context = vm.createContext({ globalSessionState: { sessions: [record] }, terminalSessions: backends,
    resolveOrchestrationBackend: repair, resolveLiveTmuxMetadata: live, chatProgramName,
    detectAgentFromCommand, agentCustomCommands: () => ({}), chatProgramNames: new Set() });
  vm.runInContext(ts.transpileModule(`globalThis.eligibility = ${call.arguments[2].getText(ast)}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  const dir = mkdtempSync(join(tmpdir(), 'td-plugin-chat-')); clean.push(() => rmSync(dir, { recursive: true, force: true }));
  const app = express();
  app.use((req, _res, next) => { if (req.headers['test-owner']) markEncryptedRequest(req, 'owner'); next(); });
  app.use(sessionViewModeRoutes(new SessionViewModeStore(join(dir, 'modes.json')), id => id === 'stable' ? id : null,
    context.eligibility as (id: string, command?: string) => Promise<ChatEligibility>));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  clean.push(() => { server.closeAllConnections(); server.close(); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error();
  const url = `http://127.0.0.1:${address.port}/stable/view-mode?chatEligibility=1`;
  const read = async () => {
    const response = await fetch(url, { headers: { 'test-owner': '1' } });
    expect(response.status).toBe(200); return (await response.json()).chatEligibility;
  };
  return { record, live, repair, backends, read, url };
}

it('recognizes an external plugin without a backend or collaboration binding writes', async () => {
  const f = await fixture();
  expect(await f.read()).toMatchObject({ allowed: true, program: 'customagent', agent: { slug: 'customagent-fixture', displayName: 'CustomAgent' } });
  expect(f.live).toHaveBeenCalledWith('external', false, true);
  expect(f.repair).not.toHaveBeenCalled();
  expect((await fetch(f.url)).status).toBe(404);
});

it('uses the live plugin alias when ps cannot expose argv, and never an old backend identity', async () => {
  const f = await fixture();
  f.record.backendSessionId = 'old';
  f.backends.set('old', { activeProgram: { rawArgs: 'codex', command: 'codex' } });
  f.live.mockResolvedValue({ rawArgs: null, foregroundProgram: 'customagent-cli' });
  expect(await f.read()).toMatchObject({ allowed: true, program: 'customagent-cli', agent: { slug: 'customagent-fixture' } });
  f.live.mockResolvedValue({ rawArgs: null, foregroundProgram: 'zsh' });
  expect(await f.read()).toEqual({ allowed: false, program: null });
  f.live.mockResolvedValue(null);
  expect(await f.read()).toEqual({ allowed: false, program: null });
});

it('recognizes shell-mode plugin processes through the existing backend without binding repair', async () => {
  const f = await fixture(); f.record.mode = 'shell'; f.record.backendSessionId = 'backend';
  f.backends.set('backend', { activeProgram: { rawArgs: 'customagent-cli --fast' } });
  expect(await f.read()).toMatchObject({ allowed: true, agent: { slug: agentBySlug('customagent-fixture')!.slug } });
  expect(f.live).not.toHaveBeenCalled(); expect(f.repair).not.toHaveBeenCalled();
});

it('keeps a failed live probe closed and returns a diagnostic code', async () => {
  const f = await fixture(); f.live.mockRejectedValue(new Error('tmux unavailable'));
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); clean.push(() => warn.mockRestore());
  const response = await fetch(f.url, { headers: { 'test-owner': '1' } });
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: 'CHAT_PROGRAM_UNAVAILABLE' });
  expect(warn).toHaveBeenCalled();
});
