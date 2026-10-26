import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { ConnectionIntent } from '../federation/browserIntegration';
import { desktopConnectionIntent } from './desktopServiceConnection';

export function canOpenDesktopInvitation(): boolean {
  return typeof window !== 'undefined' && typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
    && (navigator.maxTouchPoints || 0) < 2 && !window.termdockDesktop;
}

/** OS handoff only. Neither the URL nor a successful launch grants access. */
export function desktopInvitationUrl(intent: ConnectionIntent): string {
  const invitation = desktopConnectionIntent(intent).invitation;
  if (!invitation) throw new Error('请使用尚未失效的邀请链接');
  const link = new URL(invitation);
  return `termdock://invite/${link.hash}`;
}

/** Match only this reusable link's grant from an authenticated permissions reply. */
export function reusableInvitationGrant(intent: ConnectionIntent, grants: Array<{ invitationId?: string }>): boolean {
  if (!intent.pairingCode) return false;
  const id = bytesToHex(sha256(new TextEncoder().encode(`termdock-invitation-v1:${intent.targetPeerId}:${intent.pairingCode}`)));
  return grants.some(grant => grant.invitationId === id);
}
