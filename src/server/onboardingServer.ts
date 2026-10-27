import express from 'express';
import { createServer, type Server } from 'http';
import fs from 'fs';
import type { AddressInfo } from 'net';
import { createOnboardingRouter } from './routes/onboarding.js';
import { getLanIPv4Addresses } from './utils/localAccess.js';
import path from 'node:path';
import { VEYMUX_DIR, readJsonFile, writeJsonStateAtomic } from './utils/veymuxState.js';
import { onboardingFingerprint, sendOnboardingPage } from './onboardingPage.js';
import { WebSocketServer, type WebSocket } from 'ws';
import { isAllowedHost } from './utils/requestSecurity.js';

export interface OnboardingServerOptions {
  httpsPort: number;
  caCertPath?: string;
  clientPath?: string;
  acceptEncrypted?: (socket: WebSocket) => void;
  relayPrincipal?: (token: string | null) => unknown;
  acceptRelay?: (socket: WebSocket, principal: unknown) => Promise<boolean>;
}

export interface OnboardingServerState {
  server: Server | null;
  url: string | null;
}

let activeServer: Server | null = null;
let activeUrl: string | null = null;
let activeFingerprint: string | null = null;
let activeWebSockets: WebSocketServer | null = null;

function canStart(options: OnboardingServerOptions): boolean {
  return Boolean(options.caCertPath && fs.existsSync(options.caCertPath));
}

export function startOnboardingServer(options: OnboardingServerOptions): OnboardingServerState {
  stopOnboardingServer();
  if (!canStart(options)) {
    return { server: null, url: null };
  }

  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); next(); });
  app.get('/certificates', (req, res) => sendOnboardingPage(req, res, options));
  app.get(['/', '/connect'], (req, res) => {
    if (options.clientPath && options.acceptEncrypted) res.sendFile('index.html', { root: options.clientPath });
    else sendOnboardingPage(req, res, options);
  });
  app.use('/onboarding', createOnboardingRouter({ port: options.httpsPort, caCertPath: options.caCertPath }));
  app.get('/ca', (_req, res) => {
    if (!options.caCertPath || !fs.existsSync(options.caCertPath)) {
      res.status(404).json({ error: 'CA certificate is not configured', code: 'CA_NOT_CONFIGURED' });
      return;
    }
    res.setHeader('Content-Type', 'application/x-x509-ca-cert');
    res.setHeader('Content-Disposition', 'attachment; filename="veymux-ca.crt"');
    res.send(fs.readFileSync(options.caCertPath));
  });
  // This listener serves public application code, not plaintext business APIs.
  // All terminal/chat/files traffic remains inside the authenticated Noise channel.
  if (options.clientPath && options.acceptEncrypted) {
    app.use('/api', (_req, res) => { res.status(403).json({ error: 'Encrypted channel required', code: 'ENCRYPTED_CHANNEL_REQUIRED' }); });
    app.use(express.static(options.clientPath));
  }

  const server = createServer(app);
  if (options.acceptEncrypted) {
    const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
    activeWebSockets = wss;
    server.on('upgrade', (req, socket, head) => {
      const reject = () => { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); };
      if (wss.clients.size >= 256 || !isAllowedHost(req.headers.host)) { reject(); return; }
      // HTTP origins are permitted only on this explicit listener, with exact
      // origin/authority matching. Cookies never authorize these channels.
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) { reject(); return; }
      let url: URL;
      try { url = new URL(req.url || '/', `http://${req.headers.host}`); } catch { reject(); return; }
      if (url.pathname === '/api/federation/secure' && !url.search) {
        wss.handleUpgrade(req, socket, head, ws => options.acceptEncrypted!(ws));
      } else if (url.pathname === '/api/federation/relay' && options.acceptRelay && options.relayPrincipal
        && [...url.searchParams.keys()].every(key => key === 'routeToken') && url.searchParams.getAll('routeToken').length === 1) {
        const principal = options.relayPrincipal(url.searchParams.get('routeToken'));
        if (!principal) { reject(); return; }
        wss.handleUpgrade(req, socket, head, ws => { void options.acceptRelay!(ws, principal).then(ok => { if (ok) ws.send(JSON.stringify({ type: 'ready' })); }).catch(() => ws.close(1011, 'Encrypted relay unavailable')); });
      } else reject();
    });
    server.on('close', () => { for (const ws of wss.clients) ws.terminate(); wss.close(); });
  }
  const portFile = path.join(VEYMUX_DIR, `onboarding-${options.httpsPort}.json`);
  const savedPort = readJsonFile<{ port: number }>(portFile)?.port;
  const preferredPort = Number.isInteger(savedPort) && savedPort! > 1024 && savedPort! <= 65535 ? savedPort! : 0;
  let retriedPort = false;
  server.on('error', (error) => {
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE' && preferredPort && !retriedPort && !server.listening) {
      retriedPort = true;
      server.listen(0, '0.0.0.0');
      return;
    }
    console.warn('[onboarding] HTTP setup server failed:', error);
  });
  server.once('listening', () => {
    const address = server.address() as AddressInfo | null;
    const port = address?.port ?? null;
    const host = getLanIPv4Addresses()[0] ?? 'localhost';
    activeUrl = port ? `http://${host}:${port}/connect` : null;
    activeFingerprint = onboardingFingerprint(options.caCertPath);
    if (port) try { writeJsonStateAtomic(portFile, { port }); } catch { /* Read-only installations can still offer a temporary setup port. */ }
  });
  server.listen(preferredPort, '0.0.0.0');

  activeServer = server;
  return { server, get url() { return activeUrl; } };
}

export function stopOnboardingServer(): void {
  if (activeWebSockets) {
    for (const socket of activeWebSockets.clients) socket.terminate();
    activeWebSockets = null;
  }
  if (activeServer) {
    activeServer.closeAllConnections();
    try { activeServer.close(); } catch { /* ignore */ }
  }
  activeServer = null;
  activeUrl = null;
  activeFingerprint = null;
}

export function getOnboardingServerUrl(): string | null {
  return activeUrl;
}

export function getOnboardingCertificateFingerprint(): string | null { return activeFingerprint; }
