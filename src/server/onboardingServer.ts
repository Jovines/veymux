import express from 'express';
import { createServer, type Server } from 'http';
import fs from 'fs';
import type { AddressInfo } from 'net';
import { createOnboardingRouter } from './routes/onboarding.js';
import { getLanIPv4Addresses } from './utils/localAccess.js';
import path from 'node:path';
import { TERMDOCK_DIR, readJsonFile, writeJsonStateAtomic } from './utils/termdockState.js';
import { onboardingFingerprint, sendOnboardingPage } from './onboardingPage.js';

export interface OnboardingServerOptions {
  httpsPort: number;
  caCertPath?: string;
}

export interface OnboardingServerState {
  server: Server | null;
  url: string | null;
}

let activeServer: Server | null = null;
let activeUrl: string | null = null;
let activeFingerprint: string | null = null;

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
  app.get(['/', '/connect'], (req, res) => sendOnboardingPage(req, res, options));
  app.use('/onboarding', createOnboardingRouter({ port: options.httpsPort, caCertPath: options.caCertPath }));
  app.get('/ca', (_req, res) => {
    if (!options.caCertPath || !fs.existsSync(options.caCertPath)) {
      res.status(404).json({ error: 'CA certificate is not configured', code: 'CA_NOT_CONFIGURED' });
      return;
    }
    res.setHeader('Content-Type', 'application/x-x509-ca-cert');
    res.setHeader('Content-Disposition', 'attachment; filename="termdock-ca.crt"');
    res.send(fs.readFileSync(options.caCertPath));
  });

  const server = createServer(app);
  const portFile = path.join(TERMDOCK_DIR, `onboarding-${options.httpsPort}.json`);
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
  if (activeServer) {
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
