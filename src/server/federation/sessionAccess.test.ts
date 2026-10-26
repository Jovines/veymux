import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
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
