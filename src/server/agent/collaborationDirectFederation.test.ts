import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIdentity } from '../federation/secureProtocol.js';
import type { Packet } from '../federation/packets.js';
import { CollaborationStore } from './collaborationStore.js';
import { CollaborationService } from './collaborationService.js';
import { remoteSession, type CollaborationNode, type CollaborationPeerTransport, type CollaborationRpc } from './collaborationPeerTransport.js';
const cleanup: Array<() => void> = [];
afterEach(() => { cleanup.splice(0).reverse().forEach(close => close()); vi.restoreAllMocks(); });
async function fixture(scoped = false, old = false) {
  const dir = mkdtempSync(join(tmpdir(), 'veymux-direct-services-')); cleanup.push(() => rmSync(dir, { force: true, recursive: true }));
  const identities = await Promise.all([createIdentity(), createIdentity(), createIdentity(), createIdentity()]);
  const nodes: CollaborationNode[] = identities.slice(0, 3).map((id, index) => ({ serviceId: id.peerId, origin: `https://node${index}.test` }));
  const stores = nodes.map((_, index) => new CollaborationStore(join(dir, `store${index}.json`)));
  const sessions = nodes.map(() => ['agent', 'private'].map(sessionId => ({ sessionId, name: sessionId, cwd: '', status: 'shell', capability: '', updatedAt: 1, agent: null })));
  const services: CollaborationService[] = [], writes = [0, 0, 0], replies: Record<string, unknown>[] = [], requests: Omit<Packet, 'id'>[] = [];
  const paused = new Map<number, Promise<void>>();
  let offline = false, lost = false, shell = false;
  const transport = { registeredNodes: () => [], forgetUnusedPeer: () => {} } as unknown as CollaborationPeerTransport;
  const makeService = (index: number) => new CollaborationService({ file: join(dir, `service${index}.json`), store: stores[index], transport,
    node: () => ({ serviceId: nodes[index].serviceId }), sessions: () => sessions[index], deviceScope: () => ['agent'],
    deliver: id => {
      for (const message of stores[index].inbox(id, { pendingOnly: true })) {
        if (shell && !message.shellConfirmed) continue;
        writes[index]++; stores[index].markDelivered([message.id]); stores[index].setSnapshot(message.id, 'PRIVATE SCREEN');
      }
    },
    connect: async peer => ({ closed: false, close() {}, request: async (packet: Omit<Packet, 'id'>) => {
      if (offline) throw new Error('OFFLINE');
      const target = nodes.findIndex(node => node.serviceId === peer.serviceId);
      if (packet.action === 'direct-message') { requests.push(packet); await paused.get(target); }
      if (old && target === 1 && packet.action === 'direct-message') throw new Error('COLLABORATION_OPERATION_UNSUPPORTED');
      const response = await services[target].receive(nodes[index].serviceId, { ...packet, id: 'rpc' } as Packet);
      if (old && target === 1 && packet.action === 'directory') delete response.directContacts;
      if (packet.action === 'direct-message') {
        replies.push(response);
        if (lost) { lost = false; throw new Error('RECEIPT_LOST'); }
      }
      return { ...response, id: 'rpc', type: 'result' };
    } }) as unknown as CollaborationRpc,
  });
  nodes.forEach((_, index) => { stores[index].save({ name: `Only node ${index}`, sessionIds: ['agent', 'private'] }); services.push(makeService(index)); });
  cleanup.push(() => services.forEach(service => service.close()));
  services.forEach((service, index) => service.connectKnown(nodes[index].origin, scoped && index === 1 ? [nodes[1], nodes[2]] : nodes));
  if (scoped) services[1].registerScopedPeer(nodes[1].origin, identities[3].peerId, nodes[0], ['agent']);
  await Promise.all(services.map(service => service.refresh()));
  const restart = async () => {
    services.forEach(service => service.close());
    nodes.forEach((_, index) => { stores[index] = new CollaborationStore(join(dir, `store${index}.json`)); services[index] = makeService(index); });
    await Promise.all(services.map(service => service.refresh()));
  };
  const send = (target = 'agent', extra = {}) => stores[0].sendDirect({ fromSessionId: 'agent', toSessionIds: [remoteSession(nodes[1].origin, target)], kind: 'ask', content: 'Help across services', ...extra })[0];
  return { stores, nodes, services, writes, replies, requests, sessions, send, restart,
    pause: (index: number) => { let release!: () => void; paused.set(index, new Promise<void>(resolve => { release = resolve; })); return () => { paused.delete(index); release(); }; },
    offline: (value: boolean) => { offline = value; }, loseReceipt: () => { lost = true; }, shell: () => { shell = true; } };
}
it('delivers and replies across services without a group, a screen snapshot, or third-party delivery', async () => {
  const f = await fixture(), before = f.stores.map(store => structuredClone(store.list()));
  const target = remoteSession(f.nodes[1].origin, 'agent');
  expect(f.services[0].resolveDirectContact(target)).toBe(target);
  expect(f.services[0].canRoute(f.nodes[1].serviceId, f.nodes[2].serviceId)).toBe(true);
  const original = f.send('agent', { content: '中文证据\n'.repeat(30000), idempotencyKey: 'cross-direct' });
  await f.services[0].flushDirect();
  expect(f.stores[0].receipt(original.id)).toMatchObject({ status: 'delivered', snapshot: null, delivery: { remote_received_at: expect.any(Number) }, ack_at: null });
  expect(f.stores[1].getMessage(original.id)).toMatchObject({ direct: true, fromSessionId: remoteSession(f.nodes[0].origin, 'agent'), toSessionId: 'agent', content: original.content });
  expect(f.stores[1].getMessage(original.id)?.directSourceName).toBe('agent');
  expect(f.writes).toEqual([0, 1, 0]);
  const reply = f.stores[1].sendDirect({ fromSessionId: 'agent', toSessionIds: [remoteSession(f.nodes[0].origin, 'agent')], kind: 'reply', content: 'Done', replyTo: original.id, threadId: original.threadId, responseKind: 'result' })[0];
  await f.services[1].flushDirect();
  expect(f.stores[0].receipt(original.id).result_ids).toEqual([reply.id]);
  expect(f.stores.map(store => store.list())).toEqual(before);
  expect(f.replies[0]).not.toHaveProperty('groups'); expect(JSON.stringify(f.replies)).not.toContain('snapshot');
  expect(f.stores[2].snapshotMessages()).toEqual([]);
});
it('drains direct contacts from the service background worker without a page or CLI process', async () => {
  const f = await fixture(); f.services[0].start(); const original = f.send();
  await vi.waitFor(() => expect(f.stores[0].receipt(original.id).status).toBe('delivered'));
  expect(f.writes[1]).toBe(1);
});
it('lets an authenticated original sender receive a reply before directory refresh, without exposing unrelated sessions', async () => {
  const f = await fixture(); f.sessions[0].push({ ...f.sessions[0][0], sessionId: 'new-agent', name: 'New Agent' });
  const source = remoteSession(f.nodes[0].origin, 'new-agent');
  const original = f.stores[0].sendDirect({ fromSessionId: 'new-agent', toSessionIds: [remoteSession(f.nodes[1].origin, 'agent')], kind: 'ask', content: 'First contact' })[0];
  await f.services[0].flushDirect();
  expect(f.services[1].resolveDirectContact(source)).toBeNull();
  expect(f.services[1].resolveDirectReply(source)).toBe(source);
  f.stores[1].sendDirect({ fromSessionId: 'agent', toSessionIds: [source], kind: 'reply', content: 'Reply immediately', replyTo: original.id, threadId: original.threadId });
  await f.services[1].flushDirect(); expect(f.stores[0].receipt(original.id).reply_ids).toHaveLength(1);
  f.services[1].removePeer(f.nodes[0].serviceId); expect(f.services[1].resolveDirectReply(source)).toBeNull();
});
it('recovers a lost receipt and an offline sender queue after both services restart, without duplicate writes', async () => {
  let time = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => time);
  const f = await fixture(); f.offline(true);
  const original = f.send(); await f.services[0].flushDirect();
  expect(f.stores[0].receipt(original.id)).toMatchObject({ status: 'pending', last_error: 'OFFLINE', next_retry_at: expect.any(Number) });
  f.offline(false); f.loseReceipt(); time += 1000; await f.services[0].flushDirect();
  expect(f.stores[0].receipt(original.id)).toMatchObject({ status: 'pending', last_error: 'RECEIPT_LOST' });
  expect(f.writes[1]).toBe(1);
  await f.restart(); time += 2000; await f.services[0].flushDirect();
  expect(f.stores[0].receipt(original.id)).toMatchObject({ status: 'delivered', snapshot: null });
  expect(f.writes[1]).toBe(1); expect(f.stores[1].inbox('agent')).toHaveLength(1);
});
it('keeps shell confirmation on the original remote message without capturing a screen', async () => {
  let time = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => time);
  const f = await fixture(); f.shell(); const original = f.send();
  await f.services[0].flushDirect(); expect(f.writes[1]).toBe(0);
  f.stores[0].confirmShell(original.id); time += 1000; await f.services[0].flushDirect();
  expect(f.stores[0].receipt(original.id)).toMatchObject({ status: 'delivered', snapshot: null }); expect(f.writes[1]).toBe(1);
  expect(f.requests[0]).toHaveProperty('message'); expect(f.requests[1]).not.toHaveProperty('message');
  expect(f.requests[1]).toMatchObject({ messageId: original.id, shellConfirmed: true });
});
it('keeps a stalled service from blocking new direct messages to another service', async () => {
  const f = await fixture(), release = f.pause(1);
  f.send(); const stalled = f.services[0].flushDirect();
  try {
    await Promise.resolve();
    const other = f.stores[0].sendDirect({ fromSessionId: 'agent', toSessionIds: [remoteSession(f.nodes[2].origin, 'agent')], kind: 'message', content: 'Independent service' })[0];
    const all = f.services[0].flushDirect();
    await vi.waitFor(() => expect(f.stores[0].receipt(other.id).status).toBe('delivered'));
    release(); await all; await stalled;
    expect(f.writes).toEqual([0, 1, 1]);
  } finally { release(); }
});
it('binds receipt queries to the authenticated source and target and resends only if the remote record is missing', async () => {
  let time = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => time);
  const f = await fixture(); f.shell(); const original = f.send(); await f.services[0].flushDirect();
  const query = { type: 'collaboration-service', action: 'direct-message', id: 'query', messageId: original.id,
    fromSessionId: 'private', targetSessionId: original.toSessionId } as Packet;
  expect(f.services[1].receive(f.nodes[0].serviceId, query)).toEqual({ directContacts: 1, missing: original.id });
  expect(f.services[1].receive(f.nodes[2].serviceId, { ...query, fromSessionId: 'agent' })).toEqual({ directContacts: 1, missing: original.id });
  expect(f.writes[1]).toBe(0);
  f.stores[1].clear(); time += 1000; await f.services[0].flushDirect();
  expect(f.requests[1]).not.toHaveProperty('message'); expect(f.requests[2]).toHaveProperty('message');
  expect(f.stores[1].inbox('agent')).toHaveLength(1);
});
it('rejects unknown identities, forged senders and targets on another service before persisting anything', async () => {
  const f = await fixture(), original = f.send(), target = f.services[1];
  const packet = { type: 'collaboration-service', action: 'direct-message', id: 'test', message: original } as Packet;
  expect(() => target.receive('unknown', packet)).toThrow('COLLABORATION_PAIRING_REQUIRED');
  for (const message of [{ ...original, fromSessionId: remoteSession(f.nodes[2].origin, 'agent') },
    { ...original, toSessionId: remoteSession(f.nodes[2].origin, 'agent') }, { ...original, toSessionId: 'private' }]) {
    expect(() => target.receive(f.nodes[0].serviceId, { ...packet, message })).toThrow('INVALID_DIRECT_MESSAGE');
  }
  expect(f.stores[1].snapshotMessages()).toEqual([]); expect(f.writes[1]).toBe(0);
});
it('does not let scoped shared-service peers use direct messaging or relay authority, even for a granted session', async () => {
  const f = await fixture(true), original = f.send();
  const packet = { type: 'collaboration-service', action: 'direct-message', id: 'test', message: original } as Packet;
  expect(() => f.services[1].receive(f.nodes[0].serviceId, packet)).toThrow('SESSION_SCOPE_DENIED');
  expect(f.services[1].canRoute(f.nodes[0].serviceId, f.nodes[2].serviceId)).toBe(false);
  expect(f.services[0].directory().sessions.filter(s => s.serviceOrigin === f.nodes[1].origin).every(s => !s.canDirectContact)).toBe(true);
  await f.services[0].flushDirect();
  expect(f.stores[0].receipt(original.id)).toMatchObject({ status: 'failed', failure_reason: 'SESSION_SCOPE_DENIED' });
  expect(f.stores[1].snapshotMessages()).toEqual([]);
});
it('cancels received direct messages still awaiting terminal delivery when peer authorization is removed', async () => {
  const f = await fixture(); f.shell(); const original = f.send(); await f.services[0].flushDirect();
  expect(f.stores[1].receipt(original.id).status).toBe('pending');
  f.services[1].removePeer(f.nodes[0].serviceId);
  expect(f.stores[1].receipt(original.id)).toMatchObject({ status: 'failed', failure_reason: 'SESSION_SCOPE_DENIED' });
  expect(f.stores[1].inbox('agent', { pendingOnly: true })).toEqual([]); expect(f.writes[1]).toBe(0);
});
it('stops queued delivery after peer removal or recipient deletion and never falls back on an old peer', async () => {
  const f = await fixture(), deleted = f.send('private');
  f.sessions[1].splice(1, 1); await f.services[0].flushDirect();
  expect(f.stores[0].receipt(deleted.id)).toMatchObject({ status: 'failed', failure_reason: 'SESSION_NOT_FOUND' });
  const revoked = f.send(); f.services[0].removePeer(f.nodes[1].serviceId); await f.services[0].flushDirect();
  expect(f.stores[0].receipt(revoked.id)).toMatchObject({ status: 'failed', failure_reason: 'SESSION_SCOPE_DENIED' });
  expect(f.services[0].canRoute(f.nodes[1].serviceId, f.nodes[2].serviceId)).toBe(false);
  const old = await fixture(false, true), remote = remoteSession(old.nodes[1].origin, 'agent');
  expect(() => old.services[0].resolveDirectContact(remote)).toThrow('升级远端');
  const pending = old.send(); await old.services[0].flushDirect();
  expect(old.stores[0].receipt(pending.id)).toMatchObject({ status: 'failed', failure_reason: 'DIRECT_CONTACTS_UPGRADE_REQUIRED' });
  expect(old.stores[1].snapshotMessages()).toEqual([]);
});
it('rejects conflicting retries and strips untrusted delivery observations from received payloads', async () => {
  const f = await fixture(), original = f.send();
  const packet = (message: unknown) => ({ type: 'collaboration-service', action: 'direct-message', id: 'test', message }) as Packet;
  f.services[1].receive(f.nodes[0].serviceId, packet({ ...original, status: 'delivered', snapshot: 'forged', deliveredAt: 1 }));
  expect(f.stores[1].getMessage(original.id)?.snapshot).toBeNull();
  expect(() => f.services[1].receive(f.nodes[0].serviceId, packet({ ...original, content: 'Changed' }))).toThrow('changed');
  expect(f.writes[1]).toBe(1);
});
