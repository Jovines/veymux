// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

// jsdom is provided by the test environment; keep its small fixture boundary
// typed without adding a production dependency on DOM emulation typings.
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options?: { url?: string; runScripts?: string }) => {
    window: { document: Document; Event: typeof Event; MouseEvent: typeof MouseEvent; close(): void };
  };
};

const fixture = vi.hoisted(() => ({ dir: `/tmp/termdock-onboarding-test-${process.pid}-${Math.random().toString(36).slice(2)}` }));
vi.mock('./utils/termdockState.js', async original => ({ ...await original<typeof import('./utils/termdockState.js')>(), TERMDOCK_DIR: fixture.dir }));
import { getOnboardingCertificateFingerprint, startOnboardingServer, stopOnboardingServer } from './onboardingServer.js';

const caPath = path.join(fixture.dir, 'root.crt');
let server: ReturnType<typeof startOnboardingServer>['server'];
beforeAll(() => {
  fs.mkdirSync(fixture.dir, { recursive: true });
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=Termdock Setup Test', '-keyout', path.join(fixture.dir, 'key.pem'), '-out', caPath], { stdio: 'ignore' });
});
afterAll(() => { stopOnboardingServer(); fs.rmSync(fixture.dir, { recursive: true, force: true }); });
async function start(extra: Partial<import('./onboardingServer.js').OnboardingServerOptions> = {}) {
  server = startOnboardingServer({ httpsPort: 19876, caCertPath: caPath, ...extra }).server!;
  await new Promise<void>(resolve => server!.once('listening', resolve));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

it('serves the invitation application on HTTP, keeps CA setup optional, and never exposes raw business APIs', async () => {
  const publicDir = path.join(fixture.dir, 'public'); fs.mkdirSync(publicDir);
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<html>invitation application</html>');
  const accept = vi.fn((ws: WebSocket) => { ws.send('noise-test-only'); });
  const origin = await start({ clientPath: publicDir, acceptEncrypted: accept });
  let peerClosed: Promise<void> | undefined;
  try {
    expect(await (await fetch(origin + '/connect', { headers: { Connection: 'close' } })).text()).toContain('invitation application');
    expect(await (await fetch(origin + '/certificates', { headers: { Connection: 'close' } })).text()).toContain('下载证书');
    expect((await fetch(origin + '/api/terminal/one/input', { method: 'POST', headers: { Connection: 'close' }, body: 'do not execute' })).status).toBe(403);
    const ws = new WebSocket(origin.replace('http:', 'ws:') + '/api/federation/secure', { origin });
    peerClosed = new Promise<void>(resolve => ws.once('close', () => resolve()));
    const first = await new Promise<string>((resolve, reject) => { ws.once('message', data => resolve(String(data))); ws.once('error', reject); });
    expect(first).toBe('noise-test-only');
    const rejected = new WebSocket(origin.replace('http:', 'ws:') + '/api/federation/secure', { origin: 'http://attacker.example' });
    await new Promise<void>(resolve => rejected.once('error', () => resolve()));
    expect(accept).toHaveBeenCalledTimes(1);
  } finally { await stop(); await peerClosed; }
});
async function stop() {
  const closed = new Promise<void>(resolve => server!.once('close', resolve));
  stopOnboardingServer(); await closed;
}

it('serves actionable HTTP guidance, preserves the HTTPS destination and publishes only public certificate material', async () => {
  const origin = await start();
  try {
    const response = await fetch(`${origin}/connect`, { headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' } });
    expect(response.status).toBe(200);
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    const html = await response.text();
    const dom = new JSDOM(html, { url: `${origin}/connect#termdock-invite=example-fragment`, runScripts: 'dangerously' });
    const doc = dom.window.document;
    expect((doc.querySelector('#device') as HTMLSelectElement).value).toBe('ios');
    expect((doc.querySelector('[data-device="ios"]') as HTMLElement).hidden).toBe(false);
    expect((doc.querySelector('[data-device="mac"]') as HTMLElement).hidden).toBe(true);
    expect(doc.querySelector('#continue')?.getAttribute('href')).toBe('https://127.0.0.1:19876/#termdock-invite=example-fragment');
    expect(html).toContain('根证书的信任范围不限于本次分享');
    expect(html).toContain('通过你已信任的对话渠道');
    const device = doc.querySelector('#device') as HTMLSelectElement;
    device.value = 'windows'; device.dispatchEvent(new dom.window.Event('change'));
    expect((doc.querySelector('[data-device="windows"]') as HTMLElement).hidden).toBe(false);
    const download = doc.querySelector('#download')!;
    download.addEventListener('click', event => event.preventDefault());
    download.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(doc.querySelector('[role="status"]')?.textContent).toContain('下载已发起');
    expect(doc.querySelector('#continue')?.classList.contains('primary')).toBe(true);
    dom.window.close();
    const cert = await fetch(`${origin}/onboarding/ca.crt`);
    expect(cert.headers.get('content-disposition')).toContain('termdock-ca.crt');
    const fingerprint = new X509Certificate(await cert.text()).fingerprint256;
    expect(getOnboardingCertificateFingerprint()).toBe(fingerprint);
    expect(html).toContain(fingerprint);
    expect(html).not.toContain('PRIVATE KEY');
    expect((await fetch(`${origin}/api/terminal/sessions`)).status).toBe(404);
    expect((await fetch(`${origin}/connect?next=https://attacker.example`)).status).toBe(200);
    const noRedirect = new JSDOM(await (await fetch(`${origin}/connect?next=https://attacker.example`)).text());
    expect(noRedirect.window.document.querySelector('#continue')?.getAttribute('href')).toBe('https://127.0.0.1:19876/');
    noRedirect.window.close();
    expect((await fetch(`${origin}/ca`)).headers.get('content-type')).toContain('application/x-x509-ca-cert');
  } finally { await stop(); }
});

it('reuses the setup port after restart and recovers when another listener occupies it', async () => {
  const first = await start(); await stop();
  const second = await start(); await stop();
  expect(second).toBe(first);
  const blocker = createServer();
  await new Promise<void>(resolve => blocker.listen(Number(new URL(first).port), '0.0.0.0', resolve));
  try {
    const fallback = await start();
    expect(fallback).not.toBe(first);
    expect((await fetch(`${fallback}/connect`)).status).toBe(200);
    await stop();
  } finally { await new Promise<void>(resolve => blocker.close(() => resolve())); }
});

it('does not start an installation guide without a configured CA', () => {
  expect(startOnboardingServer({ httpsPort: 19876 }).server).toBeNull();
  expect(getOnboardingCertificateFingerprint()).toBeNull();
});
