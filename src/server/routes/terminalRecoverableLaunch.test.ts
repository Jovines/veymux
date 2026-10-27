// @vitest-environment node
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { mergeSessionLaunchState } from '../agent/sessionLaunchState';
import { replayAgentLaunchAttempt } from '../agent/agentLaunchAttempt';
import { codexColdLaunchArgv, codexPreparedResumeCommand } from '../shared/codexLaunchCommand';
const source = fs.readFileSync(new URL('./terminal.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('terminal.ts', source, ts.ScriptTarget.Latest, true);
const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'writeAutomaticTerminalPrompt')!.getText(ast);
function fixture() {
  const state: any = { sessions: [{ sessionId: 'frontend', backendSessionId: 'backend', cwd: '/work', agentLaunchGeneration: 'generation',
    agentLaunchCheck: { id: 'generation', agentSlug: 'codex', nativeSessionId: null, deadline: Date.now() + 120000 } }] };
  const persisted: any[] = [], prepare = vi.fn(async () => ({ sessionId: 'original-native-thread', launchArgv: ['codex'] }));
  const write = vi.fn(async () => {
    expect(persisted.at(-1)).toMatchObject({ agentResume: { sessionId: 'original-native-thread' },
      agentLaunchCheck: { nativeSessionId: 'original-native-thread' }, agentLaunchAttempt: { state: 'unconfirmed' } });
  });
  const context = vm.createContext({ Date, createHash, codexColdLaunchArgv, codexPreparedResumeCommand, replayAgentLaunchAttempt,
    globalSessionState: state, prepareCodexThread: prepare, terminalInputGuard: () => vi.fn(), os: { homedir: () => '/home/test' },
    upsertGlobalSessionRecord: (candidate: any, change: any) => { state.sessions[0] = mergeSessionLaunchState(candidate, state.sessions[0], change); },
    persistGlobalStateNow: vi.fn(async () => { persisted.push(structuredClone(state.sessions[0])); }),
    automaticTerminalInput: async () => write,
  });
  vm.runInContext(ts.transpileModule(fn, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { state, prepare, write, context, persisted };
}
it('persists UUID and request outcome fencing before writing resume, then replays the acknowledgement only', async () => {
  const f = fixture(), guard = vi.fn();
  await f.context.writeAutomaticTerminalPrompt('frontend', 'codex', undefined, guard, 'request-1');
  expect(f.write).toHaveBeenCalledWith("'codex' 'resume' 'original-native-thread'");
  expect(f.state.sessions[0].agentLaunchAttempt.state).toBe('submitted');
  await f.context.writeAutomaticTerminalPrompt('frontend', 'codex', undefined, guard, 'request-1');
  expect(f.write).toHaveBeenCalledOnce(); expect(f.prepare).toHaveBeenCalledOnce();
});
it('never writes a cold launch when conversation preparation fails', async () => {
  const f = fixture(); f.prepare.mockRejectedValueOnce(new Error('unavailable'));
  await expect(f.context.writeAutomaticTerminalPrompt('frontend', 'codex', undefined, vi.fn(), 'request-1')).rejects.toThrow('unavailable');
  expect(f.write).not.toHaveBeenCalled(); expect(f.state.sessions[0].agentLaunchAttempt.state).toBe('failed');
});
it('retains an uncertain write and refuses to repeat it after a lost acknowledgement', async () => {
  const f = fixture(); f.write.mockRejectedValueOnce(new Error('write outcome unknown'));
  await expect(f.context.writeAutomaticTerminalPrompt('frontend', 'codex', undefined, vi.fn(), 'request-1')).rejects.toThrow('write outcome unknown');
  expect(f.state.sessions[0].agentLaunchAttempt.state).toBe('unconfirmed');
  await expect(f.context.writeAutomaticTerminalPrompt('frontend', 'codex', undefined, vi.fn(), 'request-1')).rejects.toMatchObject({ code: 'AGENT_LAUNCH_OUTCOME_UNCONFIRMED' });
  expect(f.write).toHaveBeenCalledOnce();
});

it('retains actual shell evidence when presentation metadata deliberately hides it', async () => {
  const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'resolveLiveTmuxMetadata')!;
  const context = vm.createContext({ process: { platform: 'linux' },
    getTmuxLayout: async () => ({}), getActivePaneFromLayout: () => ({ title: 'shell' }),
    getProcessSnapshot: async () => {}, resolveTmuxPaneProgram: async () => ({ command: 'zsh', rawArgs: '/usr/bin/zsh -l' }),
    getActiveProgramFromTmuxLayout: () => null, getCwdFromTmuxLayout: () => '/work',
    buildRuntimeTmuxMetadata: (input: any) => ({ ...input, program: null }),
  });
  vm.runInContext(ts.transpileModule(node.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  expect(await context.resolveLiveTmuxMetadata('own-test', false, true)).toMatchObject({ program: null, foregroundProgram: 'zsh' });
});

it('waits through shell startup commands before restoring into the same test pane', async () => {
  const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'restoreTmuxRecoverySession')!;
  let probes = 0, resumed = false;
  const write = vi.fn(async () => { resumed = true; });
  const context = vm.createContext({ Date, setTimeout, Error, Set,
    globalSessionState: { sessions: [{ sessionId: 'front', mode: 'tmux', tmuxSessionName: 'own-test', cwd: '/work', agentResume: { slug: 'codex', sessionId: 'native-thread' } }] },
    agentBySlug: () => ({ slug: 'codex' }), buildResumeCommand: () => 'codex resume native-thread',
    collaborationDeliveryWorker: { reconfigure: async (_id: string, fn: () => Promise<void>) => fn() },
    tmuxLifecycle: { run: async (_id: string, fn: () => Promise<void>) => fn() },
    prepareManagedTmuxSessionUnlocked: async () => {},
    resolveLiveTmuxMetadata: async () => ({ program: null, foregroundProgram: resumed ? 'codex' : ++probes === 1 ? 'getent' : 'zsh', rawArgs: resumed ? 'codex resume native-thread' : null }),
    shellNamesBackend: new Set(['zsh']), agentCustomCommands: () => [], detectAgentFromCommand: (command: string) => command.includes('codex') ? { slug: 'codex' } : null,
    findActiveAgentResumeOwner: () => false, findExternalCodexWriter: async () => false,
    collaborationRouting: { get: () => null }, beginAgentLaunchCheck: async () => () => {},
    writeAutomaticTerminalPrompt: write,
    confirmRecoveryAgent: async (options: any) => expect(await options.observe()).toMatchObject({ slug: 'codex', nativeId: 'native-thread', shell: false }),
    inferResumeSessionId: () => 'native-thread', splitCommandToArgv: () => [], tmuxRecoveryState: { incident: null }, runTmux: async () => '',
  });
  vm.runInContext(ts.transpileModule(node.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  await context.restoreTmuxRecoverySession('operation', 'front', vi.fn());
  expect(probes).toBeGreaterThan(1); expect(write).toHaveBeenCalledOnce();
});

it('bypasses old pane and process caches while a lost runtime is being reconciled', async () => {
  const builder = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'buildSessionInventory') as ts.FunctionDeclaration;
  const refresh = builder.body!.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(ast) === 'refreshedTmuxSessions'))!;
  const resolve = vi.fn(async (_name: string, cached: boolean, fresh: boolean) => cached || !fresh
    ? { program: 'codex', foregroundProgram: 'codex', rawArgs: 'stale original native process' }
    : { program: null, foregroundProgram: 'zsh', rawArgs: '/bin/zsh' });
  const context = vm.createContext({ Date, Promise, liveTmuxSessions: [{ name: 'own-test' }],
    globalSessionState: { sessions: [{ sessionId: 'front', tmuxSessionName: 'own-test' }] },
    tmuxRecoveryState: { runtimeLostSessionIds: ['front'], incident: null },
    isVeymuxManagedTmuxSession: () => true, resolveLiveTmuxMetadata: resolve,
    backfillAgentResumeFromTmuxProcess: () => {}, syncDynamicTmuxMetadata: () => {},
  });
  const code = ts.transpileModule(`(async () => { ${refresh.getText(ast)}; return refreshedTmuxSessions; })()`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  expect(await vm.runInContext(code, context)).toMatchObject([{ program: null, foregroundProgram: 'zsh' }]);
});
