import { describe, expect, it } from 'vitest';
import { createInviteLink, createOnboardingInviteLink, parseInviteLink } from './inviteLink';
const serviceId = '12D3KooWQGDWJi8Zf2xfrgbfrDCYtobhQ9twqH1qz6qTYFcEk9LX';
const code = 'a'.repeat(43);
describe('trusted invitation links', () => {
  it('puts the secret only in the fragment and preserves verified identity', () => {
    const url = createInviteLink({ v: 1, serviceId, code, entryUrl: 'https://entry.example:9834', name: '工作电脑' });
    expect(new URL(url).search).toBe('');
    expect(new URL(url).pathname).toBe('/');
    expect(parseInviteLink(url)).toMatchObject({ url: 'https://entry.example:9834', targetPeerId: serviceId, pairingCode: code, serviceName: '工作电脑' });
  });
  it('rejects substituted entry origins and malformed identities', () => {
    const url = createInviteLink({ v: 1, serviceId, code, entryUrl: 'https://entry.example' });
    expect(() => parseInviteLink(url.replace('https://entry.example/', 'https://attacker.example/'))).toThrow();
    expect(() => parseInviteLink(createInviteLink({ v: 1, serviceId: 'unverified-key', code, entryUrl: 'https://entry.example' }))).toThrow();
  });
  it('carries independent entry identity and a routing-only invitation for relayed targets', () => {
    const url = createInviteLink({ v: 1, serviceId, code, entryUrl: 'https://entry.example', entryServiceId: serviceId, routeCode: 'b'.repeat(43) });
    expect(parseInviteLink(url)).toMatchObject({ entryServiceId: serviceId, routeCode: 'b'.repeat(43) });
  });
});

describe('HTTP certificate setup invitation', () => {
  it('preserves separate target and entry identities over HTTP relay while native addition keeps HTTPS', () => {
    const entryServiceId = '12D3KooWGwMiyMZXjv7EC8evYS2adcki2u9N7W5Ri8pQG5zjgeRx';
    const original = createInviteLink({ v: 1, serviceId, code, entryServiceId, routeCode: 'b'.repeat(43), entryUrl: 'https://192.168.1.20:9834', serviceUrl: 'https://192.168.1.30:9834' });
    const link = createOnboardingInviteLink(original, 'http://192.168.1.20:21000/connect');
    expect(parseInviteLink(link)).toMatchObject({ url: 'https://192.168.1.20:9834', serviceOrigin: 'https://192.168.1.30:9834', entryServiceId });
    expect(parseInviteLink(link, { httpTransport: true })).toMatchObject({ url: 'http://192.168.1.20:21000', serviceOrigin: 'https://192.168.1.30:9834', entryServiceId, targetPeerId: serviceId, certificateUrl: expect.stringContaining('/certificates#') });
  });
  it('uses the same-origin HTTP Noise transport only when requested by the browser landing page', () => {
    const original = createInviteLink({ v: 1, serviceId, code, entryUrl: 'https://192.168.1.20:9834' });
    const link = createOnboardingInviteLink(original, 'http://192.168.1.20:21000/connect');
    expect(parseInviteLink(link)).toMatchObject({ url: 'https://192.168.1.20:9834', serviceOrigin: 'https://192.168.1.20:9834' });
    expect(parseInviteLink(link, { httpTransport: true })).toMatchObject({ url: 'http://192.168.1.20:21000', serviceOrigin: 'http://192.168.1.20:21000', targetPeerId: serviceId, pairingCode: code, certificateUrl: expect.stringContaining('/certificates#termdock-invite=') });
    expect(() => parseInviteLink(link.replace('192.168.1.20:21000', '192.168.1.21:21000'), { httpTransport: true })).toThrow();
  });
  it('keeps the secret in the fragment and connects only to the original HTTPS service', () => {
    const original = createInviteLink({ v: 1, serviceId, code, entryUrl: 'https://192.168.1.20:9834', viewMode: 'chat', viewLayout: 'split' });
    const setup = createOnboardingInviteLink(original, 'http://192.168.1.10:21000/ca');
    expect(new URL(setup).origin).toBe('http://192.168.1.20:21000');
    expect(new URL(setup).pathname).toBe('/connect');
    expect(new URL(setup).search).toBe('');
    expect(new URL(setup).hash).toBe(new URL(original).hash);
    expect(parseInviteLink(setup)).toEqual(parseInviteLink(original));
    expect(() => parseInviteLink(setup.replace('192.168.1.20', 'attacker.example'))).toThrow();
    expect(() => parseInviteLink(setup.replace('/connect#', '/#'))).toThrow();
    expect(() => parseInviteLink(setup.replace('/connect#', '/connect?redirect=bad#'))).toThrow();
    expect(() => parseInviteLink(setup.replace('http://', 'http://user@'))).toThrow();
  });
  it('does not convert HTTP business targets or accept unsafe setup schemes', () => {
    const local = createInviteLink({ v: 1, serviceId, code, entryUrl: 'http://localhost:9834' });
    const secure = createInviteLink({ v: 1, serviceId, code, entryUrl: 'https://192.168.1.20:9834' });
    expect(() => createOnboardingInviteLink(local, 'http://localhost:21000')).toThrow();
    expect(() => createOnboardingInviteLink(secure, 'javascript:alert(1)')).toThrow();
  });
});

it('preserves the split presentation without adding authorization to the URL', () => {
  const url = createInviteLink({ v: 1, serviceId, code, entryUrl: 'https://entry.example', viewLayout: 'split' });
  expect(parseInviteLink(url)).toMatchObject({ viewLayout: 'split', targetPeerId: serviceId });
});

it('roundtrips the optional guidance preference without changing the target or capabilities', () => {
  const url = createInviteLink({ v: 1, serviceId, code, entryUrl: 'https://public.example', showAccessGuide: false });
  expect(parseInviteLink(url)).toMatchObject({ showAccessGuide: false, targetPeerId: serviceId, pairingCode: code });
  expect(parseInviteLink(url)).not.toHaveProperty('actions');
  const malformed = createInviteLink({ v: 1, serviceId, code, entryUrl: 'https://public.example', showAccessGuide: 'false' as unknown as boolean });
  expect(() => parseInviteLink(malformed)).toThrow('邀请引导选项无效');
});
