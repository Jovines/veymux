// @vitest-environment node
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { terminalProgramStatus } from '../shared/programStatus.js';
const source = fs.readFileSync(new URL('./terminal.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('terminal.ts', source, ts.ScriptTarget.Latest, true);
let clause: ts.CaseClause | undefined;
function visit(node: ts.Node) {
  if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression) && node.expression.text === 'agent-review-ack') clause = node;
  ts.forEachChild(node, visit);
}
visit(ast);
function handler() {
  if (!clause) throw new Error('Missing WebSocket attention acknowledgement');
  const broadcastEvent = vi.fn(), broadcastAgentStatus = vi.fn();
  const context = vm.createContext({ terminalProgramStatus, broadcastEvent, broadcastAgentStatus });
  const code = `function acknowledge(sessionId, session) { switch ('agent-review-ack') { ${clause.getText(ast)} } }`;
  vm.runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { acknowledge: context.acknowledge as (id: string, session: object) => void, broadcastEvent, broadcastAgentStatus };
}
it('persists completion acknowledgement on the server and broadcasts it to all clients only once', () => {
  const h = handler();
  const session = { agentSession: { reviewed: false }, lastAgentReviewed: false, tuiProgress: null as unknown };
  const tracker = terminalProgramStatus(session);
  session.tuiProgress = tracker.feed('\x1b]7501;state=done:app=codex\x1b\\').progress;
  h.acknowledge('session', session);
  expect(session).toMatchObject({ agentSession: { reviewed: true }, lastAgentReviewed: null, tuiProgress: { state: 'done', reviewed: true } });
  expect(h.broadcastEvent).toHaveBeenCalledExactlyOnceWith('session', { type: 'tui-progress', tuiProgress: session.tuiProgress });
  expect(h.broadcastAgentStatus).toHaveBeenCalledOnce();
  h.acknowledge('session', session);
  expect(h.broadcastEvent).toHaveBeenCalledOnce();
  expect(h.broadcastAgentStatus).toHaveBeenCalledOnce();
  tracker.feed('\x1b]7501;state=working:app=codex\x1b\\');
  expect(tracker.feed('\x1b]7501;state=done:app=codex\x1b\\').progress?.reviewed).not.toBe(true);
});
it('acknowledges a native-only Agent without changing its working or blocked state', () => {
  const h = handler(), session = { lastAgentReviewed: null, tuiProgress: null as unknown };
  const tracker = terminalProgramStatus(session);
  session.tuiProgress = tracker.feed('\x1b]7501;state=done:app=another-agent\x1b\\').progress;
  h.acknowledge('session', session);
  expect(session.tuiProgress).toMatchObject({ reviewed: true });
  expect(h.broadcastAgentStatus).not.toHaveBeenCalled();
  session.tuiProgress = tracker.feed('\x1b]7501;state=blocked:app=another-agent\x1b\\').progress;
  h.acknowledge('session', session);
  expect(session.tuiProgress).toMatchObject({ state: 'blocked' });
  expect(h.broadcastEvent).toHaveBeenCalledOnce();
});
