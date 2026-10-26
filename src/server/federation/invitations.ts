import { validShareResources, type ShareResources } from '../shared/shareResources.js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AuthorizationScope, GrantInput } from './authorization.js';
import { validSessionAppearances, restrictSessionAppearances, type SessionAppearances } from '../shared/sessionAppearance.js';

export interface InvitationInput { resources?: ShareResources; sessionAppearance?: SessionAppearances; scope: AuthorizationScope; actions: string[]; label?: string; expiresAt?: number; reusable?: boolean; linkExpiresAt?: number | null }
export interface PendingInvitation extends InvitationInput { id: string; createdAt: number; invitationExpiresAt: number | null }
interface Invitation extends InvitationInput {
  hash: string; issuerId: string; createdAt: number; invitationExpiresAt: number | null;
  consumedAt?: number; consumedBy?: string;
  subjects?: string[];
}
const TTL = 10 * 60 * 1000;
const actions = new Set(['session.view', 'session.input', 'session.resize', 'session.terminate', 'session.chat-view', 'session.chat-send', 'session.terminal-view', 'session.chat-clear', 'session.terminal-input']);
const identity = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 512 && !/[\s\x00-\x1f]/.test(v);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function requireValid(ok: unknown): asserts ok { if (!ok) throw new Error('INVALID_INVITATION'); }
export function validateInvitation(input: unknown): asserts input is InvitationInput {
  requireValid(record(input) && Object.keys(input).every(k => ['scope', 'actions', 'label', 'expiresAt', 'resources', 'sessionAppearance', 'reusable', 'linkExpiresAt'].includes(k)));
  requireValid(record(input.scope) && Array.isArray(input.actions) && input.actions.length > 0 && new Set(input.actions).size === input.actions.length);
  requireValid(input.resources === undefined || validShareResources(input.resources));
  requireValid(input.sessionAppearance === undefined || validSessionAppearances(input.sessionAppearance, input.scope));
  const scope = input.scope;
  if (scope.kind === 'service') {
    requireValid(Object.keys(scope).length === 1 && ((input.actions.length === 1 && input.actions[0] === 'service:*') || input.actions.every(a => typeof a === 'string' && actions.has(a))));
  } else {
    requireValid(scope.kind === 'sessions' && Object.keys(scope).every(k => ['kind', 'sessionIds'].includes(k))
      && Array.isArray(scope.sessionIds) && scope.sessionIds.length > 0 && scope.sessionIds.length <= 256
      && scope.sessionIds.every(identity) && new Set(scope.sessionIds).size === scope.sessionIds.length
      && input.actions.every(a => typeof a === 'string' && actions.has(a)));
  }
  requireValid(input.label === undefined || (typeof input.label === 'string' && input.label.trim().length > 0 && input.label.length <= 80 && !/[\x00-\x1f\x7f]/.test(input.label)));
  requireValid(input.expiresAt === undefined || (Number.isSafeInteger(input.expiresAt) && Number(input.expiresAt) > 0));
  requireValid(input.reusable === undefined || typeof input.reusable === 'boolean');
  requireValid(input.linkExpiresAt === undefined || input.linkExpiresAt === null || (Number.isSafeInteger(input.linkExpiresAt) && Number(input.linkExpiresAt) > 0));
}
/** Single owning process. Legacy links are consumed before grant creation;
 * reusable links bind issued grants to revocable link authority. Codes are never persisted. */
