// @vitest-environment node
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';

const source = fs.readFileSync(new URL('./terminal.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('terminal.ts', source, ts.ScriptTarget.Latest, true);
const helper = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'restoreSharedFederationSession')!;
function fixture(record?: Record<string, unknown>) {
  const open = vi.fn().mockResolvedValue({}), run = vi.fn().mockResolvedValue('');
  const context = vm.createContext({
    globalSessionState: { sessions: record ? [record] : [] }, terminalSessions: new Map(), runTmux: run,
    openInventorySession: open, makeInventoryOpenLockKey: () => 'existing-session', withInventoryOpenLock: (_key: string, task: () => Promise<boolean>) => task(),
  });
  vm.runInContext(ts.transpileModule(helper.getText(ast).replace('export ', ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { open, run, restore: () => context.restoreSharedFederationSession('stable') };
}

it('reattaches the exact surviving tmux through the existing inventory path without guessed geometry', async () => {
  const f = fixture({ sessionId: 'stable', mode: 'tmux', tmuxSessionName: 'owned-session', backendSessionId: null });
  expect(await f.restore()).toBe(true);
  expect(f.run).toHaveBeenCalledWith(['has-session', '-t', '=owned-session']);
  expect(f.open).toHaveBeenCalledWith({}, { preferredFrontendSessionId: 'stable', requireExisting: true });
});

it.each([undefined, { sessionId: 'stable', mode: 'shell' }, { sessionId: 'other', mode: 'tmux', tmuxSessionName: 'other' }])('never creates a shell or a missing/unrelated record: %s', async record => {
  const f = fixture(record);
  expect(await f.restore()).toBe(false);
  expect(f.open).not.toHaveBeenCalled(); expect(f.run).not.toHaveBeenCalled();
});

it('does not recreate a deleted tmux session', async () => {
  const f = fixture({ sessionId: 'stable', mode: 'tmux', tmuxSessionName: 'owned-session' });
  f.run.mockRejectedValue(new Error('missing session'));
  expect(await f.restore()).toBe(false);
  expect(f.open).not.toHaveBeenCalled();
});
