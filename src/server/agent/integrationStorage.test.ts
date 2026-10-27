// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IntegrationStore, type IntegrationPolicy, type IntegrationStorageOptions } from './integrationStore.js';

let directory: string;
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'td-segments-')); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); fs.rmSync(directory, { recursive: true, force: true }); });
const policy: IntegrationPolicy = { id: 'bridge', groupId: 'group', permissions: ['events.read'], launchProfiles: [] };
const fact = (n: number, text = '汉'.repeat(100), group = 'group') => ({ sourceKey: `source:${group}:${n}`, sourceVersion: '1', eventId: `original-${group}-${n}`,
  event: { group_id: group, kind: 'message.reply', created_at: n, message_id: `message-${group}-${n}`, payload: { text } } });
function setup(options: IntegrationStorageOptions = {}, retention = 10000) {
  const file = path.join(directory, 'integrations.json'), store = new IntegrationStore(file, retention, options);
  const issued = store.provision(policy), p = store.authenticate('bridge', issued.token);
  store.page(p, 'inbox');
  return { file, store, issued, p };
}
const manifest = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));

it('migrates every legacy fact and metadata field, including pre-existing retention gaps, without reidentifying or acknowledging', () => {
  const f = setup(); f.store.append([fact(1), fact(2)]);
  const original = f.store.page(f.p, 'inbox').events;
  const legacy = { ...manifest(f.file), version: 1, events: original, prunedThrough: { group: 1 }, consumers: { 'bridge:group:inbox': 0 } };
  delete legacy.segments;
  const bytes = Buffer.from(JSON.stringify(legacy, null, 2)); fs.writeFileSync(f.file, bytes);
  const migrated = new IntegrationStore(f.file, 1, { maxBytes: 1, segmentBytes: 300 });
  expect(fs.readFileSync(`${f.file}.v1-backup`)).toEqual(bytes);
  expect(manifest(f.file)).toMatchObject({ version: 2, principals: legacy.principals, consumers: legacy.consumers,
    sources: legacy.sources, sequences: legacy.sequences, prunedThrough: legacy.prunedThrough });
  expect(migrated.storageStatus()).toMatchObject({ events: 2, state: 'full' });
  expect(() => migrated.page(f.p, 'inbox')).toThrow(expect.objectContaining({ code: 'EVENT_RETENTION_GAP' }));
  expect(migrated.page(f.p, 'reconciled').events).toEqual([original[1]]);
  expect(migrated.authenticate('bridge', f.issued.token)).toEqual(f.p);
});

it('accepts multiple groups above the former whole-file 64 MiB ceiling and preserves stable replay', () => {
  const f = setup({ maxBytes: 96 * 1024 * 1024, segmentBytes: 1024 * 1024 });
  f.store.append([fact(1, 'x'.repeat(33 * 1024 * 1024)), fact(1, 'y'.repeat(33 * 1024 * 1024), 'other')]);
  expect(f.store.storageStatus().event_bytes).toBeGreaterThan(64 * 1024 * 1024);
  expect(fs.statSync(f.file).size).toBeLessThan(4096);
  const restarted = new IntegrationStore(f.file);
  expect(restarted.page(f.p, 'inbox').events[0]).toMatchObject({ event_id: 'original-group-1', sequence: 1, message_id: 'message-group-1' });
  expect(manifest(f.file).sequences).toEqual({ group: 1, other: 1 });
});

it('does not touch event segments for an ACK, a policy update or revocation', () => {
  const f = setup({ segmentBytes: 700 }); f.store.append([fact(1), fact(2)]);
  const before = manifest(f.file).segments;
  const vectorWrite = vi.spyOn(fs, 'writevSync');
  f.store.ack(f.p, 'inbox', f.store.page(f.p, 'inbox').events[0]!.cursor);
  f.store.update(policy); f.store.revoke(policy.id);
  expect(vectorWrite).not.toHaveBeenCalled(); expect(manifest(f.file).segments).toEqual(before);
});

it('reserves the ACK path when full, reclaims only the confirmed prefix and retries the same source once', () => {
  const options = { maxBytes: 1400, segmentBytes: 700 }, f = setup(options);
  f.store.append([fact(1), fact(2)]);
  const events = f.store.page(f.p, 'inbox').events, before = fs.readFileSync(f.file);
  expect(() => f.store.append([fact(3)])).toThrow(expect.objectContaining({ code: 'EVENT_STORAGE_FULL' }));
  expect(fs.readFileSync(f.file)).toEqual(before); expect(f.store.storageStatus().state).toBe('full');
  f.store.ack(f.p, 'inbox', events[0]!.cursor);
  f.store.append([fact(3)]); f.store.append([fact(3)]);
  const restarted = new IntegrationStore(f.file, 10000, options);
  expect(restarted.page(f.p, 'inbox').events.map(event => event.event_id)).toEqual(['original-group-2', 'original-group-3']);
  expect(manifest(f.file)).toMatchObject({ sequences: { group: 3 }, prunedThrough: { group: 1 }, sources: { 'source:group:3': '1' } });
  expect(restarted.page(f.p, 'audit').events.map(event => event.sequence)).toEqual([2, 3]);
});

