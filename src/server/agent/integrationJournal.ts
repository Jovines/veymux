import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { CollaborationError } from './collaborationProtocol.js';
import type { IntegrationEvent, IntegrationPrincipal } from './integrationStore.js';

export interface IntegrationJournalDocument {
  version: 1; principals: IntegrationPrincipal[]; events: IntegrationEvent[];
  sequences: Record<string, number>; prunedThrough: Record<string, number>;
  sources: Record<string, string>; consumers: Record<string, number>;
  consumerLifecycle?: Record<string, { registered_at?: number; last_ack_at?: number; retired_at?: number; retirement_key?: string }>;
}
interface Segment { name: string; bytes: number; sha256: string; count: number }
interface Manifest extends Omit<IntegrationJournalDocument, 'version' | 'events'> { version: 2; segments: Segment[] }
interface LoadedSegment { descriptor: Segment; events: IntegrationEvent[] }
const segmentName = /^[a-f0-9-]{36}\.jsonl$/;
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** File fsync precedes rename; directory fsync precedes reporting a commit. */
export function atomicIntegrationWrite(file: string, write: (descriptor: number) => void): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    write(descriptor); fs.fsyncSync(descriptor); fs.closeSync(descriptor); descriptor = undefined;
    fs.renameSync(temporary, file);
    const directory = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporary, { force: true });
  }
}
export function atomicJson(file: string, value: unknown): void {
  atomicIntegrationWrite(file, descriptor => fs.writeFileSync(descriptor, JSON.stringify(value)));
}
function writeBuffers(file: string, parts: Buffer[]): void {
  atomicIntegrationWrite(file, descriptor => {
    let index = 0, offset = 0;
    while (index < parts.length) {
      const vectors = parts.slice(index, index + 512);
      if (offset) vectors[0] = vectors[0]!.subarray(offset);
      let written: number;
      try { written = fs.writevSync(descriptor, vectors); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EINTR') continue; throw error; }
      if (written <= 0) throw new Error('Integration segment write made no progress');
      while (index < parts.length) {
        const available = parts[index]!.length - offset;
        if (written < available) { offset += written; break; }
        written -= available; index++; offset = 0;
        if (!written) break;
      }
    }
  });
}

/** Immutable segments become visible ONLY through the committed manifest.
 * A failed/crashed append leaves the old manifest authoritative. Orphans are
 * collected after a later commit, never replayed as committed events. */
export class IntegrationJournal {
  readonly directory: string;
  private segments: LoadedSegment[] = [];
  private legacy?: Buffer;
  private manifest?: string;
  private uncertain = false;
  private committedEvents?: IntegrationEvent[];
  constructor(readonly file: string, readonly segmentBytes: number) { this.directory = `${file}.segments`; }
  read(): IntegrationJournalDocument | undefined {
    let raw: Buffer;
    try { raw = fs.readFileSync(this.file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
    const document = JSON.parse(raw.toString('utf8'));
    if (!document || !Array.isArray(document.principals) || !document.sources || !document.consumers || !document.sequences || !document.prunedThrough) throw new Error('Invalid integration journal');
    for (const [group, sequence] of Object.entries(document.sequences)) {
      const floor = document.prunedThrough[group] ?? 0;
      if (!Number.isSafeInteger(sequence) || (sequence as number) < 0 || !Number.isSafeInteger(floor) || floor < 0 || floor > (sequence as number)) throw new Error('Invalid integration sequence metadata');
    }
    for (const value of Object.values(document.consumers)) if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('Invalid integration consumer watermark');
    if (document.version === 1 && Array.isArray(document.events)) {
      this.legacy = raw; this.manifest = raw.toString('utf8'); return document;
    }
    if (document.version !== 2 || !Array.isArray(document.segments)) throw new Error('Invalid integration journal version');
    const names = new Set<string>(), events: IntegrationEvent[] = [], previous = new Map<string, number>();
    for (const segment of document.segments as Segment[]) {
      if (!segmentName.test(segment.name) || names.has(segment.name) || !Number.isSafeInteger(segment.bytes) || segment.bytes < 1
        || !Number.isSafeInteger(segment.count) || segment.count < 1 || !/^[a-f0-9]{64}$/.test(segment.sha256)) throw new Error('Invalid integration segment descriptor');
      names.add(segment.name);
      const bytes = fs.readFileSync(path.join(this.directory, segment.name));
      if (bytes.length !== segment.bytes || digest(bytes) !== segment.sha256 || bytes.at(-1) !== 10) throw new Error('Integration segment integrity check failed');
      const entries = bytes.toString('utf8').slice(0, -1).split('\n').map(line => JSON.parse(line) as IntegrationEvent);
      if (entries.length !== segment.count) throw new Error('Integration segment count mismatch');
      for (const event of entries) {
        if (!event || typeof event.group_id !== 'string' || typeof event.event_id !== 'string' || !Number.isSafeInteger(event.sequence)
          || event.sequence <= (previous.get(event.group_id) ?? 0) || event.sequence > (document.sequences[event.group_id] ?? 0)) throw new Error('Invalid integration segment event');
        previous.set(event.group_id, event.sequence);
        events.push(event);
      }
      this.segments.push({ descriptor: segment, events: entries });
    }
    this.manifest = raw.toString('utf8');
    this.committedEvents = events;
    const { segments: _, version: _version, ...metadata } = document as Manifest;
    return { ...metadata, version: 1, events };
  }
  /** Migrates all existing events before any retention/byte reclamation. */
  migrate(document: IntegrationJournalDocument, encode: (event: IntegrationEvent) => Buffer): void {
    if (this.legacy) this.commit(document, encode);
  }
  private pack(events: IntegrationEvent[], encode: (event: IntegrationEvent) => Buffer): LoadedSegment[] {
    const result: LoadedSegment[] = [];
    let parts: Buffer[] = [], chunk: IntegrationEvent[] = [], bytes = 0;
    const flush = () => {
      if (!chunk.length) return;
      const descriptor: Segment = { name: `${randomUUID()}.jsonl`, bytes, count: chunk.length,
        sha256: digest(Buffer.concat(parts)) };
      writeBuffers(path.join(this.directory, descriptor.name), parts);
      result.push({ descriptor, events: chunk }); parts = []; chunk = []; bytes = 0;
    };
    for (const event of events) {
      const encoded = encode(event);
      if (chunk.length && bytes + encoded.length + 1 > this.segmentBytes) flush();
      parts.push(encoded, Buffer.from('\n')); chunk.push(event); bytes += encoded.length + 1;
    }
    flush(); return result;
  }
  commit(document: IntegrationJournalDocument, encode: (event: IntegrationEvent) => Buffer): void {
    if (this.uncertain) throw new CollaborationError('EVENT_COMMIT_UNCONFIRMED', 'Reopen integration storage to reconcile an uncertain manifest commit', 503);
    // Detect another writer or a stale store before overwriting its ACK/identity.
    let current: string | undefined;
    try { current = fs.readFileSync(this.file, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (current !== this.manifest) throw new CollaborationError('EVENT_JOURNAL_CHANGED', 'Integration storage changed; reopen before writing', 503);
    let next = this.segments;
    if (document.events !== this.committedEvents) {
      const retained = new Set(document.events), known = new Set<IntegrationEvent>();
      next = [];
      for (const segment of this.segments) {
        for (const event of segment.events) known.add(event);
        const kept = segment.events.filter(event => retained.has(event));
        if (kept.length === segment.events.length) next.push(segment);
        else next.push(...this.pack(kept, encode));
      }
      const added = document.events.filter(event => !known.has(event));
      if (added.length) {
        const tail = next.at(-1);
        if (tail && tail.descriptor.bytes < this.segmentBytes) { next.pop(); next.push(...this.pack([...tail.events, ...added], encode)); }
        else next.push(...this.pack(added, encode));
      }
    }
    const { version: _, events: _events, ...metadata } = document;
    const manifest: Manifest = { ...metadata, version: 2, segments: next.map(segment => segment.descriptor) };
    const serialized = JSON.stringify(manifest);
    if (this.legacy) {
      // Never overwrite a previously created recovery copy.
      const backup = `${this.file}.v1-backup`;
      if (fs.existsSync(backup)) {
        if (!fs.readFileSync(backup).equals(this.legacy)) throw new Error('Existing integration migration backup differs');
      } else atomicIntegrationWrite(backup, descriptor => fs.writeFileSync(descriptor, this.legacy!));
    }
    try { atomicIntegrationWrite(this.file, descriptor => fs.writeFileSync(descriptor, serialized)); }
    catch (error) {
      // rename may have happened before directory fsync failed. Neither claim
      // success nor permit another write against an unknown in-memory version.
      try { this.uncertain = fs.readFileSync(this.file, 'utf8') !== this.manifest; } catch { this.uncertain = true; }
      throw error;
    }
    this.manifest = serialized; this.segments = next; this.committedEvents = document.events; this.legacy = undefined;
    // GC failure cannot turn an already committed ACK into a reported failure.
    try { this.sweep(); } catch { /* Next commit retries orphan collection. */ }
  }
  private sweep(): void {
    const keep = new Set(this.segments.map(segment => segment.descriptor.name));
    let names: string[];
    try { names = fs.readdirSync(this.directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    for (const name of names) {
      if (segmentName.test(name) && !keep.has(name)) fs.unlinkSync(path.join(this.directory, name));
      const temporary = name.match(/^[a-f0-9-]{36}\.jsonl\.(\d+)\.[a-f0-9-]{36}\.tmp$/);
      if (temporary) {
        try { process.kill(Number(temporary[1]), 0); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') fs.unlinkSync(path.join(this.directory, name)); }
      }
    }
  }
  get metadataBytes(): number { return Buffer.byteLength(this.manifest ?? ''); }
  get segmentCount(): number { return this.segments.length; }
}
