import { afterEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { connect } from '../../lib/federation/secureClient.js';
import { RelaySocket } from '../../lib/federation/relaySocket.js';
import { readDeviceAuthorization } from '../../lib/federation/deviceAuthorization.js';
import { runCoordinatedServiceUpdate } from '../../lib/terminal/coordinatedServiceUpdate.js';
import type { ServiceUpdatePlan } from '../../lib/terminal/serviceUpdatePlan.js';
import { TermdockAutoUpdateManager } from '../utils/autoUpdate.js';
import { createFederationRuntime } from './runtime.js';
import { createIdentity } from './secureProtocol.js';
import { RelayRouter } from './relay.js';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const close of cleanups.splice(0).reverse()) close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it.each(['direct', 'relay', 'lost-reply', 'relay-denied'] as const)('coordinates real encrypted service updates (%s) without a worker or native bridge upload', async mode => {
  vi.stubEnv('TERMDOCK_PASSWORD', 'isolated-update-test-password'); vi.stubEnv('TERMDOCK_SUPERVISED', '1');
  const previous = Object.getOwnPropertyDescriptor(process, 'connected');
  Object.defineProperty(process, 'connected', { value: true, configurable: true });
  cleanups.push(() => { if (previous) Object.defineProperty(process, 'connected', previous); else Reflect.deleteProperty(process, 'connected'); });
  vi.stubGlobal('CloseEvent', class extends Event { code: number; reason: string; constructor(type: string, init: { code: number; reason: string }) { super(type); this.code = init.code; this.reason = init.reason; } });
  const oldUpload = vi.fn();
  vi.stubGlobal('window', { termdockDesktop: { uploadDroppedFiles: oldUpload, pasteClipboardImage: oldUpload } });
  vi.stubGlobal('navigator', { serviceWorker: { controller: null } });
  const realFetch = globalThis.fetch;
  const http = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    // The only native business HTTP is the runtime's private authenticated hop.
    expect(new Headers(init?.headers).has('x-termdock-inner')).toBe(true);
    return realFetch(input, init);
  });
  const dir = mkdtempSync(join(tmpdir(), 'td-service-update-')); cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost'], { stdio: 'ignore' });
  const ca = readFileSync(join(dir, 'cert.pem')), key = readFileSync(join(dir, 'key.pem'));
  const identity = await createIdentity(), restarts: string[] = [], installs: string[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>(); cleanups.push(() => timers.forEach(clearTimeout));
  async function node(label: string) {
    const app = express(); app.use(express.json());
    const sockets = new Set<WebSocket>();
    const managerFor = (currentVersion: string): TermdockAutoUpdateManager => new TermdockAutoUpdateManager({
      currentVersion, broadcast() {}, verifyInstalled() {}, verifyRestartEntry() {},
      updateRunner: async () => { installs.push(label); return { status: 'updated', currentVersion, latestVersion: '1.0.1', source: 'official' }; },
      requestRestart() {
        restarts.push(label);
        const restart = () => { manager = managerFor('1.0.1'); for (const ws of sockets) ws.terminate(); };
        if (mode === 'lost-reply' && label === 'target') restart();
        else { const timer = setTimeout(() => { timers.delete(timer); restart(); }, 25); timers.add(timer); }
      },
    });
    let manager = managerFor('1.0.0');
    app.get('/api/terminal/update', (_req, res) => res.json(manager.getState()));
    app.post('/api/terminal/update/check', (_req, res) => { void manager.checkNow(); res.status(202).json(manager.getState()); });
    app.post('/api/terminal/update/prepare-restart', (req, res) => res.json(manager.prepareRestart(req.body.version)));
    app.post('/api/terminal/update/restart', (req, res) => res.status(202).json(manager.confirmRestart(req.body.version)));
    const runtime = await createFederationRuntime(app, join(dir, label), { terminal() {}, control() {} }); cleanups.push(() => runtime.close());
    runtime.store.grant({ subjectId: identity.peerId, scope: { kind: 'service' }, actions: mode === 'relay-denied' && label === 'entry' ? ['service.view'] : ['service:*'] });
    const server = createServer({ cert: ca, key }), wss = new WebSocketServer({ server });
    wss.on('connection', (ws, req) => { sockets.add(ws); ws.once('close', () => sockets.delete(ws)); void runtime.accept(ws, { relayed: req.url === '/relay-target' }); });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    cleanups.push(() => { for (const ws of wss.clients) ws.terminate(); wss.close(); server.close(); });
    return { id: runtime.serviceId, url: `wss://127.0.0.1:${(server.address() as { port: number }).port}`, manager };
  }
  const target = await node('target'), entry = await node('entry');
  await target.manager.checkNow(); // Only the target has already advertised an update.
  const dial = (url: string) => new WebSocket(url, { ca });
  const router = new RelayRouter({ authenticate: value => value as string, allowRegister: () => false, allowRoute: p => p === 'phone' });
  cleanups.push(() => router.close());
  router.registerDirect(target.id, async () => { const ws = dial(target.url + '/relay-target'); await once(ws, 'open'); return ws; });
  const relayServer = createServer({ cert: ca, key }), relaySockets = new WebSocketServer({ server: relayServer });
  relaySockets.on('connection', ws => { void router.attach(ws, 'phone').then(ok => { if (ok) ws.send(JSON.stringify({ type: 'ready' })); }); });
  relayServer.listen(0, '127.0.0.1'); await once(relayServer, 'listening');
  cleanups.push(() => { for (const ws of relaySockets.clients) ws.terminate(); relaySockets.close(); relayServer.close(); });
  const relayUrl = `wss://127.0.0.1:${(relayServer.address() as { port: number }).port}`;
  const plan: ServiceUpdatePlan = { targetId: target.id, relayId: entry.id, interfaceId: entry.id, nodes: [
    { role: 'target', label: 'target', intent: { targetPeerId: target.id, url: mode === 'direct' ? target.url : relayUrl, entryServiceId: entry.id } },
    { role: 'relay', label: 'entry', intent: { targetPeerId: entry.id, url: entry.url } },
  ] };
  const reload = vi.fn(async () => {});
  const action = runCoordinatedServiceUpdate(plan, '1.0.1', {
    current: () => true, chinese: false, progress() {}, reload, pause: () => new Promise(resolve => setTimeout(resolve, 30)),
    async open(item, signal) {
      const client = await connect({ url: item.intent.url, targetPeerId: item.intent.targetPeerId, identity, signal,
        socketFactory: mode !== 'direct' && item.role === 'target'
          ? url => new RelaySocket(url, target.id, value => dial(value) as unknown as globalThis.WebSocket) as unknown as globalThis.WebSocket
          : url => dial(url) as unknown as globalThis.WebSocket });
      try {
        if (!(await readDeviceAuthorization(client)).fullService) throw new Error('Service management permission required');
        return client;
      } catch (error) { client.close(); throw error; }
    },
  });
  if (mode === 'relay-denied') {
    await expect(action).rejects.toThrow('permission required');
    expect(installs).toEqual(['target']); expect(restarts).toEqual([]); expect(reload).not.toHaveBeenCalled();
  } else {
    await expect(action).resolves.toMatchObject({ currentVersion: '1.0.1' });
    expect(installs).toEqual(['target', 'entry']); expect(restarts).toEqual(['target', 'entry']); expect(reload).toHaveBeenCalledOnce();
  }
  if (mode === 'relay-denied') expect(http).not.toHaveBeenCalled();
  else expect(http).toHaveBeenCalled();
  expect(oldUpload).not.toHaveBeenCalled();
}, 15_000);
