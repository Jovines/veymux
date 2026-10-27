import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIdentity } from '../federation/secureProtocol.js';
import type { Packet } from '../federation/packets.js';
import { CollaborationService } from './collaborationService.js';
import { CollaborationStore } from './collaborationStore.js';
import { CollaborationPeerTransport, remoteSession, type CollaborationRpc } from './collaborationPeerTransport.js';

const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).reverse().forEach(close => close()));

async function fixture(loopback: boolean) {
  const directory = mkdtempSync(join(tmpdir(), 'veymux-origin-aliases-'));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const identities = await Promise.all([createIdentity(), createIdentity()]);
  const nodes = identities.map((identity, index) => ({ serviceId: identity.peerId,
    origin: loopback ? 'https://localhost:9834' : `https://node${index}.test` }));
  const stores = nodes.map((_, index) => new CollaborationStore(join(directory, `store${index}.json`)));
  const services: CollaborationService[] = [], transports: CollaborationPeerTransport[] = [];
  const writes = [0, 0];
  const deliver = (index: number, session: string) => {
    for (const message of stores[index].inbox(session, { pendingOnly: true })) {
      writes[index]++;
      stores[index].markDelivered([message.id]);
    }
  };
  const connect = (index: number, peer: { serviceId: string }) => Promise.resolve({
    closed: false, close() {},
    request: async (packet: Omit<Packet, 'id'>) => {
      const target = nodes.findIndex(node => node.serviceId === peer.serviceId);
      const wire = { ...packet, id: 'rpc' } as Packet;
      const result = packet.type === 'collaboration-exchange'
        ? transports[target].receive(nodes[index].serviceId, wire)
        : await services[target].receive(nodes[index].serviceId, wire);
      return { ...result, type: 'result', id: 'rpc' };
    },
  } as unknown as CollaborationRpc);
  nodes.forEach((node, index) => {
    transports.push(new CollaborationPeerTransport({ file: join(directory, `transport${index}.json`),
      serviceId: node.serviceId, store: stores[index], connect: peer => connect(index, peer),
      deliver: session => deliver(index, session) }));
    services.push(new CollaborationService({ file: join(directory, `service${index}.json`),
      store: stores[index], transport: transports[index], node: () => ({ serviceId: node.serviceId }),
      sessions: () => [{ sessionId: 'shell', name: `Node ${index}`, cwd: '', status: 'shell', capability: '', updatedAt: 1, agent: null }],
      connect: peer => connect(index, peer), deliver: session => deliver(index, session) }));
  });
  cleanup.push(() => { services.forEach(service => service.close()); transports.forEach(transport => transport.close()); });
  for (const [index, service] of services.entries()) {
    const directoryNodes = !loopback && index === 0
      ? [nodes[0], { ...nodes[1], origin: 'https://old-mac-address.test' }] : nodes;
    service.connectKnown(nodes[index].origin, directoryNodes);
  }
  await Promise.all(services.map(service => service.refresh()));
  return { nodes, services, stores, transports, writes };
}

for (const loopback of [false, true]) it(`replicates groups and messages across ${loopback ? 'two localhost services' : 'an existing stale address alias'}`, async () => {
  const f = await fixture(loopback);
  const remote = f.services[0].directory().sessions[0].sessionId;
  const { group } = await f.services[0].save({ name: 'Alias regression', sessionIds: ['shell', remote] });
  await f.services[0].refresh();
  const replica = f.stores[1].getGroup(group!.id)!;
  expect(replica.sessionIds).toContain('shell');
  expect(replica.sessionIds).toContain(f.services[1].directory().sessions[0].sessionId);
  expect(f.services[0].directory().services[0].connected).toBe(true);
  const first = f.stores[0].sendDirect({ fromSessionId: 'shell', toSessionIds: [remote], kind: 'ask', content: 'Direct alias test' })[0];
  await f.services[0].flushDirect();
  expect(f.stores[1].getMessage(first.id)?.toSessionId).toBe('shell');
  expect(f.stores[0].getMessage(first.id)?.status).toBe('delivered');
  const reverse = f.stores[1].sendDirect({ fromSessionId: 'shell', toSessionIds: [f.services[1].directory().sessions[0].sessionId], kind: 'ask', content: 'Reverse alias test' })[0];
  await f.services[1].flushDirect();
  expect(f.stores[0].getMessage(reverse.id)?.toSessionId).toBe('shell');
  // Repeated directory enrollment must retain the canonical local aliases.
  f.services[0].connectKnown(f.nodes[0].origin, f.nodes);
  expect(f.services[0].directory().sessions[0].sessionId).toBe(remote);
  const message = f.stores[0].send({ groupId: group!.id, fromSessionId: 'shell', toSessionIds: [remote], kind: 'ask', content: 'Group alias test' })[0];
  f.transports[0].start(); f.transports[1].start();
  await expect.poll(() => f.stores[0].getMessage(message.id)?.status).toBe('delivered');
  expect(f.stores[1].getMessage(message.id)?.toSessionId).toBe('shell');
  expect(f.writes).toEqual([1, 2]);
});

it('retains certificate and authenticated service boundaries when translating aliases', async () => {
  const f = await fixture(false);
  expect(() => f.services[0].connectKnown(f.nodes[0].origin,
    [f.nodes[0], { ...f.nodes[1], caFingerprint256: 'AA:'.repeat(31) + 'AA' }])).toThrow('PEER_IDENTITY_CHANGED');
  const packet = { type: 'collaboration-service', id: 'bad', action: 'direct-message',
    targetServiceId: f.nodes[0].serviceId, targetOrigin: f.nodes[1].origin,
    message: { fromSessionId: 'shell', toSessionId: remoteSession(f.nodes[1].origin, 'shell') } } as Packet;
  expect(() => f.services[1].receive(f.nodes[0].serviceId, packet)).toThrow('INVALID_DIRECT_MESSAGE');
  expect(f.writes).toEqual([0, 0]);
});
