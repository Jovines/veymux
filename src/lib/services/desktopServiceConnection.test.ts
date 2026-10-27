// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInviteLink, createOnboardingInviteLink } from '../federation/inviteLink';
import type { VeymuxDesktopBridge } from '../desktop/nativeBridge';
import { addDesktopService, desktopCertificateTrust, desktopConnectionIntent, openDesktopService, serviceConnectionInput } from './desktopServiceConnection';
import { parseInviteLink } from '../federation/inviteLink';

afterEach(() => vi.restoreAllMocks());
const target = '12D3KooW' + 'a'.repeat(44), entry = '12D3KooW' + 'b'.repeat(44);
const service = { id: target, targetPeerId: target, url: 'https://entry.example', serviceOrigin: 'https://target.internal', label: 'Target', routes: [{ url: 'https://backup.example', targetPeerId: entry }] };
function bridge() {
  return { openServiceConnection: vi.fn().mockResolvedValue({ ok: true }), reviewServiceConnection: vi.fn().mockResolvedValue(undefined) } as unknown as VeymuxDesktopBridge;
}
describe('shared desktop connection actions', () => {
  it('keeps HTTPS and native certificate review when pasting an HTTP share landing link', async () => {
    const original = createInviteLink({ v: 1, serviceId: target, entryUrl: 'https://192.168.1.20:9834', code: 'c'.repeat(43) });
    const invitation = createOnboardingInviteLink(original, 'http://192.168.1.20:21000/connect');
    const native = bridge(); await addDesktopService(native, invitation);
    expect(native.reviewServiceConnection).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://192.168.1.20:9834', targetPeerId: target }), expect.stringMatching(/^https:\/\/192\.168\.1\.20:9834\/#veymux-invite=/));
    expect(parseInviteLink(vi.mocked(native.reviewServiceConnection!).mock.calls[0][1]!)).toMatchObject({ targetPeerId: target, pairingCode: 'c'.repeat(43) });
    expect(native.openServiceConnection).not.toHaveBeenCalled();
  });
  it('delegates a new workspace address to the center before discovery or certificate failure', async () => {
    const native = bridge();
    await addDesktopService(native, 'computer.example:9834');
    expect(native.reviewServiceConnection).toHaveBeenCalledExactlyOnceWith({
      id: 'https://computer.example:9834', url: 'https://computer.example:9834', label: 'computer.example:9834',
    }, undefined);
    expect(native.openServiceConnection).not.toHaveBeenCalled();
  });
  it('opens from the center and older shells through the same normalized native request', async () => {
    const native = bridge();
    delete native.reviewServiceConnection;
    await addDesktopService(native, 'computer.example:9834');
    expect(native.openServiceConnection).toHaveBeenCalledExactlyOnceWith({
      id: 'https://computer.example:9834', url: 'https://computer.example:9834', label: 'computer.example:9834',
    }, undefined);
  });
  it('preserves the routed invitation during an add and never bypasses a rejected center handoff', async () => {
    const invitation = createInviteLink({ v: 1, serviceId: target, entryServiceId: entry, entryUrl: service.url, serviceUrl: service.serviceOrigin, code: 'c'.repeat(32), routeCode: 'd'.repeat(32), viewMode: 'chat' });
    const native = bridge();
    vi.mocked(native.reviewServiceConnection!).mockRejectedValue(new Error('Center busy'));
    await expect(addDesktopService(native, invitation)).rejects.toThrow('Center busy');
    expect(native.reviewServiceConnection).toHaveBeenCalledExactlyOnceWith(serviceConnectionInput(invitation).connection, invitation);
    expect(native.openServiceConnection).not.toHaveBeenCalled();
  });
  it.each([true, false])('bootstraps a relay target through the entry with direct address known=%s', known => {
    const request = desktopConnectionIntent({ targetPeerId: target, url: known ? 'https://target.internal' : 'https://entry.example',
      ...(known ? { serviceOrigin: 'https://target.internal' } : { entryServiceId: entry }),
      serviceName: 'Target', routes: [{ url: 'https://entry.example', targetPeerId: entry }, { url: 'https://alternate.example', targetPeerId: target }] });
    expect(request.connection).toMatchObject({ id: target, targetPeerId: target, label: 'Target', url: 'https://entry.example', entryServiceId: entry,
      routes: [{ url: 'https://entry.example', targetPeerId: entry }, { url: 'https://alternate.example', targetPeerId: target }] });
    expect(request.connection.serviceOrigin).toBe(known ? 'https://target.internal' : undefined);
    expect(request.invitation).toBeUndefined();
  });
  it.each([false, true])('hands off invitation credentials without saving them (route only=%s)', routeOnly => {
    const intent = { url: 'https://entry.example', serviceOrigin: 'https://target.internal', targetPeerId: target, entryServiceId: entry,
      routeCode: 'd'.repeat(32), ...(routeOnly ? { routeOnly: true } : { pairingCode: 'c'.repeat(32) }), viewMode: 'chat' as const };
    const request = desktopConnectionIntent(intent);
    expect(parseInviteLink(request.invitation!)).toMatchObject(intent);
    expect(JSON.stringify(request.connection)).not.toMatch(/pairingCode|routeCode|routeOnly|veymux-invite/);
  });
  it.each(['computer.example:9834', 'wss://computer.example:9834/api/federation/secure'])('normalizes %s identically for both entry points', input => {
    expect(serviceConnectionInput(input)).toEqual({ connection: { id: 'https://computer.example:9834', url: 'https://computer.example:9834', label: 'computer.example:9834' } });
  });
  it('keeps relay identity and invitation secrets in the original link only', () => {
    const invitation = createInviteLink({ v: 1, serviceId: target, entryServiceId: entry, entryUrl: service.url, serviceUrl: service.serviceOrigin, code: 'c'.repeat(32), routeCode: 'd'.repeat(32), viewMode: 'chat' });
    const request = serviceConnectionInput(invitation);
    expect(request.invitation).toBe(invitation);
    expect(request.connection).toMatchObject({ targetPeerId: target, entryServiceId: entry, url: service.url, serviceOrigin: service.serviceOrigin });
    expect(JSON.stringify(request.connection)).not.toMatch(/pairingCode|routeCode|veymux-invite/);
  });
  it.each(['PREVIEW_DISCOVERY_FAILED', 'PREVIEW_CERTIFICATE_REJECTED'])('hands %s to the trusted center with all original connection metadata', async code => {
    const native = bridge();
    vi.mocked(native.openServiceConnection!).mockRejectedValue(Object.assign(new Error('TLS rejected'), { code }));
    await openDesktopService(native, service, 'original-invitation');
    expect(native.reviewServiceConnection).toHaveBeenCalledExactlyOnceWith(service, 'original-invitation');
    expect(native.openServiceConnection).toHaveBeenCalledOnce();
  });
  it('does not move trusted opens or authorization/identity failures to the certificate review', async () => {
    const native = bridge();
    await openDesktopService(native, service);
    vi.mocked(native.openServiceConnection!).mockRejectedValue(Object.assign(new Error('Denied'), { code: 'PREVIEW_AUTHORIZATION_REJECTED' }));
    await expect(openDesktopService(native, service)).rejects.toThrow('Denied');
    expect(native.reviewServiceConnection).not.toHaveBeenCalled();
  });
  it('retains errors for legacy clients and a failed handoff instead of reporting success', async () => {
    const native = bridge();
    vi.mocked(native.openServiceConnection!).mockRejectedValue(Object.assign(new Error('TLS rejected'), { code: 'PREVIEW_DISCOVERY_FAILED' }));
    vi.mocked(native.reviewServiceConnection!).mockRejectedValue(new Error('Center unavailable'));
    await expect(openDesktopService(native, service)).rejects.toThrow('Center unavailable');
    delete native.reviewServiceConnection;
    await expect(openDesktopService(native, service)).rejects.toThrow('TLS rejected');
    expect(desktopCertificateTrust(native)).toBeUndefined();
  });
});
