import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { serializeTerminalInput } from '../agent/terminalInput.js';
import { TerminalOutputActivity } from '../utils/terminalOutputActivity.js';

function route() {
  const source = fs.readFileSync(new URL('./terminal.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('terminal.ts', source, ts.ScriptTarget.Latest, true);
  const statements = ast.statements.filter(node => node.getText(ast).startsWith('const terminalInputChecks =')
    || node.getText(ast).startsWith("router.post('/:sessionId/input-check',"));
  const session = { ptyProcess: { write: vi.fn() }, mode: 'shell', lastOutputAt: 100,
    agentSession: { status: 'done', activity: 1 }, outputActivity: undefined as TerminalOutputActivity | undefined };
  const record = { sessionId: 'front', backendSessionId: 'back' };
  let handler!: (req: unknown, res: unknown) => Promise<unknown>;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const probe = vi.fn(async (input: { paste: (text: string) => Promise<void> }) => {
    await input.paste('td01234567'); await gate; session.lastOutputAt = 999;
    return { status: 'ready', echoOnly: true };
  });
  const context = vm.createContext({
    WeakMap, JSON, serializeTerminalInput, TerminalOutputActivity,
    router: { post: (_path: string, callback: typeof handler) => { handler = callback; } },
    resolveStableFederationSessionId: () => 'front', globalSessionState: { sessions: [record] },
    terminalSessions: new Map([['back', session]]), terminalInputGuard: () => () => {},
    collaborationRouting: { get: () => null }, canDeliverPromptToAgent: () => true,
    probeTerminalReadiness: probe, broadcastEvent: vi.fn(), buildBracketedPasteBytes: (text: string) => text,
  });
  vm.runInContext(ts.transpileModule(statements.map(node => node.getText(ast)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const request = async (backendSessionId = 'back', entryId?: string) => {
    let code = 200, body: unknown;
    const response = { once() {}, status(value: number) { code = value; return response; }, json(value: unknown) { body = value; return response; } };
    await handler({ params: { sessionId: 'front' }, body: { backendSessionId, ...(entryId === undefined ? {} : { entryId }) } }, response);
    return { code, body };
  };
  return { request, session, probe, release, dispose: () => session.outputActivity?.dispose() };
}
it('deduplicates concurrent tabs and repeat edges, and keeps human input behind cleanup', async () => {
  const p = route();
  try {
    const requests = Array.from({ length: 8 }, () => p.request());
    await vi.waitFor(() => expect(p.probe).toHaveBeenCalledOnce());
    let manual = false;
    const userInput = serializeTerminalInput(p.session.ptyProcess, async () => { manual = true; });
    expect(manual).toBe(false); p.release();
    expect((await Promise.all(requests)).every(result => result.code === 200 && (result.body as { status: string }).status === 'ready')).toBe(true);
    await userInput; expect(manual).toBe(true);
    expect(p.session.lastOutputAt).toBe(100);
    await p.request(); expect(p.probe).toHaveBeenCalledOnce();
    p.session.lastOutputAt = 200; await p.request(); expect(p.probe).toHaveBeenCalledTimes(2);
  } finally { p.dispose(); }
});
it('performs a fresh check on each new idle entry without new output, while deduplicating an entry retry', async () => {
  const p = route(); p.release();
  try {
    await p.request('back', 'visit-a'); await p.request('back', 'visit-a');
    expect(p.probe).toHaveBeenCalledOnce(); expect(p.session.lastOutputAt).toBe(100);
    await p.request('back', 'visit-b'); expect(p.probe).toHaveBeenCalledTimes(2);
    await p.request('back', 'visit-b'); expect(p.probe).toHaveBeenCalledTimes(2);
    expect((await p.request('back', 'bad/id')).code).toBe(400);
    expect(p.probe).toHaveBeenCalledTimes(2);
  } finally { p.dispose(); }
});
it('does not accumulate diagnostic characters when re-entering an unresolved input check', async () => {
  const p = route(); p.release(); p.probe.mockResolvedValueOnce({ status: 'unconfirmed', echoOnly: false });
  try {
    expect((await p.request('back', 'visit-a')).body).toMatchObject({ status: 'unconfirmed' });
    expect((await p.request('back', 'visit-b')).body).toMatchObject({ status: 'unconfirmed' });
    expect(p.probe).toHaveBeenCalledOnce();
  } finally { p.dispose(); }
});
it('does not swallow a quick return that joined an older check skipped before editing', async () => {
  const p = route(); p.release(); p.probe.mockResolvedValueOnce({ status: 'skipped', echoOnly: false });
  try {
    const leaving = p.request('back', 'visit-a');
    const returning = p.request('back', 'visit-b');
    expect((await leaving).body).toMatchObject({ status: 'skipped' });
    expect((await returning).body).toMatchObject({ status: 'ready' });
    expect(p.probe).toHaveBeenCalledTimes(2);
  } finally { p.dispose(); }
});
it('rejects a replaced runtime and skips explicit working without writing to its input', async () => {
  const p = route();
  try {
    expect((await p.request('previous-backend')).code).toBe(409);
    p.session.agentSession.status = 'working';
    expect((await p.request()).body).toEqual({ status: 'skipped' });
    expect(p.probe).not.toHaveBeenCalled(); expect(p.session.ptyProcess.write).not.toHaveBeenCalled();
  } finally { p.dispose(); }
});