export class InvitationStore {
  private now: () => number;
  constructor(private options: { filePath: string; serviceId: string; now?: () => number }) {
    requireValid(identity(options.serviceId)); this.now = options.now ?? Date.now; this.read();
  }
  private hash(code: string) { return createHash('sha256').update(`termdock-invitation-v1:${this.options.serviceId}:`).update(code).digest('hex'); }
  /** Link expiry stops new acceptance, while explicit link revocation also
   * invalidates existing reusable-link grants, even across a crash mid-revoke. */
  hasGrantAuthority(id: string): boolean { try { return this.read().some(invite => invite.hash === id && invite.reusable === true); } catch { return false; } }
  private read(): Invitation[] {
    let raw: string;
    try { raw = readFileSync(this.options.filePath, 'utf8'); chmodSync(this.options.filePath, 0o600); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const data: unknown = JSON.parse(raw);
    requireValid(record(data) && data.version === 1 && data.serviceId === this.options.serviceId && Array.isArray(data.invitations) && data.invitations.length <= 2048);
    const seen = new Set<string>();
    for (const item of data.invitations) {
      requireValid(record(item) && Object.keys(item).every(k => ['scope', 'actions', 'label', 'expiresAt', 'hash', 'issuerId', 'createdAt', 'invitationExpiresAt', 'consumedAt', 'consumedBy', 'resources', 'sessionAppearance', 'reusable', 'linkExpiresAt', 'subjects'].includes(k)));
      const { scope, actions, resources, sessionAppearance, label, expiresAt, hash, issuerId, createdAt, invitationExpiresAt, consumedAt, consumedBy } = item;
      validateInvitation({ scope, actions, ...(resources === undefined ? {} : { resources }), ...(sessionAppearance === undefined ? {} : { sessionAppearance }), ...(label === undefined ? {} : { label }), ...(expiresAt === undefined ? {} : { expiresAt }), ...(item.reusable === undefined ? {} : { reusable: item.reusable }), ...(item.linkExpiresAt === undefined ? {} : { linkExpiresAt: item.linkExpiresAt }) });
      requireValid(typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash) && !seen.has(hash) && identity(issuerId)); seen.add(hash);
      requireValid(Number.isSafeInteger(createdAt) && (invitationExpiresAt === null ? item.linkExpiresAt === null
        : Number.isSafeInteger(invitationExpiresAt) && Number(invitationExpiresAt) === (item.linkExpiresAt ?? Number(createdAt) + TTL)));
      requireValid((consumedAt === undefined && consumedBy === undefined) || (Number.isSafeInteger(consumedAt) && identity(consumedBy)));
      requireValid(item.subjects === undefined || item.reusable === true && Array.isArray(item.subjects) && item.subjects.length <= 10000 && item.subjects.every(identity) && new Set(item.subjects).size === item.subjects.length);
    }
    return data.invitations as unknown as Invitation[];
  }
  private save(invitations: Invitation[]) {
    mkdirSync(dirname(this.options.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.options.filePath}.${randomUUID()}.tmp`; let fd: number | undefined;
    try {
      fd = openSync(temporary, 'wx', 0o600);
      writeFileSync(fd, JSON.stringify({ version: 1, serviceId: this.options.serviceId, invitations }, null, 2));
      fsyncSync(fd); closeSync(fd); fd = undefined; renameSync(temporary, this.options.filePath);
    } finally { if (fd !== undefined) closeSync(fd); try { unlinkSync(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
  }
  listPending(): PendingInvitation[] {
    const now = this.now();
    return this.read().filter(i => i.reusable || i.consumedAt === undefined && (i.invitationExpiresAt === null || i.invitationExpiresAt > now) && (i.expiresAt === undefined || i.expiresAt > now))
      .map(({ hash, scope, actions, resources, sessionAppearance, label, expiresAt, createdAt, invitationExpiresAt, reusable }) => ({ id: hash, scope, actions, ...(resources === undefined ? {} : { resources }), ...(sessionAppearance === undefined ? {} : { sessionAppearance }), ...(label ? { label } : {}), ...(expiresAt === undefined ? {} : { expiresAt }), ...(reusable ? { reusable } : {}), createdAt, invitationExpiresAt }));
  }
  revoke(id: string): boolean {
    const current = this.read();
    const index = current.findIndex(i => i.hash === id && (i.reusable || i.consumedAt === undefined));
    if (index < 0) return false;
    current.splice(index, 1); this.save(current); return true;
  }
  revokeSession(sessionId: string, normalize: (id: string) => string = id => id): number {
    const current = this.read(); let changed = 0;
    const next = current.filter(invitation => {
      if (!invitation.reusable && invitation.consumedAt !== undefined || invitation.scope.kind !== 'sessions') return true;
      const remaining = invitation.scope.sessionIds.filter(id => normalize(id) !== sessionId);
      if (remaining.length === invitation.scope.sessionIds.length) return true;
      changed++; if (!remaining.length) return false;
      invitation.scope = { kind: 'sessions', sessionIds: remaining }; invitation.sessionAppearance = restrictSessionAppearances(invitation.sessionAppearance, remaining); return true;
    });
    if (changed) this.save(next); return changed;
  }
  create(issuerId: string, input: InvitationInput): { invitationId: string; code: string; expiresAt: number | null } {
    requireValid(identity(issuerId)); validateInvitation(input);
    const now = this.now(); requireValid(input.expiresAt === undefined || input.expiresAt > now);
    requireValid(input.linkExpiresAt === undefined || input.linkExpiresAt === null || input.linkExpiresAt > now);
    const current = this.read().filter(i => i.consumedAt !== undefined || i.invitationExpiresAt === null || i.invitationExpiresAt > now);
    if (current.filter(i => (i.reusable || i.consumedAt === undefined) && (i.invitationExpiresAt === null || i.invitationExpiresAt > now) && (i.expiresAt === undefined || i.expiresAt > now)).length >= 256) throw new Error('INVITATION_LIMIT');
    // Keep bounded device-friendly metadata; retain all still-active invitations.
    while (current.length >= 2048) { const index = current.findIndex(i => !i.reusable && i.consumedAt !== undefined); if (index < 0) throw new Error('INVITATION_LIMIT'); current.splice(index, 1); }
    const code = randomBytes(32).toString('base64url');
    const invitation: Invitation = { ...structuredClone(input), ...(input.label ? { label: input.label.trim() } : {}), hash: this.hash(code), issuerId, createdAt: now, invitationExpiresAt: input.linkExpiresAt === undefined ? now + TTL : input.linkExpiresAt };
    current.push(invitation); this.save(current); return { invitationId: invitation.hash, code, expiresAt: invitation.invitationExpiresAt };
  }
  consume(code: string, subjectId: string, issuerAllowed: (issuerId: string) => boolean): GrantInput {
    if (!/^[A-Za-z0-9_-]{43}$/.test(code) || !identity(subjectId)) throw new Error('PAIRING_DENIED');
    const current = this.read(), hash = this.hash(code), now = this.now();
    const invite = current.find(i => i.hash === hash);
    if (!invite || !issuerAllowed(invite.issuerId)) throw new Error('PAIRING_DENIED');
    if (!invite.reusable && invite.consumedAt !== undefined) throw new Error('INVITATION_USED');
    if (invite.invitationExpiresAt !== null && invite.invitationExpiresAt <= now || (invite.expiresAt !== undefined && invite.expiresAt <= now)) throw new Error('INVITATION_EXPIRED');
    if (invite.reusable) {
      invite.subjects ??= [];
      if (!invite.subjects.includes(subjectId)) { if (invite.subjects.length >= 10000) throw new Error('INVITATION_LIMIT'); invite.subjects.push(subjectId); }
    }
    invite.consumedAt = now; invite.consumedBy = subjectId; this.save(current);
    return { subjectId, ...(invite.reusable ? { invitationId: invite.hash } : {}), ...(invite.resources ? { resources: structuredClone(invite.resources) } : {}), ...(invite.sessionAppearance ? { sessionAppearance: structuredClone(invite.sessionAppearance) } : {}), scope: structuredClone(invite.scope), actions: [...invite.actions], ...(invite.expiresAt === undefined ? {} : { expiresAt: invite.expiresAt }), canDelegate: false };
  }
  subjectLabels(): Record<string, string> {
    return Object.fromEntries(this.read().filter(i => i.label).flatMap(i => (i.subjects || (i.consumedBy ? [i.consumedBy] : [])).map(subject => [subject, i.label!])));
  }
}
