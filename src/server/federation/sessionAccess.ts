import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CollaborationError } from '../agent/collaborationProtocol.js';

export interface SessionAccessLease { id: string; userId: string; deviceId: string; expiresAt: number }
export interface SessionAccessClaims { aud: 'termdock-session-access'; sessionId: string; principalId: string; leaseId: string; deviceId: string; fence: number; exp: number; jti: string }
interface AccessState { principalId: string; fence: number; lease: SessionAccessLease | null }
/** Local integrations may lend access to their own sessions without lending their
 * credential. The encrypted peer must prove the device identity in the ticket. */
export class SessionAccessStore {
  private key: Buffer;
  private states: Record<string, AccessState>;
  private used = new Map<string, number>();
  constructor(private file: string, private authorized: (sessionId: string, principalId: string) => boolean, private now = Date.now) {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (saved.version !== 1 || typeof saved.key !== 'string' || !saved.states) throw new Error('Invalid session access store');
      this.key = Buffer.from(saved.key, 'base64'); this.states = saved.states;
      if (this.key.length !== 32) throw new Error('Invalid session access key');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.key = randomBytes(32); this.states = {}; this.save(this.states);
    }
  }
  private save(states: Record<string, AccessState>) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temp = `${this.file}.${randomUUID()}.tmp`;
    const fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify({ version: 1, key: this.key.toString('base64'), states })); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temp, this.file);
    const directory = fs.openSync(path.dirname(this.file), 'r');
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    this.states = states;
  }
  update(sessionId: string, principalId: string, input: { fence: number; lease: SessionAccessLease | null }) {
    const old = this.states[sessionId], lease = input?.lease, now = this.now();
    if (!this.authorized(sessionId, principalId) || !Number.isSafeInteger(input?.fence) || input.fence < 1
      || old && (old.principalId !== principalId || input.fence < old.fence)) throw new CollaborationError('SESSION_ACCESS_STALE', 'SESSION_ACCESS_STALE', 409);
    if (lease !== null && (!lease || !/^[a-zA-Z0-9-]{16,80}$/.test(lease.id) || typeof lease.userId !== 'string' || !lease.userId || lease.userId.length > 256
      || typeof lease.deviceId !== 'string' || lease.deviceId.length > 160 || !/^[a-zA-Z0-9]*$/.test(lease.deviceId)
      || !Number.isSafeInteger(lease.expiresAt) || lease.expiresAt <= now || lease.expiresAt > now + 125000)) throw new CollaborationError('SESSION_ACCESS_INVALID_LEASE', 'SESSION_ACCESS_INVALID_LEASE', 409);
    if (old && input.fence === old.fence && (old.lease?.id !== lease?.id || old.lease?.userId !== lease?.userId
      || old.lease?.deviceId && old.lease.deviceId !== lease?.deviceId || old.lease && lease && lease.expiresAt < old.lease.expiresAt)) throw new CollaborationError('SESSION_ACCESS_CONFLICT', 'SESSION_ACCESS_CONFLICT', 409);
    this.save({ ...this.states, [sessionId]: { principalId, fence: input.fence, lease } });
    return { accepted: true, fence: input.fence };
  }
  ticket(sessionId: string, principalId: string, deviceId: string) {
    const state = this.states[sessionId];
    if (!state?.lease || state.principalId !== principalId || state.lease.deviceId !== deviceId || !deviceId || state.lease.expiresAt <= this.now()
      || !this.authorized(sessionId, principalId)) throw new CollaborationError('SESSION_ACCESS_DENIED', 'SESSION_ACCESS_DENIED', 409);
    const claims: SessionAccessClaims = { aud: 'termdock-session-access', sessionId, principalId, deviceId, leaseId: state.lease.id,
      fence: state.fence, exp: Math.min(state.lease.expiresAt, this.now() + 30000), jti: randomUUID() };
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return `session.${body}.${createHmac('sha256', this.key).update(body).digest('base64url')}`;
  }
  consume(ticket: unknown, subjectId: string): SessionAccessClaims {
    if (typeof ticket !== 'string' || ticket.length > 4096) throw new CollaborationError('SESSION_ACCESS_INVALID_TICKET', 'SESSION_ACCESS_INVALID_TICKET', 409);
    const [prefix, body, signature, extra] = ticket.split('.');
    if (prefix !== 'session' || !body || !signature || extra) throw new CollaborationError('SESSION_ACCESS_INVALID_TICKET', 'SESSION_ACCESS_INVALID_TICKET', 409);
    const expected = createHmac('sha256', this.key).update(body).digest(), supplied = Buffer.from(signature, 'base64url');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new CollaborationError('SESSION_ACCESS_INVALID_TICKET', 'SESSION_ACCESS_INVALID_TICKET', 409);
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString()) as SessionAccessClaims;
    for (const [id, expiry] of this.used) if (expiry <= this.now()) this.used.delete(id);
    if (claims.aud !== 'termdock-session-access' || !Number.isSafeInteger(claims.exp) || claims.exp <= this.now() || claims.exp > this.now() + 35000
      || typeof claims.jti !== 'string' || !claims.jti || this.used.has(claims.jti) || this.used.size > 4096 || !this.valid(claims, subjectId)) throw new CollaborationError('SESSION_ACCESS_DENIED', 'SESSION_ACCESS_DENIED', 409);
    this.used.set(claims.jti, claims.exp); return claims;
  }
  valid(claims: SessionAccessClaims, subjectId: string) {
    const state = this.states[claims.sessionId];
    return !!state?.lease && claims.deviceId === subjectId && state.lease.deviceId === subjectId && state.lease.id === claims.leaseId
      && state.fence === claims.fence && state.principalId === claims.principalId && state.lease.expiresAt > this.now() && this.authorized(claims.sessionId, claims.principalId);
  }
  allows(claims: SessionAccessClaims, subjectId: string, action: string, sessionId?: string) {
    return this.valid(claims, subjectId) && sessionId === claims.sessionId && ['session.metadata','session.view','session.chat-view','session.chat-send','session.terminal-view','session.input','session.resize'].includes(action);
  }
  grant(claims: SessionAccessClaims, subjectId: string) {
    return this.valid(claims, subjectId) ? [{ id: claims.leaseId, subjectId, scope: { kind: 'sessions' as const, sessionIds: [claims.sessionId] },
      actions: ['session.view','session.chat-view','session.chat-send','session.terminal-view','session.metadata','session.input','session.resize'], expiresAt: this.states[claims.sessionId].lease!.expiresAt }] : [];
  }
}
