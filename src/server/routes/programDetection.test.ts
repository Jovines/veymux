import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { validChatProgramName } from '../shared/chatProgramPolicy';
import { agentBySlug } from '../agent/registry';

// Execute the actual handler without starting the terminal router's live sessions.
const source = readFileSync(new URL('./terminal.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('terminal.ts', source, ts.ScriptTarget.Latest, true);
const call = ast.statements.flatMap(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) ? [node.expression] : [])
  .find(node => node.expression.getText(ast) === 'router.put' && node.arguments[0]?.getText(ast) === "'/program-detection'")!;
it('preserves custom Agent rules and the chat allowlist when an older settings client saves', async () => {
  const previous = { genericProgramNames: ['node'], wrapperScriptNames: ['npx'], shellNames: ['zsh'], agentCommands: { cc: 'claude' }, chatProgramNames: ['my-agent'] };
  const save = vi.fn(), json = vi.fn();
  const context = vm.createContext({ validChatProgramName, agentBySlug, DEFAULT_PROGRAM_DETECTION: previous, loadProgramDetectionFromDisk: async () => previous, saveProgramDetectionToDisk: save, broadcastControlEvent: vi.fn() });
  vm.runInContext(ts.transpileModule(`globalThis.handler = ${call.arguments[1].getText(ast)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  await context.handler({ body: { genericProgramNames: ['node'], wrapperScriptNames: ['npx'], shellNames: ['zsh'] } }, { json });
  expect(save).toHaveBeenCalledWith(previous);
  await context.handler({ body: { ...previous, agentCommands: { mine: 'codex', unknown: 'missing' }, chatProgramNames: ['MY-AGENT', 'my-agent', 'node', '/tmp/agent', 'zsh'] } }, { json });
  expect(save.mock.lastCall?.[0]).toMatchObject({ agentCommands: { mine: 'codex' }, chatProgramNames: ['my-agent'] });
});