it('protects all active principal consumers, not merely the fastest ACK, without count-based gaps', () => {
  const f = setup({ maxBytes: 1400 }, 1);
  const second = { ...policy, id: 'other' }, issued = f.store.provision(second), p = f.store.authenticate('other', issued.token);
  f.store.page(p, 'slow'); f.store.append([fact(1), fact(2)]);
  const events = f.store.page(f.p, 'inbox').events;
  f.store.ack(f.p, 'inbox', events[1]!.cursor);
  expect(() => f.store.append([fact(3)])).toThrow(expect.objectContaining({ code: 'EVENT_STORAGE_FULL' }));
  expect(f.store.page(p, 'slow').events).toEqual(events);
  f.store.ack(p, 'slow', events[0]!.cursor); f.store.append([fact(3)]);
  expect(f.store.page(p, 'slow').events.map(event => event.sequence)).toEqual([2, 3]);
});

it('requires fenced explicit retirement, keeps the original watermark, and prevents reuse or invented ACKs', () => {
  const f = setup({ maxBytes: 1400 }); f.store.page(f.p, 'old-probe'); f.store.append([fact(1), fact(2)]);
  const events = f.store.page(f.p, 'inbox').events; f.store.ack(f.p, 'inbox', events[1]!.cursor);
  expect(f.store.consumerStatus().find(c => c.consumer === 'old-probe')).toMatchObject({ confirmed_sequence: 0, lag: 2, protects_events: true });
  expect(() => f.store.retireConsumer('bridge', 'old-probe', 1, 'retire')).toThrow(expect.objectContaining({ code: 'EVENT_CONSUMER_CHANGED' }));
  const retired = f.store.retireConsumer('bridge', 'old-probe', 0, 'retire');
  expect(f.store.retireConsumer('bridge', 'old-probe', 0, 'retire')).toEqual(retired);
  expect(() => f.store.retireConsumer('bridge', 'old-probe', 0, 'different')).toThrow(expect.objectContaining({ code: 'EVENT_CONSUMER_RETIRED' }));
  f.store.append([fact(3)]);
  const restarted = new IntegrationStore(f.file);
  expect(() => restarted.page(f.p, 'old-probe')).toThrow(expect.objectContaining({ code: 'EVENT_CONSUMER_RETIRED' }));
  expect(() => restarted.ack(f.p, 'old-probe', events[1]!.cursor)).toThrow(expect.objectContaining({ code: 'EVENT_CONSUMER_RETIRED' }));
  expect(manifest(f.file).consumers['bridge:group:old-probe']).toBe(0);
});

it('rejects an oversized incoming batch without trimming away any of its new events to pretend it fits', () => {
  const f = setup({ maxBytes: 700 });
  expect(() => f.store.append([fact(1), fact(2)])).toThrow(expect.objectContaining({ code: 'EVENT_STORAGE_FULL' }));
  expect(manifest(f.file).sequences).toEqual({}); expect(manifest(f.file).sources).toEqual({});
  expect(f.store.page(f.p, 'inbox').events).toEqual([]);
});

it('contains a stalled group within its byte budget while another group continues committing', () => {
  const f = setup({ maxBytes: 6000, maxGroupBytes: 1400 }); f.store.append([fact(1), fact(2)]);
  expect(() => f.store.append([fact(3)])).toThrow(expect.objectContaining({ code: 'EVENT_STORAGE_FULL' }));
  f.store.append([fact(1, 'other group works', 'other')]);
  expect(manifest(f.file).sequences).toEqual({ group: 2, other: 1 });
  expect(f.store.storageStatus()).toMatchObject({ state: 'full', blocked_groups: ['group'] });
  f.store.ack(f.p, 'inbox', f.store.page(f.p, 'inbox').events[0]!.cursor); f.store.append([fact(3)]);
  expect(f.store.storageStatus().blocked_groups).toEqual([]);
});

it('warns on startup and threshold crossings without logging payloads or credentials repeatedly', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const options = { maxBytes: 1400, warnPercent: 50 }, f = setup(options);
  f.store.append([fact(1)]); expect(warn).not.toHaveBeenCalled();
  f.store.append([fact(2)]); expect(warn).toHaveBeenCalledTimes(1);
  f.store.ack(f.p, 'inbox', f.store.page(f.p, 'inbox').events[0]!.cursor); expect(warn).toHaveBeenCalledTimes(1);
  new IntegrationStore(f.file, 10000, options); expect(warn).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(warn.mock.calls)).not.toContain(f.issued.token);
  expect(JSON.stringify(warn.mock.calls)).not.toContain('汉');
});

