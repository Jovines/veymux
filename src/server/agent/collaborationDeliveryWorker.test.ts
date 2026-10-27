import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CollaborationStore, type CollaborationMessage } from './collaborationStore.js';
import { CollaborationDeliveryWorker, type CollaborationRoute } from './collaborationDeliveryWorker.js';

describe('background collaboration delivery', () => {
  let directory: string;
  let file: string;
  let store: CollaborationStore;
  let groupId: string;
  let worker: CollaborationDeliveryWorker;
  let resolve: ReturnType<typeof vi.fn<(id: string) => Promise<CollaborationRoute>>>;
  let write: ReturnType<typeof vi.fn<(messages: unknown[]) => Promise<void>>>;
  beforeEach(() => {
    vi.useFakeTimers();
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'veymux-collab-worker-'));
    file = path.join(directory, 'messages.json');
    store = new CollaborationStore(file);
    groupId = store.save({ name: 'Team', sessionIds: ['a', 'b', 'c'] }).id;
    write = vi.fn(async () => undefined);
    resolve = vi.fn(async () => ({ state: 'ready', write }));
    worker = makeWorker();
  });
  afterEach(() => { worker.stop(); vi.restoreAllMocks(); vi.useRealTimers(); fs.rmSync(directory, { recursive: true, force: true }); });
  function makeWorker() {
    return new CollaborationDeliveryWorker({ store, isLocal: (id) => !id.startsWith('remote:'),
      resolve, onError: () => undefined, snapshotDelayMs: 0 });
  }
  function send(target = 'b', expiresAt?: number) {
    return store.send({ groupId, fromSessionId: 'a', toSessionIds: [target], kind: 'message', content: 'Please verify', expiresAt })[0]!;
  }
  it('never resolves idle historical members on startup, ticks, or explicit wake', async () => {
    worker.start();
    await worker.tick();
    await vi.advanceTimersByTimeAsync(60_000);
    await worker.run('b');
    expect(resolve).not.toHaveBeenCalled();
    send();
    await worker.tick();
    expect(resolve.mock.calls).toEqual([['b']]);
    expect(write).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(resolve).toHaveBeenCalledOnce();
  });
  it.each(['shell', 'unknown-agent', 'revoked'] as const)('never writes restricted chat to %s even if shell delivery was manually confirmed', async scenario => {
    const message = store.send({ groupId, fromSessionId: 'a', toSessionIds: ['b'], kind: 'ask', content: 'ordinary text', metadata: { chatOnly: true, chatSubject: 'device' } })[0]!;
    store.confirmShell(message.id);
    resolve.mockResolvedValue({ state: 'ready', isShell: scenario === 'shell', agentSlug: scenario === 'unknown-agent' ? null : 'codex', write });
    worker = new CollaborationDeliveryWorker({ store, isLocal: () => true, resolve, authorizeMessage: () => scenario !== 'revoked', onError: () => undefined });
    await worker.run('b');
    expect(write).not.toHaveBeenCalled(); expect(store.getMessage(message.id)?.status).toBe('failed');
  });

  it('retains failed probe guidance across restart and blocks replay of the header and later messages', async () => {
    const message = send(); send();
    store.recordTransport(message.id, { relay_online: null, peer_reachable: true, next_retry_at: null, checked_at: Date.now(), attempt_count: 1,
      write_stage: 'paste_attempted', last_error: 'TERMINAL_WRITE_FAILED: TERMINAL_INPUT_ECHO_UNCONFIRMED' }, true);
    store = new CollaborationStore(file); worker = makeWorker();
    await worker.run('b'); await vi.advanceTimersByTimeAsync(10000); await worker.run('b');
    expect(write).not.toHaveBeenCalled();
    expect(store.getMessage(message.id)?.status).toBe('pending');
    expect(store.diagnostic(message.id)?.last_error).toContain('TERMINAL_INPUT_ECHO_UNCONFIRMED');
  });

  it('persists a failed input probe separately and explains later queued messages without inventing their write attempts', async () => {
    const first = send(), second = send();
    const body = vi.fn();
    resolve.mockResolvedValue({ state: 'ready', tracksWriteProgress: true, write: async (_messages, progress) => {
      progress?.('queue_wait'); progress?.('probe_attempted');
      throw new Error('TERMINAL_INPUT_ECHO_UNCONFIRMED');
      // No body/Enter is written when the preflight echo cannot be confirmed.
    } });
    await worker.run('b');
    expect(store.diagnostic(first.id)?.write_stage).toBe('probe_attempted');
    store = new CollaborationStore(file); worker = makeWorker();
    resolve.mockResolvedValue({ state: 'ready', write: body });
    await worker.run('b');
    expect(body).not.toHaveBeenCalled();
    expect(store.diagnostic(first.id)).toMatchObject({ write_stage: 'probe_attempted', attempt_count: 1 });
    expect(store.diagnostic(second.id)).toMatchObject({ attempt_count: 0, last_error: 'TERMINAL_INPUT_ECHO_UNCONFIRMED', next_retry_at: null });
    expect(store.diagnostic(second.id)?.write_stage).toBeUndefined();
    expect(store.receipt(second.id).delivery_semantics).toBe('not_delivered');
    expect(worker.state('b').reason).toBe('TERMINAL_INPUT_ECHO_UNCONFIRMED');
  });

  it('allows a confirmed cleaned-up probe to retry across restart before any body was pasted', async () => {
    const message = send();
    resolve.mockResolvedValue({ state: 'ready', tracksWriteProgress: true, write: async (_messages, progress) => {
      progress?.('queue_wait'); progress?.('probe_attempted'); progress?.('probe_completed');
      throw new Error('runtime changed before body paste');
    } });
    await worker.run('b');
    expect(new CollaborationStore(file).diagnostic(message.id)?.write_stage).toBe('not_started');
    store = new CollaborationStore(file); worker = makeWorker();
    resolve.mockResolvedValue({ state: 'ready', write });
    await vi.advanceTimersByTimeAsync(2000); await worker.run('b');
    expect(write).toHaveBeenCalledOnce();
    expect(store.getMessage(message.id)?.status).toBe('delivered');
  });

  it('requires sender confirmation only for a known shell, preserving the queued message', async () => {
    const message = send();
    resolve.mockResolvedValue({ state: 'ready', isShell: true, write, capture: async () => '$ ' });
    await worker.run('b');
    expect(write).not.toHaveBeenCalled();
    expect(worker.state('b').state).toBe('shell');
    expect(store.receipt(message.id)).toMatchObject({ status: 'pending', snapshot: '$ ', last_error: expect.stringContaining('confirm-shell') });
    store.confirmShell(message.id);
    expect(new CollaborationStore(file).getMessage(message.id)?.shellConfirmed).toBe(true);
    await worker.run('b');
    expect(write).toHaveBeenCalledTimes(1);
    expect(store.getMessage(message.id)?.status).toBe('delivered');
  });

  it('drains durable messages after restart without a browser or hook event', async () => {
    const message = send();
    store = new CollaborationStore(file);
    worker = makeWorker();
    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.receipt(message.id)).toMatchObject({ status: 'delivered', attempt_count: 1, delivery_semantics: 'pty_written', ack_at: null });
    expect(write).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('joins concurrent recovery and delivery requests for the same peer', async () => {
    send();
    let release!: (route: CollaborationRoute) => void;
    resolve.mockImplementation(() => new Promise((done) => { release = done; }));
    const one = worker.run('b');
    const two = worker.run('b');
    await Promise.resolve();
    expect(one).toBe(two);
    expect(resolve).toHaveBeenCalledTimes(1);
    release({ state: 'ready', write });
    await Promise.all([one, two]);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('records routing failures without pretending a transport attempt occurred, and retries later', async () => {
    const message = send();
    resolve.mockResolvedValueOnce({ state: 'detached', reason: 'TMUX_ATTACH_EXITED' });
    await worker.run('b');
    expect(store.receipt(message.id)).toMatchObject({ status: 'pending', attempt_count: 0, last_error: 'TMUX_ATTACH_EXITED', next_retry_at: expect.any(Number) });
    await worker.run('b');
    expect(resolve).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    await worker.run('b');
    expect(store.receipt(message.id)).toMatchObject({ status: 'delivered', attempt_count: 1, last_error: null, next_retry_at: null });
  });

  it('persists transport failures and retry deadlines across restart', async () => {
    const message = send();
    resolve.mockResolvedValueOnce({ state: 'ready', write: async (_messages, progress) => { progress?.('queue_wait'); throw new Error('broken pipe'); } });
    await worker.run('b');
    store = new CollaborationStore(file);
    worker = makeWorker();
    await worker.run('b');
    expect(write).not.toHaveBeenCalled();
    expect(store.receipt(message.id)).toMatchObject({ status: 'pending', attempt_count: 1, last_error: 'TERMINAL_WRITE_FAILED: broken pipe' });
    await vi.advanceTimersByTimeAsync(2_000);
    await worker.run('b');
    expect(store.receipt(message.id)).toMatchObject({ status: 'delivered', attempt_count: 2 });
  });

  it.each(['unknown', 'paste_attempted', 'paste_written', 'submit_attempted'] as const)('pauses an uncertain terminal write across restart (%s), preserving FIFO and TTL', async stage => {
    const first = send('b', Date.now() + 1000), later = send();
    store.recordTransport(first.id, { relay_online: null, peer_reachable: true, attempt_count: 1,
      next_retry_at: Date.now(), last_error: 'DELIVERY_IN_PROGRESS', checked_at: Date.now(), write_stage: stage });
    store = new CollaborationStore(file); worker = makeWorker();
    await vi.advanceTimersByTimeAsync(2000); await worker.run('b');
    expect(store.receipt(first.id)).toMatchObject({ status: 'pending', last_error: 'DELIVERY_OUTCOME_UNCONFIRMED', delivery: { stage: 'outcome_unconfirmed', write_stage: stage } });
    expect(store.receipt(later.id)).toMatchObject({ status: 'pending', attempt_count: 0 });
    expect(write).not.toHaveBeenCalled(); expect(resolve).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60000); await worker.run('b');
    expect(store.receipt(first.id).status).toBe('pending'); expect(write).not.toHaveBeenCalled();
  });

  it('settles durable submit completion after restart without resolving or writing to a replacement terminal', async () => {
    const message = send('b', Date.now() + 1000);
    store.recordTransport(message.id, { relay_online: null, peer_reachable: true, attempt_count: 1,
      next_retry_at: Date.now(), last_error: 'DELIVERY_IN_PROGRESS', checked_at: Date.now(), write_stage: 'submit_written' });
    store = new CollaborationStore(file); worker = makeWorker();
    await vi.advanceTimersByTimeAsync(2000); await worker.run('b');
    expect(store.receipt(message.id)).toMatchObject({ status: 'delivered', attempt_count: 1 });
    expect(write).not.toHaveBeenCalled(); expect(resolve).not.toHaveBeenCalled();
  });

  it('keeps legacy in-flight attempts unconfirmed instead of replaying them', async () => {
    const message = send();
    store.recordTransport(message.id, { relay_online: null, peer_reachable: true, attempt_count: 1,
      next_retry_at: Date.now(), last_error: 'DELIVERY_IN_PROGRESS', checked_at: Date.now() });
    store = new CollaborationStore(file); worker = makeWorker(); await worker.run('b');
    expect(store.receipt(message.id).last_error).toBe('DELIVERY_OUTCOME_UNCONFIRMED'); expect(write).not.toHaveBeenCalled();
  });

  it.each(['SESSION_REMOVED', 'SESSION_REMOVED_DURING_RECOVERY'])('stops retrying a removed terminal (%s) and preserves its failed message', async reason => {
    const message = send();
    resolve.mockResolvedValue({ state: 'offline', reason });
    await worker.run('b');
    expect(store.receipt(message.id)).toMatchObject({ status: 'failed', last_error: reason, next_retry_at: null, attempt_count: 0 });
    expect(write).not.toHaveBeenCalled();
    store = new CollaborationStore(file); worker = makeWorker();
    expect(store.getMessage(message.id)).toMatchObject({ content: 'Please verify', status: 'failed', failureReason: reason });
    const persist = vi.spyOn(fs, 'renameSync');
    worker.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(persist).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('does not send messages read or expired during asynchronous attachment', async () => {
    const message = send();
    resolve.mockImplementationOnce(async () => { store.markRead([message.id]); return { state: 'ready', write }; });
    await worker.run('b');
    const expiring = send('b', Date.now() + 1_000);
    resolve.mockImplementationOnce(async () => { vi.setSystemTime(Date.now() + 2_000); return { state: 'ready', write }; });
    await worker.run('b');
    expect(store.getMessage(expiring.id)?.status).toBe('expired');
    expect(write).not.toHaveBeenCalled();
  });

  it('isolates a broken peer and leaves remote delivery to the federation transport', async () => {
    const broken = send('b');
    const healthy = send('c');
    resolve.mockImplementation(async (id) => { if (id === 'b') throw new Error('tmux timeout'); return { state: 'ready', write }; });
    await worker.tick();
    await worker.run('remote:other');
    expect(store.getMessage(broken.id)?.status).toBe('pending');
    expect(store.getMessage(healthy.id)?.status).toBe('delivered');
    expect(resolve.mock.calls.flat()).not.toContain('remote:other');
    expect(worker.state('b')).toMatchObject({ state: 'unavailable', reason: 'ROUTE_RECOVERY_FAILED: tmux timeout' });
  });

  it('does not expire a message in the middle of an already-started terminal write', async () => {
    const message = send('b', Date.now() + 1_000);
    write.mockImplementationOnce(async () => {
      vi.setSystemTime(Date.now() + 2_000);
      expect(store.receipt(message.id).status).toBe('pending');
    });
    await worker.run('b');
    expect(store.receipt(message.id).status).toBe('delivered');
  });
  it('expires a message that waits past its TTL before the first paste', async () => {
    const message = send('b', Date.now() + 1000), bytes = vi.fn();
    resolve.mockResolvedValueOnce({ state: 'ready', tracksWriteProgress: true, write: async (_messages, progress) => {
      progress?.('queue_wait'); vi.setSystemTime(Date.now() + 2000); progress?.('paste_attempted'); bytes();
    } });
    await worker.run('b');
    expect(bytes).not.toHaveBeenCalled(); expect(store.receipt(message.id).status).toBe('expired');
  });

  it('serializes explicit rebinding behind an in-flight delivery and clears route backoff', async () => {
    const message = send();
    let release!: (route: CollaborationRoute) => void;
    resolve.mockImplementationOnce(() => new Promise((done) => { release = done; }));
    const delivery = worker.run('b');
    await Promise.resolve();
    const configure = vi.fn(async () => undefined);
    const reset = worker.reconfigure('b', configure);
    expect(configure).not.toHaveBeenCalled();
    release({ state: 'identity-mismatch', reason: 'TMUX_PANE_CHANGED' });
    await Promise.all([delivery, reset]);
    expect(configure).toHaveBeenCalledTimes(1);
    expect(store.receipt(message.id).next_retry_at).toBeNull();
    await worker.run('b');
    expect(store.receipt(message.id).status).toBe('delivered');
  });

  it('never writes if persisting the transport attempt fails', async () => {
    const message = send();
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('disk full'); });
    await expect(worker.run('b')).rejects.toThrow('disk full');
    expect(write).not.toHaveBeenCalled();
    expect(store.receipt(message.id)).toMatchObject({ status: 'pending', attempt_count: 0 });
  });

  it('does not paste when the durable pre-write journal cannot be flushed', async () => {
    const message = send();
    const bytes = vi.fn();
    resolve.mockResolvedValue({ state: 'ready', tracksWriteProgress: true, write: async (_messages, progress) => {
      progress?.('queue_wait'); progress?.('paste_attempted'); bytes();
    } });
    vi.spyOn(fs, 'fsyncSync').mockImplementationOnce(() => { throw new Error('cannot flush write journal'); });
    await worker.run('b');
    expect(bytes).not.toHaveBeenCalled();
    expect(store.receipt(message.id)).toMatchObject({ status: 'pending', attempt_count: 1 });
  });

  it('does not rewrite terminal input when receipt persistence fails after a successful write', async () => {
    const message = send();
    write.mockImplementationOnce(async () => {
      vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('disk full after write'); });
    });
    await expect(worker.run('b')).rejects.toThrow('disk full after write');
    expect(store.getMessage(message.id)?.status).toBe('pending');
    resolve.mockResolvedValue({ state: 'offline', reason: 'SHELL_BACKEND_NOT_RUNNING' });
    await vi.advanceTimersByTimeAsync(2_000);
    await worker.run('b');
    expect(write).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(store.getMessage(message.id)?.status).toBe('delivered');
  });

  it('keeps FIFO order and never replays successfully delivered messages across restart', async () => {
    const first = send();
    const second = send();
    await worker.run('b');
    store = new CollaborationStore(file);
    worker = makeWorker();
    await worker.run('b');
    expect(write.mock.calls.map(([messages]) => (messages[0] as { id: string }).id)).toEqual([first.id, second.id]);
  });

  it('settles terminal writes even if snapshots show a paste or approval prompt', async () => {
    const capture = vi.fn(async () => '[Pasted text #2 +13 lines]\nThis command requires approval\n1. Yes');
    resolve.mockResolvedValue({ state: 'ready', write, capture });
    const message = send();
    await worker.run('b');
    expect(store.receipt(message.id)).toMatchObject({ status: 'delivered', attempt_count: 1, last_error: null,
      delivery_semantics: 'pty_written', ack_at: null, reply_ids: [], result_ids: [] });
    await vi.advanceTimersByTimeAsync(60_000);
    await worker.run('b');
    expect(write).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('captures a delayed snapshot only as an observation', async () => {
    const message = send();
    const capture = vi.fn(async () => 'input box');
    resolve.mockResolvedValue({ state: 'ready', write, capture });
    worker = new CollaborationDeliveryWorker({ store, isLocal: () => true,
      resolve, onError: () => undefined, snapshotDelayMs: 200 });
    const delivery = worker.run('b');
    await vi.advanceTimersByTimeAsync(199);
    expect(capture).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await delivery;
    expect(store.receipt(message.id)).toMatchObject({ status: 'delivered', snapshot: 'input box', last_error: null });
    expect(write).toHaveBeenCalledTimes(1);
  });
});

