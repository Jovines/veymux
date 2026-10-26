// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createInviteLink, createOnboardingInviteLink, parseInviteLink } from '../federation/inviteLink';
import { canOpenDesktopInvitation, desktopInvitationUrl, reusableInvitationGrant } from './desktopInvitation';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
const serviceId='12D3KooW'+'a'.repeat(44), entryId='12D3KooW'+'b'.repeat(44), code='c'.repeat(43);
afterEach(()=>{vi.unstubAllGlobals();});
it('hands HTTP landing pages to native HTTPS, keeping the target, route and split presentation',()=>{
  const original=createInviteLink({v:1,serviceId,code,entryUrl:'https://192.168.1.20:9834',entryServiceId:entryId,routeCode:'r'.repeat(43),serviceUrl:'https://target.internal',viewMode:'chat',viewLayout:'split'});
  const landing=createOnboardingInviteLink(original,'http://192.168.1.20:21000/connect');
  const native=new URL(desktopInvitationUrl(parseInviteLink(landing,{httpTransport:true})));
  expect(native.protocol).toBe('termdock:');expect(native.hostname).toBe('invite');expect(native.search).toBe('');
  const descriptor=JSON.parse(atob(native.hash.slice('#termdock-invite='.length).replace(/-/g,'+').replace(/_/g,'/')));
  expect(descriptor).toMatchObject({entryUrl:'https://192.168.1.20:9834',serviceUrl:'https://target.internal',serviceId,entryServiceId:entryId,code,routeCode:'r'.repeat(43),viewLayout:'split',viewMode:'chat'});
  expect(native.href).not.toContain('21000');
});
it('keeps direct HTTP shares on the verified native destination and never fabricates a new invitation',()=>{
  const original=createInviteLink({v:1,serviceId,code,entryUrl:'https://192.168.1.20:9834'});
  const intent=parseInviteLink(createOnboardingInviteLink(original,'http://192.168.1.20:21000/connect'),{httpTransport:true});
  const descriptor=JSON.parse(atob(new URL(desktopInvitationUrl(intent)).hash.slice('#termdock-invite='.length).replace(/-/g,'+').replace(/_/g,'/')));
  expect(descriptor.entryUrl).toBe('https://192.168.1.20:9834');expect(descriptor.serviceUrl).toBe(descriptor.entryUrl);
  expect(()=>desktopInvitationUrl({...intent,pairingCode:undefined})).toThrow();
});
it('offers post-acceptance handoff only for the exact reusable invitation grant',()=>{
  const intent=parseInviteLink(createInviteLink({v:1,serviceId,code,entryUrl:'https://entry.example'}));
  const id=bytesToHex(sha256(new TextEncoder().encode(`termdock-invitation-v1:${serviceId}:${code}`)));
  expect(reusableInvitationGrant(intent,[{invitationId:id}])).toBe(true);
  expect(reusableInvitationGrant(intent,[{invitationId:'other'}])).toBe(false);
  expect(reusableInvitationGrant(intent,[{}])).toBe(false);
});
it('offers the Mac handler only on desktop browsers, preserving browser and iPad flows',()=>{
  vi.stubGlobal('navigator',{platform:'MacIntel',maxTouchPoints:0});expect(canOpenDesktopInvitation()).toBe(true);
  vi.stubGlobal('navigator',{platform:'MacIntel',maxTouchPoints:5});expect(canOpenDesktopInvitation()).toBe(false);
  vi.stubGlobal('navigator',{platform:'Linux',maxTouchPoints:0});expect(canOpenDesktopInvitation()).toBe(false);
});
