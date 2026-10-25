import { afterEach, expect, it, vi } from 'vitest';
import * as authProtection from '../utils/authProtection.js';
import { once } from 'node:events';
import { createServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { X509Certificate } from 'node:crypto';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createFederationRuntime } from '../federation/runtime.js';
import { createIdentity } from '../federation/secureProtocol.js';
import { RelayRouter } from '../federation/relay.js';
import { attachRegisteredDirectTargets } from '../federation/directRoutes.js';
import { CollaborationService } from './collaborationService.js';
import { withPeerEndpoint } from './collaborationEndpoints.js';
import { CollaborationStore } from './collaborationStore.js';
import { connectCollaborationRpc, remoteSession, type CollaborationNode, type CollaborationPeerTransport, type CollaborationRpc } from './collaborationPeerTransport.js';

const cleanup: Array<() => void> = [];
afterEach(() => { cleanup.splice(0).reverse().forEach(close => close()); vi.restoreAllMocks(); });
it.each(['direct', 'relay-only', 'saved-address'] as const)('sends and replies without groups over verified WSS + Noise (%s), without a page or plaintext business HTTP', async mode => {
  vi.spyOn(authProtection, 'getPasswordVerifier').mockReturnValue(`scrypt$${'0'.repeat(32)}$${'1'.repeat(128)}`);
  const dir = mkdtempSync(join(tmpdir(), 'td-direct-wire-')); cleanup.push(() => rmSync(dir, { force: true, recursive: true }));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'ca.pem'), '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost'], { stdio: 'ignore' });
  const ca = readFileSync(join(dir, 'ca.pem')), key = readFileSync(join(dir, 'key.pem'));
  const sourceIdentity = await createIdentity();
  const sourceStore = new CollaborationStore(join(dir, 'source.json')), targetStore = new CollaborationStore(join(dir, 'target.json'));
  let sourceService: CollaborationService, targetService: CollaborationService, writes = 0, plaintext = 0;
  const reverse = new Map<string, CollaborationRpc>();
  const runtime = await createFederationRuntime(express(), join(dir, 'runtime'), { terminal() {}, control() {} }, {
    collaborationService: (subject, packet) => targetService.receive(subject, packet),
    collaborationConnected: (subject, rpc) => { reverse.set(subject, rpc); return () => { if (reverse.get(subject) === rpc) reverse.delete(subject); }; },
  });
  cleanup.push(() => runtime.close());
  const server = createServer({ cert: ca, key }, (req, res) => {
    if (req.url?.startsWith('/api/terminal')) plaintext++;
    if (req.url === '/onboarding/ca.crt') res.end(ca); else res.writeHead(404).end();
  });
  const sockets = new WebSocketServer({ server });
  sockets.on('connection', (socket, request) => void runtime.accept(socket, { relayed: request.url === '/api/federation/relay-target' }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  cleanup.push(() => { for (const socket of sockets.clients) socket.terminate(); sockets.close(); server.close(); });
  const target: CollaborationNode = { serviceId: runtime.serviceId, origin: `https://127.0.0.1:${(server.address() as { port: number }).port}`, caFingerprint256: new X509Certificate(ca).fingerprint256 };
  const source: CollaborationNode = { serviceId: sourceIdentity.peerId, origin: 'https://source.test' };
  let relayOrigin: string | undefined;
  if (mode === 'relay-only') {
    const router = new RelayRouter<string>({ authenticate: context => String(context), allowRegister: () => false, allowRoute: (subject, id) => subject === 'source' && id === target.serviceId });
    cleanup.push(() => router.close());
    cleanup.push(attachRegisteredDirectTargets(router, [{ serviceId: target.serviceId, url: target.origin, caPath: join(dir, 'ca.pem') }]));
    const entry = createServer({ cert: ca, key }, (req, res) => { if (req.url === '/onboarding/ca.crt') res.end(ca); else res.writeHead(404).end(); });
    const wss = new WebSocketServer({ server: entry });
    wss.on('connection', socket => { void router.attach(socket, 'source').then(ok => { if (ok) socket.send(JSON.stringify({ type: 'ready' })); }); });
    entry.listen(0, '127.0.0.1'); await once(entry, 'listening');
    cleanup.push(() => { for (const socket of wss.clients) socket.terminate(); wss.close(); entry.close(); });
    relayOrigin = `https://127.0.0.1:${(entry.address() as { port: number }).port}`;
  }
  const transport = { registeredNodes: () => [] } as unknown as CollaborationPeerTransport;
  const session = (sessionId: string) => ({ sessionId, name: sessionId, cwd: '', status: 'shell', capability: '', updatedAt: 1, agent: null });
  targetService = new CollaborationService({ file: join(dir, 'target-service.json'), store: targetStore, node: () => ({ serviceId: target.serviceId, caFingerprint256: target.caFingerprint256 }), sessions: () => [session('target'), session('private')], transport,
    reverse: id => reverse.get(id), connect: async () => { throw new Error('Target cannot connect to source directly'); },
    deliver: id => { for (const message of targetStore.inbox(id, { pendingOnly: true })) { writes++; targetStore.markDelivered([message.id]); targetStore.setSnapshot(message.id, 'PRIVATE SCREEN'); } } });
  sourceService = new CollaborationService({ file: join(dir, 'source-service.json'), store: sourceStore, node: () => ({ serviceId: source.serviceId }), sessions: () => [session('sender')], transport,
    deliver: id => { for (const message of sourceStore.inbox(id, { pendingOnly: true })) sourceStore.markDelivered([message.id]); },
    connect: peer => relayOrigin ? connectCollaborationRpc(sourceIdentity, { ...peer, origin: relayOrigin }, `${relayOrigin.replace('https:', 'wss:')}/api/federation/relay`, packet => sourceService.receive(peer.serviceId, packet))
      : mode === 'saved-address' ? withPeerEndpoint(peer, [{ serviceId: target.serviceId, url: target.origin, certificateFingerprint256: target.caFingerprint256!.replaceAll(':', '') }], dir,
        (node, ca, pin) => connectCollaborationRpc(sourceIdentity, node, undefined, packet => sourceService.receive(peer.serviceId, packet), ca, pin))
        : connectCollaborationRpc(sourceIdentity, peer, undefined, packet => sourceService.receive(peer.serviceId, packet)),
  });
  cleanup.push(() => { sourceService.close(); targetService.close(); });
  const advertised = mode === 'saved-address' ? { ...target, origin: `https://${target.serviceId.toLowerCase()}.localhost` } : target;
  targetService.connectKnown(target.origin, [source, target]); sourceService.connectKnown(source.origin, [source, advertised]);
  await sourceService.refresh(); await targetService.refresh();
  const targetSession = remoteSession(advertised.origin, 'target'); expect(sourceService.resolveDirectContact(targetSession), JSON.stringify(sourceService.directory().services)).toBe(targetSession);
  const message = sourceStore.sendDirect({ fromSessionId: 'sender', toSessionIds: [targetSession], kind: 'ask', content: '跨服务证据\n'.repeat(24000), idempotencyKey: 'wire-direct' })[0];
  await sourceService.flushDirect();
  expect(sourceStore.receipt(message.id)).toMatchObject({ status: 'delivered', snapshot: null });
  expect(targetStore.getMessage(message.id)?.content).toBe(message.content); expect(writes).toBe(1);
  const reply = targetStore.sendDirect({ fromSessionId: 'target', toSessionIds: [remoteSession(source.origin, 'sender')], kind: 'reply', content: '完成', replyTo: message.id, threadId: message.threadId, responseKind: 'result' })[0];
  await targetService.flushDirect();
  expect(sourceStore.receipt(message.id).result_ids).toEqual([reply.id]);
  expect(targetStore.receipt(reply.id)).toMatchObject({ status: 'delivered', snapshot: null });
  expect(sourceStore.list()).toEqual([]); expect(targetStore.list()).toEqual([]);
  expect(plaintext).toBe(0);
  const stranger = await connectCollaborationRpc(await createIdentity(), target); cleanup.push(() => stranger.close());
  await expect(stranger.request({ type: 'collaboration-service', action: 'direct-message', message })).rejects.toThrow('COLLABORATION_PAIRING_REQUIRED');
  await expect(connectCollaborationRpc(sourceIdentity, { ...target, caFingerprint256: Array(32).fill('00').join(':') })).rejects.toThrow();
  if (mode === 'saved-address') {
    await expect(withPeerEndpoint(target, [{ serviceId: target.serviceId, url: target.origin, certificateFingerprint256: '00'.repeat(32) }], dir,
      (node, ca, pin) => connectCollaborationRpc(sourceIdentity, node, undefined, undefined, ca, pin))).rejects.toThrow();
  }
}, 20000);