it('durable local messages in federated groups wake the worker and expose identity blocking without a terminal write', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'veymux-fed-local-worker-'));
  const store = new CollaborationStore(path.join(directory, 'messages.json'));
  const group = { id: 'cross-local', name: 'Cross', sessionIds: ['sender', 'target', 'remote:https%3A%2F%2Fother.example:remote'], federated: true, remoteSessions: [], createdAt: 1, updatedAt: 1 };
  store.mergeFederatedGroup(group);
  const identity = { expected: { serverPid: 1, sessionId: '$1', paneId: '%1', panePid: 2, agentSlug: 'fixture', nativeSessionId: 'old' },
    observed: [], truncated: false, recovery: 'confirmation-required' as const, reason: 'NATIVE_IDENTITY_UNCONFIRMED', rebind_command: 'veymux collab --session target rebind' };
  const write = vi.fn(async (_messages: CollaborationMessage[]) => undefined), resolver = vi.fn(async (): Promise<CollaborationRoute> => ({ state: 'identity-mismatch', reason: 'TMUX_PANE_CHANGED', diagnostics: identity, write }));
  const worker = new CollaborationDeliveryWorker({ store, isLocal: id => !id.startsWith('remote:'), resolve: resolver, onError: error => { throw error; } });
  try {
    worker.start(); await worker.tick();
    const message: CollaborationMessage = store.send({ groupId: group.id, fromSessionId: 'sender', toSessionIds: ['target'], kind: 'message', content: 'Original', idempotencyKey: 'once' })[0];
    await vi.waitFor(() => expect(store.receipt(message.id).last_error).toBe('TMUX_PANE_CHANGED'));
    expect(store.receipt(message.id)).toMatchObject({ status: 'pending', attempt_count: 0, delivered_at: null,
      delivery: { stage: 'blocked', error: 'TMUX_PANE_CHANGED', requires_confirmation: true, route: identity } });
    expect(worker.diagnostics('target')).toMatchObject({ started: true, pending_count: 1 }); expect(write).not.toHaveBeenCalled();
    const later = store.send({ groupId: group.id, fromSessionId: 'sender', toSessionIds: ['target'], kind: 'message', content: 'Later', idempotencyKey: 'later' })[0];
    await vi.waitFor(() => expect(store.receipt(later.id).last_error).toBe('TMUX_PANE_CHANGED'));
    expect(store.receipt(later.id)).toMatchObject({ attempt_count: 0, delivery: { stage: 'blocked' } });
    resolver.mockResolvedValue({ state: 'ready', write });
    await worker.reconfigure('target', async () => undefined); await worker.run('target'); await worker.run('target');
    expect(store.receipt(message.id)).toMatchObject({ status: 'delivered', attempt_count: 1, thread_id: message.threadId, idempotency_key: 'once' });
    expect(store.inbox('target')).toHaveLength(2); expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls.flatMap(([messages]) => messages.map(item => item.id)).sort()).toEqual([message.id, later.id].sort());
    expect(store.hasUnconfirmedDelivery('target')).toBe(false);
  } finally { worker.stop(); fs.rmSync(directory, { recursive: true, force: true }); }
});
