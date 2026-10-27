import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CollaborationError } from '../agent/collaborationProtocol.js';

export interface SessionAccessLease { id: string; userId: string; deviceId: string; expiresAt: number }
export interface SessionAccessClaims { aud: 'termdock-session-access'; sessionId: string; principalId: string; leaseId: string; deviceId: string; fence: number; exp: number; jti: string; readOnly?: boolean }
interface AccessState { principalId: string; fence: number; lease: SessionAccessLease | null; exclusive?: boolean; readers?: { fence: number; leases: SessionAccessLease[]; generations: Record<string,number> } }
const readActions = ['session.view','session.chat-view','session.terminal-view','session.metadata'];
const writeActions = [...readActions,'session.chat-send','session.input','session.resize'];
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
      if (saved.used !== undefined && (!Array.isArray(saved.used) || saved.used.some((entry: unknown) =>
        !Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !Number.isSafeInteger(entry[1])))) {
        throw new Error('Invalid consumed session tickets');
      }
      this.used = new Map((saved.used ?? []).filter(([, expiry]: [string, number]) => expiry > this.now()));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.key = randomBytes(32); this.states = {}; this.save(this.states);
    }
  }
  private save(states: Record<string, AccessState>, used = this.used) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temp = `${this.file}.${randomUUID()}.tmp`;
    const fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify({ version: 1, key: this.key.toString('base64'), states, used: [...used] })); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temp, this.file);
    const directory = fs.openSync(path.dirname(this.file), 'r');
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    this.states = states;
    this.used = used;
  }
  /** Non-mutating recovery metadata; never disclose lease identities or keys. */
  revision(sessionId: string, principalId: string) {
    const state = this.states[sessionId];
    if (!this.authorized(sessionId, principalId) || state && state.principalId !== principalId) {
      throw new CollaborationError('SESSION_ACCESS_DENIED', 'SESSION_ACCESS_DENIED', 409);
    }
    return { fence: state?.fence || 0, readerFence: state?.readers?.fence || 0, exclusive: state?.exclusive === true };
  }
  /** Exclusive ownership also fences ordinary session-scoped invitations. The
   * federation runtime preserves separately authenticated full-service admins. */
  restrictsNativeWriter(sessionId: string, action: string): boolean {
    const state = this.states[sessionId];
    return state?.exclusive === true && this.authorized(sessionId, state.principalId)
      && ['session.input', 'session.chat-send', 'session.resize'].includes(action);
  }
  update(sessionId: string, principalId: string, input: { fence: number; lease: SessionAccessLease | null; exclusive?: boolean }) {
    const old = this.states[sessionId], lease = input?.lease, now = this.now();
    if (!this.authorized(sessionId, principalId) || !Number.isSafeInteger(input?.fence) || input.fence < 1
      || input.exclusive !== undefined && typeof input.exclusive !== 'boolean'
      || old && (old.principalId !== principalId || input.fence < old.fence)) throw new CollaborationError('SESSION_ACCESS_STALE', 'SESSION_ACCESS_STALE', 409);
    if (lease !== null && (!lease || !/^[a-zA-Z0-9-]{16,80}$/.test(lease.id) || typeof lease.userId !== 'string' || !lease.userId || lease.userId.length > 256
      || typeof lease.deviceId !== 'string' || lease.deviceId.length > 160 || !/^[a-zA-Z0-9]*$/.test(lease.deviceId)
      || !Number.isSafeInteger(lease.expiresAt) || lease.expiresAt <= now || lease.expiresAt > now + 125000)) throw new CollaborationError('SESSION_ACCESS_INVALID_LEASE', 'SESSION_ACCESS_INVALID_LEASE', 409);
    if (old && input.fence === old.fence && (old.lease?.id !== lease?.id || old.lease?.userId !== lease?.userId
      || old.lease?.deviceId && old.lease.deviceId !== lease?.deviceId || old.lease && lease && lease.expiresAt < old.lease.expiresAt
      || input.exclusive !== undefined && input.exclusive !== (old.exclusive === true))) throw new CollaborationError('SESSION_ACCESS_CONFLICT', 'SESSION_ACCESS_CONFLICT', 409);
    this.save({ ...this.states, [sessionId]: { ...old, principalId, fence: input.fence, lease,
      ...(input.exclusive === undefined ? {} : { exclusive: input.exclusive }) } });
    return { accepted: true, fence: input.fence };
  }
  /** Readers have an independent revision: renewing or releasing the writer must
   * not resize, disconnect or upgrade an observer. The caller owns membership. */
  updateReaders(sessionId: string, principalId: string, input: { fence: number; leases: SessionAccessLease[] }) {
    const old=this.states[sessionId], now=this.now();
    if (!this.authorized(sessionId,principalId) || old && old.principalId!==principalId || !Number.isSafeInteger(input?.fence) || input.fence<1
      || !Array.isArray(input.leases) || input.leases.length>32 || old?.readers && input.fence<old.readers.fence) throw new CollaborationError('SESSION_ACCESS_STALE','SESSION_ACCESS_STALE',409);
    const ids=new Set<string>();
    for(const lease of input.leases) {
      if(!lease || !/^[a-zA-Z0-9-]{16,80}$/.test(lease.id) || ids.has(lease.id) || typeof lease.userId!=='string' || !lease.userId || lease.userId.length>256
        || typeof lease.deviceId!=='string' || !/^[a-zA-Z0-9]{0,160}$/.test(lease.deviceId) || !Number.isSafeInteger(lease.expiresAt) || lease.expiresAt<=now || lease.expiresAt>now+125000) throw new CollaborationError('SESSION_ACCESS_INVALID_LEASE','SESSION_ACCESS_INVALID_LEASE',409);
      ids.add(lease.id);
    }
    if(old?.readers && input.fence===old.readers.fence && JSON.stringify(old.readers.leases)!==JSON.stringify(input.leases)) throw new CollaborationError('SESSION_ACCESS_CONFLICT','SESSION_ACCESS_CONFLICT',409);
    const generations = Object.fromEntries(input.leases.map(lease => {
      const previous = old?.readers?.leases.find(reader => reader.id === lease.id);
      const sameIdentity = previous?.userId === lease.userId && previous?.deviceId === lease.deviceId;
      return [lease.id, sameIdentity ? old?.readers?.generations[lease.id] ?? input.fence : input.fence];
    }));
    this.save({...this.states,[sessionId]:{...old,principalId,fence:old?.fence || 0,lease:old?.lease || null,readers:{fence:input.fence,leases:input.leases,generations}}});
    return {accepted:true,fence:input.fence};
  }
  ticket(sessionId: string, principalId: string, deviceId: string, readerId?: string) {
    const state = this.states[sessionId];
    const lease=readerId ? state?.readers?.leases.find(x=>x.id===readerId) : state?.lease;
    if (!lease || state.principalId !== principalId || lease.deviceId !== deviceId || !deviceId || lease.expiresAt <= this.now()
      || !this.authorized(sessionId, principalId)) throw new CollaborationError('SESSION_ACCESS_DENIED', 'SESSION_ACCESS_DENIED', 409);
    const claims: SessionAccessClaims = { aud: 'termdock-session-access', sessionId, principalId, deviceId, leaseId: lease.id,
      fence: readerId ? state.readers!.generations[readerId]! : state.fence, ...(readerId?{readOnly:true}:{}), exp: Math.min(lease.expiresAt, this.now() + 30000), jti: randomUUID() };
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
    const used = new Map([...this.used].filter(([, expiry]) => expiry > this.now()));
    if (claims.aud !== 'termdock-session-access' || !Number.isSafeInteger(claims.exp) || claims.exp <= this.now() || claims.exp > this.now() + 35000
      || typeof claims.jti !== 'string' || !claims.jti || used.has(claims.jti) || used.size > 4096 || !this.valid(claims, subjectId)) throw new CollaborationError('SESSION_ACCESS_DENIED', 'SESSION_ACCESS_DENIED', 409);
    used.set(claims.jti, claims.exp);
    // Admission is successful only after the single-use decision is durable.
    try { this.save(this.states, used); }
    catch (error) {
      // A rename may already have committed before a directory fsync fails.
      // Never retry the same admission in this process after an uncertain write.
      this.used = used;
      throw error;
    }
    return claims;
  }
  valid(claims: SessionAccessClaims, subjectId: string) {
    const state = this.states[claims.sessionId];
    const lease=claims.readOnly===true ? state?.readers?.leases.find(x=>x.id===claims.leaseId) : state?.lease;
    return !!lease && claims.deviceId === subjectId && lease.deviceId === subjectId && lease.id === claims.leaseId
      && (claims.readOnly===true ? state.readers!.generations[claims.leaseId]===claims.fence : state.fence === claims.fence) && state.principalId === claims.principalId && lease.expiresAt > this.now() && this.authorized(claims.sessionId, claims.principalId);
  }
  allows(claims: SessionAccessClaims, subjectId: string, action: string, sessionId?: string) {
    return this.valid(claims, subjectId) && sessionId === claims.sessionId && (claims.readOnly===true?readActions:writeActions).includes(action);
  }
  grant(claims: SessionAccessClaims, subjectId: string) {
    return this.valid(claims, subjectId) ? [{ id: claims.leaseId, subjectId, scope: { kind: 'sessions' as const, sessionIds: [claims.sessionId] },
      actions: claims.readOnly===true?readActions:writeActions, expiresAt: (claims.readOnly===true ? this.states[claims.sessionId].readers!.leases.find(x=>x.id===claims.leaseId)! : this.states[claims.sessionId].lease!).expiresAt }] : [];
  }
}
