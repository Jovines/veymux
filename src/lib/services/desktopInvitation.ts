import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { ConnectionIntent } from '../federation/browserIntegration';
import { desktopConnectionIntent } from './desktopServiceConnection';
import { parseInviteLink } from '../federation/inviteLink';

const pendingKey = 'termdock-desktop-invitation-handoff-v1';

/** One-use bridge across the service-scope reload after explicit acceptance.
 * The next document removes it before use and still verifies the exact grant. */
export function stageDesktopInvitation(intent: ConnectionIntent): () => void {
  if (!canOpenDesktopInvitation() || !intent.pairingCode) return () => {};
  try {
    const invitation = desktopConnectionIntent(intent).invitation;
    if (!invitation || new URL(invitation).protocol !== 'https:') return () => {};
    const record = JSON.stringify({ at: Date.now(), invitation });
    sessionStorage.setItem(pendingKey, record);
    return () => { try { if (sessionStorage.getItem(pendingKey) === record) sessionStorage.removeItem(pendingKey); } catch { /* Optional handoff. */ } };
  } catch { return () => {}; }
}

export function takeDesktopInvitation(): ConnectionIntent | undefined {
  try {
    const raw = sessionStorage.getItem(pendingKey);
    sessionStorage.removeItem(pendingKey);
    if (!raw || raw.length > 12000) return;
    const record = JSON.parse(raw);
    if (typeof record.at !== 'number' || Date.now() - record.at < 0 || Date.now() - record.at > 120000 || typeof record.invitation !== 'string') return;
    const intent = parseInviteLink(record.invitation);
    return new URL(intent.url).protocol === 'https:' ? intent : undefined;
  } catch { return; }
}

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