it('validates configuration and exact serialized UTF-8 byte boundaries', () => {
  const f = setup(); f.store.append([fact(1)]);
  const exact = f.store.storageStatus().event_bytes;
  const nextFile = path.join(directory, 'exact.json'), options = { maxBytes: exact };
  const exactStore = new IntegrationStore(nextFile, 10000, options); exactStore.append([fact(1)]);
  expect(exactStore.storageStatus().event_bytes).toBe(exact);
  expect(() => new IntegrationStore(path.join(directory, 'small.json'), 10000, { maxBytes: exact - 1 }).append([fact(1)]))
    .toThrow(expect.objectContaining({ code: 'EVENT_STORAGE_FULL' }));
  vi.stubEnv('TERMDOCK_INTEGRATION_EVENT_MAX_BYTES', 'garbage');
  expect(() => new IntegrationStore(f.file)).toThrow(expect.objectContaining({ code: 'INVALID_EVENT_STORAGE_CONFIG' }));
});

it('refuses corrupt or missing committed segments, and ignores unreferenced files', () => {
  const f = setup(); f.store.append([fact(1)]);
  const descriptor = manifest(f.file).segments[0], file = path.join(`${f.file}.segments`, descriptor.name);
  fs.writeFileSync(path.join(`${f.file}.segments`, `${randomUUID()}.jsonl`), 'uncommitted garbage');
  expect(new IntegrationStore(f.file).page(f.p, 'inbox').events).toHaveLength(1);
  const original = fs.readFileSync(file); fs.writeFileSync(file, Buffer.alloc(original.length, 120));
  expect(() => new IntegrationStore(f.file)).toThrow('integrity');
  fs.unlinkSync(file); expect(() => new IntegrationStore(f.file)).toThrow();
});

it('does not overwrite another writer with a stale manifest', () => {
  const f = setup(), stale = new IntegrationStore(f.file); f.store.append([fact(1)]);
  expect(() => stale.append([fact(2)])).toThrow(expect.objectContaining({ code: 'EVENT_JOURNAL_CHANGED' }));
  expect(new IntegrationStore(f.file).page(f.p, 'inbox').events.map(event => event.sequence)).toEqual([1]);
});

it('quarantines a commit whose rename succeeded but directory fsync failed; reopen reconciles the durable version', () => {
  const f = setup(); f.store.append([fact(1)]); const event = f.store.page(f.p, 'inbox').events[0]!;
  const fsync = fs.fsyncSync; let calls = 0;
  vi.spyOn(fs, 'fsyncSync').mockImplementation(fd => { if (++calls === 2) throw new Error('directory fsync failed'); fsync(fd); });
  expect(() => f.store.ack(f.p, 'inbox', event.cursor)).toThrow('directory fsync failed');
  expect(() => f.store.ack(f.p, 'inbox', event.cursor)).toThrow(expect.objectContaining({ code: 'EVENT_COMMIT_UNCONFIRMED' }));
  vi.restoreAllMocks(); expect(new IntegrationStore(f.file).page(f.p, 'inbox').events).toEqual([]);
});

it.each(['before-manifest', 'after-manifest'])('survives real process exit %s without half-committing sources or event identities', phase => {
  const f = setup({ segmentBytes: 700 }); f.store.append([fact(1)]);
  const module = path.resolve('src/server/agent/integrationStore.ts');
  const code = `import fs from 'node:fs'; import { IntegrationStore } from ${JSON.stringify(module)};
    const file=process.argv[1], rename=fs.renameSync;
    fs.renameSync=(from,to)=>{if(to===file && ${JSON.stringify(phase)}==='before-manifest')process.exit(37); rename(from,to); if(to===file && ${JSON.stringify(phase)}==='after-manifest')process.exit(37);};
    new IntegrationStore(file,10000,{segmentBytes:700}).append([${JSON.stringify(fact(2))}]);`;
  let status: number | null = null;
  try { execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code, f.file], { stdio: 'pipe' }); }
  catch (error) { status = (error as { status: number }).status; }
  expect(status).toBe(37);
  const restarted = new IntegrationStore(f.file), events = restarted.page(f.p, 'inbox').events;
  expect(events.map(event => event.event_id)).toEqual(phase === 'before-manifest' ? ['original-group-1'] : ['original-group-1', 'original-group-2']);
  expect(manifest(f.file).sequences.group).toBe(events.length);
  expect(manifest(f.file).sources['source:group:2']).toBe(phase === 'before-manifest' ? undefined : '1');
  restarted.append([fact(2)]);
  expect(restarted.page(f.p, 'inbox').events.map(event => event.event_id)).toEqual(['original-group-1', 'original-group-2']);
  restarted.ack(f.p, 'inbox', restarted.page(f.p, 'inbox').events.at(-1)!.cursor);
  expect(fs.readdirSync(`${f.file}.segments`).filter(name => name.endsWith('.jsonl')).length).toBe(manifest(f.file).segments.length);
});
