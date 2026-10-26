import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { CollaborationStore } from './collaborationStore';

let dir: string;
afterEach(() => { vi.restoreAllMocks(); if (dir) fs.rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-resolve-write-')); const file = path.join(dir, 'messages.json');
  const store = new CollaborationStore(file), group = store.save({ name: 'Resolution', sessionIds: ['source', 'target'] });
  const [message] = store.send({ groupId: group.id, fromSessionId: 'source', toSessionIds: ['target'], kind: 'ask', content: 'Original' });
  const diagnostic = { relay_online: null, peer_reachable: true, attempt_count: 1, next_retry_at: null, last_error: 'DELIVERY_OUTCOME_UNCONFIRMED', checked_at: Date.now(), write_stage: 'paste_written' as const };
  store.recordTransport(message.id, diagnostic);
  return { store, message, file, diagnostic };
}
it('allows only the recipient to explicitly retry the original message and rejects stale repeated decisions', () => {
  const f = fixture();
  expect(() => f.store.resolveUnconfirmedDelivery(f.message.id, 'source', 'retry', 1)).toThrow('Only the recipient');
  expect(() => f.store.resolveUnconfirmedDelivery(f.message.id, 'target', 'retry', 2)).toThrow('Refresh');
  f.store.resolveUnconfirmedDelivery(f.message.id, 'target', 'retry', 1);
  f.store.resolveUnconfirmedDelivery(f.message.id, 'target', 'retry', 1);
  const restarted = new CollaborationStore(f.file);
  expect(restarted.hasUnconfirmedDelivery('target')).toBe(false);
  expect(restarted.getMessage(f.message.id)).toMatchObject({ id: f.message.id, content: 'Original', status: 'pending' });
  restarted.recordTransport(f.message.id, { ...f.diagnostic, attempt_count: 2, checked_at: Date.now() });
  expect(() => restarted.resolveUnconfirmedDelivery(f.message.id, 'target', 'retry', 1)).toThrow('Refresh');
});
it('stops an explicitly cancelled uncertain message without fabricating a terminal write or blocking later work', () => {
  const f = fixture(); f.store.resolveUnconfirmedDelivery(f.message.id, 'target', 'cancel', 1);
  f.store.resolveUnconfirmedDelivery(f.message.id, 'target', 'cancel', 1);
  expect(f.store.receipt(f.message.id)).toMatchObject({ status: 'failed', delivered_at: null, failure_reason: 'DELIVERY_CANCELLED_BY_OWNER' });
  expect(f.store.pendingCount('target')).toBe(0); expect(f.store.hasUnconfirmedDelivery('target')).toBe(false);
});
it('retries a cleaned input probe immediately with an attempt fence and never duplicates an active or completed write', () => {
  const f = fixture();
  f.store.recordTransport(f.message.id, { ...f.diagnostic, write_stage: 'not_started', last_error: 'TERMINAL_WRITE_FAILED: TERMINAL_INPUT_ECHO_UNCONFIRMED' });
  f.store.resolveUnconfirmedDelivery(f.message.id, 'target', 'retry', 1);
  expect(f.store.diagnostic(f.message.id)).toMatchObject({ write_stage: 'not_started', next_retry_at: null, last_error: null });
  f.store.resolveUnconfirmedDelivery(f.message.id, 'target', 'retry', 1);
  f.store.recordTransport(f.message.id, { ...f.diagnostic, attempt_count: 2, write_stage: 'probe_attempted', last_error: 'DELIVERY_IN_PROGRESS', checked_at: Date.now() + 1 });
  expect(() => f.store.resolveUnconfirmedDelivery(f.message.id, 'target', 'retry', 1)).toThrow('Refresh');
  expect(() => f.store.resolveUnconfirmedDelivery(f.message.id, 'target', 'retry', 2)).toThrow('Refresh');
  f.store.markDelivered([f.message.id]);
  expect(() => f.store.resolveUnconfirmedDelivery(f.message.id, 'target', 'retry', 2)).toThrow('Refresh');
});
it('can wake an initial route failure without starting a second message or bypassing an active writer', () => {
  const f = fixture();
  f.store.recordTransport(f.message.id, { ...f.diagnostic, attempt_count: 0, write_stage: undefined, last_error: 'ROUTE_RECOVERY_FAILED: TMUX_LAYOUT_UNAVAILABLE', next_retry_at: Date.now() + 30000 });
  expect(() => f.store.resolveUnconfirmedDelivery(f.message.id, 'target', 'cancel', 0)).toThrow('observed attempt');
  f.store.resolveUnconfirmedDelivery(f.message.id, 'target', 'retry', 0);
  expect(f.store.diagnostic(f.message.id)).toMatchObject({ attempt_count: 0, write_stage: 'not_started', last_error: null, next_retry_at: null });
  expect(f.store.inbox('target')).toHaveLength(1);
});
it('rolls back a resolution that could not be durably persisted', () => {
  const f = fixture(); vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('disk full'); });
  expect(() => f.store.resolveUnconfirmedDelivery(f.message.id, 'target', 'retry', 1)).toThrow('disk full');
  expect(f.store.hasUnconfirmedDelivery('target')).toBe(true);
  expect(new CollaborationStore(f.file).hasUnconfirmedDelivery('target')).toBe(true);
});
