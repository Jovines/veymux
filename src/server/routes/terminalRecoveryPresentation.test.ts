// @vitest-environment node
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { DEFAULT_SESSION_DISPLAY_SHELL_NAMES, getSessionPresentation } from '../utils/sessionDisplayName';

const source = fs.readFileSync(new URL('./terminal.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('terminal.ts', source, ts.ScriptTarget.Latest, true);
const build = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'buildSessionInventory')!.getText(ast);

it('projects detached live titles and bound directory names through the same inventory rules', async () => {
  const tmux = ['detached-one', 'detached-two', 'bound'].map(name => ({ name, windows: 1, attachedCount: 0,
    friendlyName: null, label: 'codex · web-terminal', program: 'codex', cwd: '/work/web-terminal' }));
  const titles = new Map([['detached-one', '优化对话模式HTML体验'], ['detached-two', '修复 PWA 侧栏'], ['bound', 'Runtime title']]);
  const context = vm.createContext({
    Date, console, getTmuxStatus: async () => ({ available: true }), listLiveTmuxInventorySessions: async () => tmux,
    isVeymuxManagedTmuxSession: () => true, resolveLiveTmuxMetadata: async (name: string) => ({ ...tmux[0], shellTitle: titles.get(name) }),
    backfillAgentResumeFromTmuxProcess: vi.fn(), syncDynamicTmuxMetadata: vi.fn(), observeTmuxServerGeneration: vi.fn(),
    globalSessionState: { sessions: [{ sessionId: 'frontend', name: '自定义会话名称', customName: true, mode: 'tmux', tmuxSessionName: 'bound' }] },
    terminalSessions: new Map(), todoStore: { collectionSessions: () => new Map() }, sessionViewModes: { get: () => null },
    shellNamesBackend: DEFAULT_SESSION_DISPLAY_SHELL_NAMES, detectAgentFromCommand: () => null, agentCustomCommands: () => ({}),
    serializeAgentIdentity: () => null, agentBySlug: () => null, getSessionPresentation, schedulePersistGlobalState: vi.fn(),
    isTmuxRecoveryCandidate: () => true, getTmuxRecoveryView: () => null,
    inventoryTmuxLiveness: new WeakMap(), dynamicTmuxMetadata: { retain: vi.fn() },
  });
  vm.runInContext(ts.transpileModule(build, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const inventory = await context.buildSessionInventory();
  const byName = new Map<string, any>(inventory.tmuxSessions.map((session: { name: string }) => [session.name, session]));
  expect(byName.get('detached-one')).toMatchObject({ displayName: titles.get('detached-one'), displaySubtitle: 'web-terminal' });
  expect(byName.get('detached-two').displayName).toBe(titles.get('detached-two'));
  expect(byName.get('bound').displayName).toBe(inventory.clientSessions[0].displayName);
  expect(byName.get('bound').displayName).toBe('自定义会话名称');
  titles.set('detached-one', '更新后的实时标题');
  const updated = await context.buildSessionInventory();
  expect(updated.tmuxSessions.find((session: { name: string }) => session.name === 'detached-one').displayName).toBe('更新后的实时标题');
});
