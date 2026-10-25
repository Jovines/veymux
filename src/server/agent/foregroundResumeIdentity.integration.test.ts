import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { readForegroundResumeIdentity } from './foregroundResumeIdentity';
import { assessCollaborationRouteIdentity, CollaborationRoutingStore, type CollaborationPaneCandidate } from './collaborationRouting';
import { CollaborationStore } from './collaborationStore';
import { CollaborationDeliveryWorker, type CollaborationRoute } from './collaborationDeliveryWorker';
import { writeCollaborationTmuxPane } from './collaborationTmuxDelivery';

const exec = promisify(execFile);
it.skipIf(process.platform !== 'linux')('recovers a real resumed pane, settles a crash journal once, and never replays a partial paste', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-foreground-resume-'));
  const socket = `td-proof-${process.pid}-${Date.now()}`, script = path.join(dir, 'consumer.cjs'), output = path.join(dir, 'input');
  fs.writeFileSync(output, '');
  fs.writeFileSync(script, `const fs = require('node:fs'); process.stdin.setRawMode(true); process.stdin.resume(); process.stdout.write('\\x1b[?2004hREADY'); process.stdin.on('data', data => fs.appendFileSync(${JSON.stringify(output)}, data));`);
  const run = async (args: string[]) => (await exec('tmux', ['-L', socket, ...args], { timeout: 5000 })).stdout;
  const stdin = (args: string[], body: string) => new Promise<string>((resolve, reject) => {
    const child = execFile('tmux', ['-L', socket, ...args], { timeout: 5000 }, (error, stdout) => error ? reject(error) : resolve(stdout));
    child.stdin!.end(body);
  });
  let worker: CollaborationDeliveryWorker | undefined;
  try {
    await run(['new-session', '-d', '-s', 'peer', process.execPath, script, 'resume', 'original-native']);
    await vi.waitFor(async () => expect(await run(['capture-pane', '-p', '-t', 'peer'])).toContain('READY'));
    const identity = (await run(['display-message', '-p', '-t', 'peer', '#{pid}:#{session_id}:#{pane_id}:#{pane_pid}'])).trim().split(':');
    const pane = { serverPid: Number(identity[0]), sessionId: identity[1], paneId: identity[2], panePid: Number(identity[3]), agentSlug: 'fixture', nativeSessionId: 'original-native' };
    const rawArgs = fs.readFileSync(`/proc/${pane.panePid}/cmdline`, 'utf8').replace(/\0$/, '').split('\0').join(' ');
    const input = { panePid: pane.panePid, processPid: pane.panePid, rawArgs };
    const proof = await readForegroundResumeIdentity(input);
    expect(proof).toBeTruthy();
    expect(await readForegroundResumeIdentity({ ...input, rawArgs: `${rawArgs} changed` })).toBeNull();
    expect(await readForegroundResumeIdentity({ ...input, processComm: 'different-program' })).toBeNull();
    expect(await readForegroundResumeIdentity({ ...input, panePid: process.pid })).toBeNull();
    expect(await readForegroundResumeIdentity({ ...input, processPid: 2147483647 })).toBeNull();

    const routes = new CollaborationRoutingStore(path.join(dir, 'routes.json'));
    routes.bind({ sessionId: 'target', backendSessionId: 'backend', mode: 'tmux', tmuxSessionName: 'peer', agentSlug: 'fixture', nativeSessionId: 'original-native', pane: { ...pane, serverPid: pane.serverPid + 1, paneId: '%999', nativeSessionId: null } });
    const file = path.join(dir, 'messages.json'); let store = new CollaborationStore(file);
    const group = store.save({ name: 'Recovery', sessionIds: ['source', 'target'] });
    const send = (content: string) => store.send({ groupId: group.id, fromSessionId: 'source', toSessionIds: ['target'], kind: 'ask', content })[0];
    const first = send('FIRST'), second = send('SECOND');
    let failSubmit = false;
    const write = vi.fn<NonNullable<CollaborationRoute['write']>>();
    const resolve = vi.fn(async (): Promise<CollaborationRoute> => {
      const liveProof = await readForegroundResumeIdentity(input);
      const candidate: CollaborationPaneCandidate = { ...pane, cwd: dir, nativeIdentitySource: 'foreground-resume', nativeIdentityVerified: !!liveProof, foregroundProcessIdentity: liveProof ?? undefined };
      const selected = assessCollaborationRouteIdentity(routes.get('target')!, [candidate], true, store.hasUnconfirmedDelivery('target'));
      if (selected.state !== 'ready') return selected;
      routes.bind({ ...routes.get('target')!, pane });
      write.mockImplementation(async (messages, progress) => writeCollaborationTmuxPane(async args => {
        if (failSubmit && args[0] === 'set-buffer') throw new Error('injected submit disconnect');
        return run(args);
      }, pane, messages[0].content, stdin, undefined, progress, async () => {
        if (!liveProof || await readForegroundResumeIdentity(input) !== liveProof) throw new Error('process changed');
      }));
      return { state: 'ready', write };
    });
    const makeWorker = () => new CollaborationDeliveryWorker({ store, peers: () => [], isLocal: () => true, resolve, onError: () => {}, snapshotDelayMs: 0 });
    worker = makeWorker();
    vi.spyOn(store, 'markDelivered').mockImplementationOnce(() => { throw new Error('crash before receipt'); });
    await expect(worker.run('target')).rejects.toThrow('crash before receipt');
    expect(store.diagnostic(first.id)?.write_stage).toBe('submit_written');
    store = new CollaborationStore(file); worker = makeWorker();
    await worker.run('target'); expect(resolve).toHaveBeenCalledTimes(1); expect(write).toHaveBeenCalledTimes(1);
    expect(store.receipt(first.id).status).toBe('delivered');
    await worker.run('target'); expect(store.receipt(second.id).status).toBe('delivered');
    const expected = '\x1b[200~FIRST\x1b[201~\r\x1b[200~SECOND\x1b[201~\r';
    await vi.waitFor(() => expect(fs.readFileSync(output, 'utf8')).toBe(expected));

    const partial = send('PARTIAL'), later = send('LATER'); failSubmit = true;
    await worker.run('target'); expect(store.diagnostic(partial.id)?.write_stage).toBe('submit_attempted');
    store = new CollaborationStore(file); worker = makeWorker();
    await worker.run('target'); await worker.run('target');
    expect(write).toHaveBeenCalledTimes(3);
    expect(store.receipt(partial.id)).toMatchObject({ status: 'pending', last_error: 'DELIVERY_OUTCOME_UNCONFIRMED' });
    expect(store.receipt(later.id)).toMatchObject({ status: 'pending', attempt_count: 0 });
    await vi.waitFor(() => expect(fs.readFileSync(output, 'utf8')).toBe(expected + '\x1b[200~PARTIAL\x1b[201~'));
  } finally {
    worker?.stop(); await run(['kill-server']).catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  }
}, 20000);
