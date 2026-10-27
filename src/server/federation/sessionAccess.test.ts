import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SessionAccessStore } from './sessionAccess.js';
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive:true,force:true }); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(),'session-access-')); dirs.push(dir);
  let now = Date.now(), authorized = true;
  const file = join(dir,'access.json'), store = new SessionAccessStore(file,() => authorized,() => now);
  const lease = { id:randomUUID(),userId:'user@example.test',deviceId:'device111111111111',expiresAt:now+90000 };
  return { store,lease,file,advance:() => {now+=91000;},revoke:() => {authorized=false;} };
}
describe('integration session access',() => {
  it('refuses ticket admission when persisting its consumption fails', () => {
    const f = fixture();
    f.store.update('s1', 'p1', { fence: 1, lease: f.lease });
    const ticket = f.store.ticket('s1', 'p1', f.lease.deviceId);
    const rename = vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('write failed'); });
    try { expect(() => f.store.consume(ticket, f.lease.deviceId)).toThrow('write failed'); }
    finally { rename.mockRestore(); }
    expect(() => f.store.consume(ticket, f.lease.deviceId)).toThrow();
    expect(f.store.consume(f.store.ticket('s1', 'p1', f.lease.deviceId), f.lease.deviceId)).toMatchObject({ sessionId: 's1' });
  });
  it('rejects replay after a consumption commit with an unconfirmed directory fsync', () => {
    const f = fixture();
    f.store.update('s1', 'p1', { fence: 1, lease: f.lease });
    const ticket = f.store.ticket('s1', 'p1', f.lease.deviceId), sync = fs.fsyncSync;
    const failure = vi.spyOn(fs, 'fsyncSync').mockImplementation(fd => {
      if (fs.fstatSync(fd).isDirectory()) throw new Error('directory sync failed');
      sync(fd);
    });
    try { expect(() => f.store.consume(ticket, f.lease.deviceId)).toThrow('directory sync failed'); }
    finally { failure.mockRestore(); }
    expect(() => f.store.consume(ticket, f.lease.deviceId)).toThrow();
    const restarted = new SessionAccessStore(f.file, () => true);
    expect(() => restarted.consume(ticket, f.lease.deviceId)).toThrow();
  });
  it('preserves observer connections on renewal without retaining obsolete identities', () => {
    const f = fixture(), reader = { ...f.lease, id: randomUUID() };
    f.store.updateReaders('s1', 'p1', { fence: 1, leases: [reader] });
    const claims = f.store.consume(f.store.ticket('s1', 'p1', reader.deviceId, reader.id), reader.deviceId);
    f.store.updateReaders('s1', 'p1', { fence: 2, leases: [{ ...reader, expiresAt: reader.expiresAt + 10000 }] });
    const restarted = new SessionAccessStore(f.file, () => true);
    expect(restarted.valid(claims, reader.deviceId)).toBe(true);
    expect(restarted.allows(claims, reader.deviceId, 'session.input', 's1')).toBe(false);
  });
  it('keeps consumed tickets single-use across a service restart while allowing fresh tickets', () => {
    const f = fixture();
    f.store.update('s1', 'p1', { fence: 1, lease: f.lease });
    const ticket = f.store.ticket('s1', 'p1', f.lease.deviceId);
    f.store.consume(ticket, f.lease.deviceId);
    const restarted = new SessionAccessStore(f.file, () => true);
    expect(() => restarted.consume(ticket, f.lease.deviceId)).toThrow();
    expect(restarted.consume(restarted.ticket('s1', 'p1', f.lease.deviceId), f.lease.deviceId)).toMatchObject({ sessionId: 's1' });
  });
  it('does not revive an old observer after its reader ID moves to another device and back', () => {
    const f = fixture(), reader = { ...f.lease, id: randomUUID() };
    f.store.updateReaders('s1', 'p1', { fence: 1, leases: [reader] });
    const claims = f.store.consume(f.store.ticket('s1', 'p1', reader.deviceId, reader.id), reader.deviceId);
    f.store.updateReaders('s1', 'p1', { fence: 2, leases: [{ ...reader, deviceId: 'differentDevice' }] });
    expect(f.store.valid(claims, reader.deviceId)).toBe(false);
    f.store.updateReaders('s1', 'p1', { fence: 3, leases: [reader] });
    expect(f.store.valid(claims, reader.deviceId)).toBe(false);
  });
  it('invalidates an observer when its reader ID is assigned to another user on the same device', () => {
    const f = fixture(), reader = { ...f.lease, id: randomUUID() };
    f.store.updateReaders('s1', 'p1', { fence: 1, leases: [reader] });
    const claims = f.store.consume(f.store.ticket('s1', 'p1', reader.deviceId, reader.id), reader.deviceId);
    f.store.updateReaders('s1', 'p1', { fence: 2, leases: [{ ...reader, userId: 'another-user' }] });
    expect(f.store.valid(claims, reader.deviceId)).toBe(false);
  });
  it('reads revisions without changing state or exposing private leases and preserves them on restart', () => {
    const f = fixture(), empty = readFileSync(f.file, 'utf8');
    expect(f.store.revision('s1', 'p1')).toEqual({ fence: 0, readerFence: 0, exclusive: false });
    expect(readFileSync(f.file, 'utf8')).toBe(empty);
    f.store.update('s1', 'p1', { fence: 4, lease: f.lease, exclusive: true });
    f.store.updateReaders('s1', 'p1', { fence: 8, leases: [{ ...f.lease, id: randomUUID(), deviceId: 'reader' }] });
    const saved = readFileSync(f.file, 'utf8'), restarted = new SessionAccessStore(f.file, () => true);
    expect(restarted.revision('s1', 'p1')).toEqual({ fence: 4, readerFence: 8, exclusive: true });
    expect(readFileSync(f.file, 'utf8')).toBe(saved);
    expect(() => restarted.revision('s1', 'other-principal')).toThrow();
    f.revoke(); expect(() => f.store.revision('s1', 'p1')).toThrow();
  });
  it('persists opt-in writer exclusivity across reader changes, expiry, release and restart', () => {
    const f = fixture(), reader = { ...f.lease, id: randomUUID(), deviceId: 'reader' };
    f.store.update('s1', 'p1', { fence: 1, lease: f.lease, exclusive: true });
    f.store.update('s2', 'p1', { fence: 1, lease: f.lease });
    f.store.updateReaders('s1', 'p1', { fence: 1, leases: [reader] });
    f.store.updateReaders('s1', 'p1', { fence: 2, leases: [] });
    for (const action of ['session.input', 'session.chat-send', 'session.resize']) {
      expect(f.store.restrictsNativeWriter('s1', action)).toBe(true);
      expect(f.store.restrictsNativeWriter('s2', action)).toBe(false);
    }
    expect(f.store.restrictsNativeWriter('s1', 'session.terminal-view')).toBe(false);
    f.store.update('s1', 'p1', { fence: 2, lease: null });
    f.advance();
    expect(f.store.restrictsNativeWriter('s1', 'session.input')).toBe(true);
    const restarted = new SessionAccessStore(f.file, () => true);
    expect(restarted.restrictsNativeWriter('s1', 'session.input')).toBe(true);
    expect(() => restarted.update('s1', 'p1', { fence: 2, lease: null, exclusive: false })).toThrow();
    expect(() => restarted.update('s1', 'p1', { fence: 1, lease: null, exclusive: false })).toThrow();
    restarted.update('s1', 'p1', { fence: 3, lease: null, exclusive: false });
    expect(restarted.restrictsNativeWriter('s1', 'session.input')).toBe(false);
    expect(() => restarted.update('s1', 'p1', { fence: 3, lease: null, exclusive: true })).toThrow();
    expect(() => restarted.update('s1', 'p1', { fence: 4, lease: null, exclusive: 'true' as never })).toThrow();
  });
  it('keeps concurrent observers read-only across writer handoff and rejects reused reader generations',()=>{
    const f=fixture(),reader={...f.lease,id:randomUUID(),deviceId:'reader111111111111'};
    f.store.update('s1','p1',{fence:1,lease:f.lease});f.store.updateReaders('s1','p1',{fence:1,leases:[reader]});
    const claims=f.store.consume(f.store.ticket('s1','p1',reader.deviceId,reader.id),reader.deviceId);
    expect(f.store.allows(claims,reader.deviceId,'session.terminal-view','s1')).toBe(true);
    for(const action of ['session.input','session.resize','session.chat-send','authorization.manage'])expect(f.store.allows(claims,reader.deviceId,action,'s1')).toBe(false);
    f.store.update('s1','p1',{fence:2,lease:{...f.lease,id:randomUUID()}});
    expect(f.store.valid(claims,reader.deviceId)).toBe(true);
    const restarted=new SessionAccessStore(f.file,()=>true);expect(restarted.valid(claims,reader.deviceId)).toBe(true);
    restarted.updateReaders('s1','p1',{fence:2,leases:[]});expect(restarted.valid(claims,reader.deviceId)).toBe(false);
    restarted.updateReaders('s1','p1',{fence:3,leases:[reader]});expect(restarted.valid(claims,reader.deviceId)).toBe(false);
    expect(()=>restarted.updateReaders('s1','p1',{fence:2,leases:[reader]})).toThrow();
  });
  it('binds single-use tickets to the encrypted device and one session without service authority',() => {
    const f=fixture(); f.store.update('s1','p1',{fence:1,lease:f.lease});
    const ticket=f.store.ticket('s1','p1',f.lease.deviceId);
    expect(() => f.store.consume(ticket,'different-device')).toThrow();
    const claims=f.store.consume(ticket,f.lease.deviceId);
    expect(() => f.store.consume(ticket,f.lease.deviceId)).toThrow();
    expect(f.store.allows(claims,f.lease.deviceId,'session.input','s1')).toBe(true);
    expect(f.store.allows(claims,f.lease.deviceId,'session.input','s2')).toBe(false);
    expect(f.store.allows(claims,f.lease.deviceId,'authorization.manage','s1')).toBe(false);
  });
  it('supports concurrent different sessions and fences old leases across restarts',() => {
    const f=fixture(); f.store.update('s1','p1',{fence:1,lease:f.lease});
    f.store.update('s2','p1',{fence:1,lease:{...f.lease,id:randomUUID()}});
    const old=f.store.consume(f.store.ticket('s1','p1',f.lease.deviceId),f.lease.deviceId);
    f.store.update('s1','p1',{fence:2,lease:null});
    expect(f.store.valid(old,f.lease.deviceId)).toBe(false);
    const restarted=new SessionAccessStore(f.file,()=>true);
    expect(() => restarted.update('s1','p1',{fence:1,lease:f.lease})).toThrow();
    expect(() => restarted.update('s1','p1',{fence:2,lease:f.lease})).toThrow();
    expect(restarted.ticket('s2','p1',f.lease.deviceId)).toMatch(/^session\./);
  });
  it('rejects principal changes, stale device binding, expiry and revoked integration authority',() => {
    const f=fixture();f.store.update('s1','p1',{fence:1,lease:{...f.lease,deviceId:''}});
    f.store.update('s1','p1',{fence:1,lease:f.lease});
    const claims=f.store.consume(f.store.ticket('s1','p1',f.lease.deviceId),f.lease.deviceId);
    expect(() => f.store.update('s1','p2',{fence:2,lease:f.lease})).toThrow();
    expect(() => f.store.update('s1','p1',{fence:1,lease:{...f.lease,deviceId:''}})).toThrow();
    f.revoke(); expect(f.store.valid(claims,f.lease.deviceId)).toBe(false);
    f.advance(); expect(f.store.valid(claims,f.lease.deviceId)).toBe(false);
  });
});
