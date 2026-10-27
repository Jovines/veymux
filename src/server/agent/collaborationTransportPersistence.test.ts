// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CollaborationStore } from './collaborationStore.js';
import { CollaborationDeliveryWorker } from './collaborationDeliveryWorker.js';
import type { TransportDiagnostic } from './collaborationProtocol.js';

let directory: string, file: string, store: CollaborationStore, ids: string[];
const diagnostic = (patch: Partial<TransportDiagnostic> = {}): TransportDiagnostic => ({
  relay_online: true, peer_reachable: true, attempt_count: 1,
  next_retry_at: Date.now() + 500, last_error: 'TERMINAL_INPUT_ECHO_UNCONFIRMED', checked_at: Date.now(), ...patch,
});
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(100_000);
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'td-transport-persistence-'));
  file = path.join(directory, 'groups.json');
  store = new CollaborationStore(file);
  const group = store.save({ name: 'Team', sessionIds: ['sender', 'local', 'remote:https%3A%2F%2Fpeer.test:worker'] });
  ids = store.send({ groupId: group.id, fromSessionId: 'sender', toSessionIds: group.sessionIds.slice(1), kind: 'message', content: 'Keep my task' }).map(m => m.id);
  for (const id of ids) store.recordTransport(id, diagnostic());
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); fs.rmSync(directory, { recursive: true, force: true }); });

it('bounds full-history writes globally during repeated local and remote checks, including after upgrade/restart', () => {
  // Use the existing on-disk format with a large history; no manual migration.
  const legacy = JSON.parse(fs.readFileSync(file, 'utf8'));
  legacy.messages.push({ ...legacy.messages[0], id: 'history', status: 'delivered', content: 'x'.repeat(10_000_000) });
  fs.writeFileSync(file, JSON.stringify(legacy));
  store = new CollaborationStore(file);
  const changed = vi.fn(); store.subscribe(changed);
  const write = vi.spyOn(fs, 'writeFileSync');
  const stringify = vi.spyOn(JSON, 'stringify');
  for (let i = 1; i <= 119; i++) {
    vi.setSystemTime(100_000 + i * 500);
    store.recordTransport(ids[1], diagnostic({ attempt_count: i + 1 }));
    store.recordRecipientTransport('local', { checked_at: Date.now(), next_retry_at: Date.now() + 500 });
  }
  expect(write).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled();
  // Even serialization of the full history must stay out of the hot path.
  expect(stringify.mock.calls.some(([value]) => value?.messages)).toBe(false);
  expect(store.diagnostic(ids[1])?.attempt_count).toBe(120);
  vi.setSystemTime(160_000);
  store.recordTransport(ids[1], diagnostic({ attempt_count: 121 }));
  store.recordRecipientTransport('local', { checked_at: Date.now() });
  expect(write).toHaveBeenCalledTimes(1); expect(changed).toHaveBeenCalledTimes(1);
  const restored = new CollaborationStore(file);
  expect(restored.diagnostic(ids[1])?.attempt_count).toBe(121);
  expect(restored.getMessage('history')?.content.length).toBe(10_000_000);
  expect(restored.getMessage(ids[0])?.status).toBe('pending');
});

it('does not amplify a blocked terminal check into a write/notification feedback loop', async () => {
  store.recordTransport(ids[0], diagnostic({ write_stage: 'paste_attempted', next_retry_at: null }), true);
  const write = vi.fn(), resolve = vi.fn(async () => ({ state: 'ready' as const, write }));
  const worker = new CollaborationDeliveryWorker({ store, isLocal: id => id === 'local', resolve, onError: error => { throw error; } });
  const rename = vi.spyOn(fs, 'renameSync');
  worker.start();
  try {
    await vi.advanceTimersByTimeAsync(10_000);
    expect(rename).not.toHaveBeenCalled(); expect(resolve).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
    expect(store.diagnostic(ids[0])?.checked_at).toBe(110_000);
    expect(new CollaborationStore(file).diagnostic(ids[0])?.write_stage).toBe('paste_attempted');
  } finally { worker.stop(); }
});

it.each([
  { last_error: 'PEER_UNREACHABLE', peer_reachable: false },
  { write_stage: 'paste_attempted' as const },
  { remote_received_at: 100_001 },
  { next_retry_at: null },
  { write_resolution: { action: 'retry' as const, attempt: 1, at: 100_001 } },
])('immediately saves changed delivery/recovery facts: %j', patch => {
  vi.setSystemTime(100_001);
  const write = vi.spyOn(fs, 'renameSync');
  store.recordTransport(ids[0], diagnostic(patch));
  expect(write).toHaveBeenCalledTimes(1);
  expect(new CollaborationStore(file).diagnostic(ids[0])).toMatchObject(patch);
});

it('never throttles a requested durable pre-write barrier, including an identical diagnostic', () => {
  const current = store.diagnostic(ids[0])!;
  const fsync = vi.spyOn(fs, 'fsyncSync');
  store.recordTransport(ids[0], current, true);
  expect(fsync).toHaveBeenCalledTimes(2);
  fsync.mockImplementationOnce(() => { throw new Error('disk unavailable'); });
  expect(() => store.recordTransport(ids[0], current, true)).toThrow('disk unavailable');
});

it('persists the first attempt and route changes for an entire recipient queue', () => {
  store.recordTransport(ids[0], diagnostic({ attempt_count: 0, write_stage: undefined }));
  store.recordTransport(ids[0], diagnostic({ attempt_count: 1 }));
  expect(new CollaborationStore(file).diagnostic(ids[0])?.attempt_count).toBe(1);
  store.recordRecipientTransport('local', { checked_at: Date.now(), route_state: 'identity-mismatch', last_error: 'TMUX_PANE_CHANGED' });
  expect(new CollaborationStore(file).diagnostic(ids[0])).toMatchObject({ route_state: 'identity-mismatch', last_error: 'TMUX_PANE_CHANGED' });
});

it('saves live counters with a real message change and never replays an uncertain terminal write after restart', async () => {
  vi.setSystemTime(100_500);
  store.recordTransport(ids[1], diagnostic({ attempt_count: 25 }));
  store.recordTransport(ids[0], diagnostic({ write_stage: 'paste_attempted' }), true);
  store = new CollaborationStore(file);
  expect(store.diagnostic(ids[1])?.attempt_count).toBe(25);
  const write = vi.fn(), resolve = vi.fn(async () => ({ state: 'ready' as const, write }));
  const worker = new CollaborationDeliveryWorker({ store, isLocal: () => true, resolve, onError: () => {} });
  await worker.run('local');
  expect(write).not.toHaveBeenCalled(); expect(resolve).not.toHaveBeenCalled();
  store.markDelivered([ids[1]]);
  expect(new CollaborationStore(file).getMessage(ids[1])?.status).toBe('delivered');
});

it('skips identical diagnostics and snapshots, even when a checkpoint would be due', () => {
  store.setSnapshot(ids[0], 'same screen');
  const current = store.diagnostic(ids[0])!;
  vi.setSystemTime(200_000);
  const write = vi.spyOn(fs, 'renameSync');
  for (let i = 0; i < 50; i++) { store.recordTransport(ids[0], current); store.setSnapshot(ids[0], 'same screen'); }
  expect(write).not.toHaveBeenCalled();
});
