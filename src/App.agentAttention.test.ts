// @vitest-environment node
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { expect, it } from 'vitest';
it('refreshes sidebar/tab projections when only native completion acknowledgement changes', () => {
  const source = fs.readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'areTabTerminalSessionsEqual');
  if (!fn) throw new Error('Missing sidebar projection comparator');
  const context = vm.createContext({});
  vm.runInContext(ts.transpileModule(fn.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const progress = { state: 'done', source: 'osc7501', progress: null };
  const before = new Map([['session', { tuiProgress: progress }]]);
  const same = new Map([['session', { tuiProgress: { ...progress } }]]);
  const after = new Map([['session', { tuiProgress: { ...progress, reviewed: true } }]]);
  expect(context.areTabTerminalSessionsEqual(before, same)).toBe(true);
  expect(context.areTabTerminalSessionsEqual(before, after)).toBe(false);
});
