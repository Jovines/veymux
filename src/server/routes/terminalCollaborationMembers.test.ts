// @vitest-environment node
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { CollaborationError } from '../agent/collaborationProtocol.js';

// Exercise the production handler without loading persistent user inventories.
const source = fs.readFileSync(new URL('./terminal.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('terminal.ts', source, ts.ScriptTarget.Latest, true);
const statement = ast.statements.find(node => ts.isExpressionStatement(node)
  && ts.isCallExpression(node.expression)
  && node.expression.arguments[0]?.getText(ast) === "'/operations/orchestration/members'")!;

function fixture(connected = true) {
  let handler!: (req: unknown, res: unknown) => Promise<unknown>;
  const group = { id: 'cross-test', name: 'Pair', sessionIds: ['caller', 'second', 'remote:mac:peer'], federated: true, updatedAt: 7 };
  const save = vi.fn(async (input: unknown) => ({ group: input, synchronization: 'background' }));
  const service = { save, directory: () => ({ sessions: [{ sessionId: 'remote:mac:peer', serviceConnected: connected }] }) };
  const context = { router: { post: (_path: string, fn: typeof handler) => { handler = fn; } },
    resolveFrontendSessionId: () => 'caller', resolveGroupParam: () => ({ group }),
    globalSessionState: { sessions: [{ sessionId: 'caller' }, { sessionId: 'second' }] },
    assertPeerRegistrationAuthority: vi.fn(), CollaborationError,
    getErrorMessage: (error: Error) => error.message };
  vm.runInNewContext(ts.transpileModule(statement.getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  const response = { statusCode: 200, body: null as unknown,
    status(code: number) { this.statusCode = code; return this; }, json(body: unknown) { this.body = body; return this; } };
  const run = (action: string, targetSessionId = 'remote:mac:peer') => handler({
    body: { groupId: group.id, action, targetSessionId }, app: { locals: { collaborationService: service } },
  }, response);
  return { run, save, response, group };
}

it('adds remote members through the federation owner with a revision fence', async () => {
  const f = fixture();
  await f.run('add');
  expect(f.response.statusCode).toBe(200);
  expect(f.save).toHaveBeenCalledWith({ id: 'cross-test', name: 'Pair', sessionIds: f.group.sessionIds, expectedUpdatedAt: 7 });
});
it('allows removal of an existing offline remote member and broadcasts through the service', async () => {
  const f = fixture(false);
  await f.run('remove');
  expect(f.response.statusCode).toBe(200);
  expect(f.save).toHaveBeenCalledWith(expect.objectContaining({ sessionIds: ['caller', 'second'], expectedUpdatedAt: 7 }));
});
it('rejects unavailable new remote members and preserves concurrent-update errors', async () => {
  const f = fixture(false);
  await f.run('add');
  expect(f.response.statusCode).toBe(404);
  expect(f.save).not.toHaveBeenCalled();
  const changed = fixture();
  changed.save.mockRejectedValueOnce(new CollaborationError('GROUP_CHANGED', 'Changed', 409));
  await changed.run('remove');
  expect(changed.response.statusCode).toBe(409);
});
