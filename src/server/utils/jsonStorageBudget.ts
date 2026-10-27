import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { atomicIntegrationWrite } from '../agent/integrationJournal.js';

export interface JsonStorageOptions { maxBytes?: number; warnPercent?: number }
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

/** Admission limits protect against new work, not against recording the outcome
 * of work already admitted. Domain stores explicitly mark bounded control writes;
 * ordinary content edits/new requests still need capacity. No history is erased. */
export class JsonStorageBudget {
  private bytes = 0;
  private fingerprint?: string;
  private warning = '';
  private uncertain = false;
  readonly maxBytes: number;
  private warnPercent: number;
  constructor(private file: string, private label: string, setting: string, fallback: number,
    private full: () => Error, options: JsonStorageOptions = {}) {
    this.maxBytes = options.maxBytes ?? Number(process.env[setting] ?? fallback);
    this.warnPercent = options.warnPercent ?? Number(process.env.TERMDOCK_STORAGE_WARN_PERCENT ?? 80);
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 1 || !Number.isSafeInteger(this.warnPercent) || this.warnPercent < 1 || this.warnPercent > 100) throw new Error(`Invalid storage configuration: ${setting} / TERMDOCK_STORAGE_WARN_PERCENT`);
    try { const raw = fs.readFileSync(file); this.bytes = raw.length; this.fingerprint = digest(raw); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    this.report();
  }
  status() { return { store: this.label, bytes: this.bytes, max_bytes: this.maxBytes, warning_percent: this.warnPercent,
    state: this.bytes >= this.maxBytes ? 'full' : this.bytes >= this.maxBytes * this.warnPercent / 100 ? 'warning' : 'ok',
    control_writes_use_admission_budget: false, commit_unconfirmed: this.uncertain }; }
  private report(): void {
    const state = this.status().state;
    if (state !== 'ok' && state !== this.warning) console.warn('[storage-capacity]', JSON.stringify(this.status()));
    this.warning = state;
  }
  admit(serialized: string, control = false): void {
    if (this.uncertain) throw new Error(`${this.label}: storage commit unconfirmed; reopen before writing`);
    const bytes = Buffer.byteLength(serialized);
    // Shrinking an already oversized legacy document must remain possible.
    if (!control && bytes > this.maxBytes && bytes > this.bytes) {
      if (this.warning !== 'rejected') console.warn('[storage-capacity]', JSON.stringify({ ...this.status(), rejected_bytes: bytes }));
      this.warning = 'rejected'; throw this.full();
    }
  }
  committed(serialized: string): void { this.bytes = Buffer.byteLength(serialized); this.fingerprint = digest(serialized); this.report(); }
  failed(): void {
    try { this.uncertain = digest(fs.readFileSync(this.file)) !== this.fingerprint; }
    catch (readError) { this.uncertain = (readError as NodeJS.ErrnoException).code !== 'ENOENT' || this.fingerprint !== undefined; }
  }
  /** Confirm the exact already-written document without overwriting an
   * uncertain commit or another writer's state. Used by durable receipt replay. */
  reconfirm(serialized: string): void {
    const expected = Buffer.from(serialized), descriptor = fs.openSync(this.file, 'r');
    try {
      if (!fs.readFileSync(descriptor).equals(expected)) throw new Error(`${this.label}: persisted state changed; reopen before confirming`);
      fs.fsyncSync(descriptor);
    } finally { fs.closeSync(descriptor); }
    const directory = fs.openSync(path.dirname(this.file), 'r');
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    if (!fs.readFileSync(this.file).equals(expected)) throw new Error(`${this.label}: persisted state changed; reopen before confirming`);
    this.committed(serialized); this.uncertain = false;
  }
  write(serialized: string, control = false): void {
    this.admit(serialized, control);
    try { atomicIntegrationWrite(this.file, fd => fs.writeFileSync(fd, serialized)); }
    catch (error) {
      this.failed();
      throw error;
    }
    this.committed(serialized);
  }
}
