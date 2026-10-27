import path from 'node:path';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { CollaborationError } from './collaborationProtocol.js';
import { resolveProfileNativeIdentity, type NativeProcessIdentityConfig } from './nativeProcessIdentity.js';
import { IntegrationJournal, type IntegrationJournalDocument as Journal } from './integrationJournal.js';
export { atomicJson } from './integrationJournal.js';

export const INTEGRATION_PROTOCOL = 1;
export const INTEGRATION_OPERATIONS = ['message.send', 'message.read', 'task.read', 'task.create', 'task.configure', 'task.assign', 'task.comment', 'task.revise', 'task.answer', 'events.read', 'session.create', 'session.read', 'session.restore', 'session.release', 'session.rename', 'session.close', 'session.forget', 'session.access'] as const;
export type IntegrationPermission = typeof INTEGRATION_OPERATIONS[number];
export interface StartupInputCondition {
  /** Literal terms in the current terminal viewport, with horizontal space folded. */
  allOf: string[]; noneOf?: string[]; stableMs?: number; timeoutMs?: number;
}
export interface LaunchProfile {
  id: string; agentSlug: string; executable: string; argv: string[]; cwdRoots: string[];
  /** Exact structured resume template; {sessionId} must be its own argument. */
  resumeArgv: string[];
  startupInput?: StartupInputCondition;
  /** Explicit per-profile writer-lock scope; no process-environment probing. */
  nativeIdentity?: NativeProcessIdentityConfig;
}
export interface IntegrationPolicy { id: string; groupId: string; permissions: IntegrationPermission[]; launchProfiles: LaunchProfile[] }
export interface IntegrationPrincipal extends IntegrationPolicy { tokenHash: string; revoked: boolean }
export interface IntegrationEvent {
  event_id: string; group_id: string; sequence: number; cursor: string; kind: string; created_at: number;
  task_id?: string | null; attempt_id?: string | null; artifact_id?: string | null; message_id?: string | null;
  reply_to_event_id?: string | null; source?: string; actor?: unknown; external_actor?: unknown; payload: unknown;
}
export function integrationError(code: string, message: string, status = 400): never { throw new CollaborationError(code, message, status); }
const EVENT_PREFIX = Buffer.from('{"type":"event",'), NEWLINE = Buffer.from('\n');
export interface IntegrationStorageOptions { maxBytes?: number; maxGroupBytes?: number; segmentBytes?: number; warnPercent?: number; metadataWarnBytes?: number }
function positiveInteger(value: number | undefined, name: string, fallback: number): number {
  const raw = value ?? (process.env[name] === undefined ? fallback : Number(process.env[name]));
  if (!Number.isSafeInteger(raw) || raw < 1) integrationError('INVALID_EVENT_STORAGE_CONFIG', `${name} must be a positive safe integer`);
  return raw;
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function identifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9._-]{1,80}$/.test(value)) integrationError('INVALID_INTEGRATION_POLICY', `Invalid ${label}`);
}
export function validatePolicy(value: IntegrationPolicy): IntegrationPolicy {
  identifier(value?.id, 'principal id');
  if (!value.groupId || typeof value.groupId !== 'string' || value.groupId.length > 160) integrationError('INVALID_INTEGRATION_POLICY', 'A single groupId is required');
  if (!Array.isArray(value.permissions) || value.permissions.some(p => !INTEGRATION_OPERATIONS.includes(p))) integrationError('INVALID_INTEGRATION_POLICY', 'Unknown permission');
  if (!Array.isArray(value.launchProfiles) || value.launchProfiles.length > 16) integrationError('INVALID_INTEGRATION_POLICY', 'launchProfiles must be an array');
  const ids = new Set<string>();
  for (const profile of value.launchProfiles) {
    identifier(profile?.id, 'profile id'); identifier(profile.agentSlug, 'agent slug');
    if (ids.has(profile.id)) integrationError('INVALID_INTEGRATION_POLICY', 'Duplicate launch profile'); ids.add(profile.id);
    if (typeof profile.executable !== 'string' || !path.isAbsolute(profile.executable) || /[\x00-\x1f\x7f]/.test(profile.executable)) integrationError('INVALID_INTEGRATION_POLICY', 'Launcher must be an absolute path');
    if (!Array.isArray(profile.argv) || !Array.isArray(profile.resumeArgv) || [...profile.argv, ...profile.resumeArgv].some(a => typeof a !== 'string' || /[\x00-\x1f\x7f]/.test(a) || a.length > 8192) || profile.argv.length > 128 || profile.resumeArgv.length > 128) integrationError('INVALID_INTEGRATION_POLICY', 'Invalid structured argv');
    if (profile.resumeArgv.filter(a => a === '{sessionId}').length !== 1 || profile.resumeArgv.filter(a => a === '{launchArgs}').length !== 1 || profile.resumeArgv.some(a => a.includes('{sessionId}') && a !== '{sessionId}') || profile.resumeArgv.includes('--last')) integrationError('INVALID_INTEGRATION_POLICY', 'resumeArgv requires one {sessionId} and one {launchArgs}; --last is forbidden');
    if (!Array.isArray(profile.cwdRoots) || !profile.cwdRoots.length || profile.cwdRoots.some(root => typeof root !== 'string' || !path.isAbsolute(root) || /[\x00-\x1f\x7f]/.test(root))) integrationError('INVALID_INTEGRATION_POLICY', 'cwdRoots must be absolute paths');
    if (profile.nativeIdentity !== undefined && profile.cwdRoots.some(root => !resolveProfileNativeIdentity(profile.nativeIdentity, root))) {
      integrationError('INVALID_INTEGRATION_POLICY', 'nativeIdentity must be an explicit owned-home writer-lock directory or a safe {cwd}/ relative template');
    }
    if (profile.startupInput !== undefined) {
      const condition = profile.startupInput;
      const validTerms = (terms: unknown): terms is string[] => Array.isArray(terms) && terms.length <= 16
        && terms.every(term => typeof term === 'string' && !!term.trim() && term.length <= 256 && !/[\x00-\x1f\x7f]/.test(term));
      if (!condition || !validTerms(condition.allOf) || !condition.allOf.length || condition.noneOf !== undefined && !validTerms(condition.noneOf)
        || condition.stableMs !== undefined && (!Number.isInteger(condition.stableMs) || condition.stableMs < 500 || condition.stableMs > 5000)
        || condition.timeoutMs !== undefined && (!Number.isInteger(condition.timeoutMs) || condition.timeoutMs < 1000 || condition.timeoutMs > 120000)) {
        integrationError('INVALID_INTEGRATION_POLICY', 'Invalid startupInput literal conditions or timing bounds');
      }
    }
  }
  // Policies contain launcher configuration, never authentication material.
  return structuredClone({ id: value.id, groupId: value.groupId, permissions: value.permissions, launchProfiles: value.launchProfiles });
}
export class IntegrationStore {
  private doc: Journal = { version: 1, principals: [], events: [], sequences: {}, prunedThrough: {}, sources: {}, consumers: {} };
  private listeners = new Set<() => void>();
  // Committed events and metadata are immutable inside the store. Keep the
  // encoded event fragments, not another deep copy of their payloads. Pruned
  // objects become collectible with their encodings.
  private encoded = new WeakMap<object, Buffer>();
  private groupEvents = new Map<string, IntegrationEvent[]>();
  private journal: IntegrationJournal;
  private maxBytes: number;
  private maxGroupBytes: number;
  private warnPercent: number;
  private metadataWarnBytes: number;
  private eventBytes = 0;
  private groupBytes = new Map<string, number>();
  private warning = '';
  private rejected = new Map<string, number>();
  constructor(file: string, private retention = 10000, options: IntegrationStorageOptions = {}) {
    this.maxBytes = positiveInteger(options.maxBytes, 'TERMDOCK_INTEGRATION_EVENT_MAX_BYTES', 512 * 1024 * 1024);
    this.maxGroupBytes = positiveInteger(options.maxGroupBytes, 'TERMDOCK_INTEGRATION_EVENT_GROUP_MAX_BYTES', Math.min(this.maxBytes, 128 * 1024 * 1024));
    this.warnPercent = positiveInteger(options.warnPercent, 'TERMDOCK_INTEGRATION_EVENT_WARN_PERCENT', 80);
    this.metadataWarnBytes = positiveInteger(options.metadataWarnBytes, 'TERMDOCK_INTEGRATION_METADATA_WARN_BYTES', 16 * 1024 * 1024);
    const segmentBytes = positiveInteger(options.segmentBytes, 'TERMDOCK_INTEGRATION_EVENT_SEGMENT_BYTES', 1024 * 1024);
    if (this.warnPercent > 100 || !Number.isSafeInteger(retention) || retention < 1) integrationError('INVALID_EVENT_STORAGE_CONFIG', 'Invalid warning percentage or event retention');
    this.journal = new IntegrationJournal(file, segmentBytes);
    this.doc = this.journal.read() ?? this.doc;
    // Copy every legacy fact before applying the new retention policy. The
    // original bytes remain in .v1-backup; no source identity/cursor is rebuilt.
    this.journal.migrate(this.doc, event => this.encode(event));
    this.eventBytes = this.doc.events.reduce((bytes, event) => bytes + this.encode(event).length + 1, 0);
    this.indexEvents();
    this.reportCapacity();
  }
  private indexEvents(): void {
    this.groupEvents = new Map();
    this.groupBytes = new Map();
    for (const event of this.doc.events) {
      const events = this.groupEvents.get(event.group_id) ?? [];
      events.push(event); this.groupEvents.set(event.group_id, events);
      this.groupBytes.set(event.group_id, (this.groupBytes.get(event.group_id) ?? 0) + this.encode(event).length + 1);
    }
  }
  private encode(value: unknown): Buffer {
    if (!value || typeof value !== 'object') return Buffer.from(JSON.stringify(value));
    const cached = this.encoded.get(value);
    if (cached !== undefined) return cached;
    const serialized = Buffer.from(JSON.stringify(value)); this.encoded.set(value, serialized); return serialized;
  }
  private write(next: Journal): void {
    this.journal.commit(next, event => this.encode(event));
    const eventsChanged = next.events !== this.doc.events;
    this.doc = next;
    if (eventsChanged) {
      this.eventBytes = next.events.reduce((bytes, event) => bytes + this.encode(event).length + 1, 0);
      this.indexEvents();
    }
    this.reportCapacity();
    for (const listener of this.listeners) { try { listener(); } catch { /* Subscription reports its own failure. */ } }
  }
  storageStatus() {
    return { format: 'segmented-v2' as const, event_bytes: this.eventBytes, max_event_bytes: this.maxBytes,
      max_group_event_bytes: this.maxGroupBytes,
      group_usage: [...this.groupBytes].map(([group_id, event_bytes]) => ({ group_id, event_bytes, events: this.groupEvents.get(group_id)!.length })),
      metadata_bytes: this.journal.metadataBytes, metadata_warn_bytes: this.metadataWarnBytes,
      warning_percent: this.warnPercent, segments: this.journal.segmentCount, events: this.doc.events.length,
      groups: this.groupEvents.size, sources: Object.keys(this.doc.sources).length, consumers: Object.keys(this.doc.consumers).length,
      state: this.rejected.size || this.eventBytes >= this.maxBytes || [...this.groupBytes.values()].some(bytes => bytes >= this.maxGroupBytes) ? 'full' as const
        : this.eventBytes >= this.maxBytes * this.warnPercent / 100 || [...this.groupBytes.values()].some(bytes => bytes >= this.maxGroupBytes * this.warnPercent / 100)
          || this.journal.metadataBytes >= this.metadataWarnBytes ? 'warning' as const : 'ok' as const,
      last_rejected_event_bytes: this.rejected.size ? Math.max(...this.rejected.values()) : null,
      blocked_groups: [...this.rejected.keys()],
      ack_available: true, reclamation: 'confirmed_prefix_only' as const };
  }
  private reportCapacity(): void {
    const status = this.storageStatus(), warning = status.state === 'ok' ? '' : `${status.state}:${status.metadata_bytes >= this.metadataWarnBytes}`;
    if (warning && warning !== this.warning) console.warn('[integration-storage]', JSON.stringify(status));
    this.warning = warning;
  }
  private reclaim(next: Journal): void {
    // Every registered consumer of an active principal protects its unconfirmed
    // suffix. A group without a consumer has no durable delivery promise yet.
    const confirmed = new Map<string, number>();
    for (const principal of next.principals) if (!principal.revoked) {
      const prefix = `${principal.id}:${principal.groupId}:`;
      for (const [key, watermark] of Object.entries(next.consumers)) if (key.startsWith(prefix) && !next.consumerLifecycle?.[key]?.retired_at) {
        confirmed.set(principal.groupId, Math.min(confirmed.get(principal.groupId) ?? Infinity, watermark));
      }
    }
    const counts = new Map<string, number>(), groupBytes = new Map<string, number>(), changedGroups = new Set<string>();
    for (const event of next.events) {
      counts.set(event.group_id, (counts.get(event.group_id) ?? 0) + 1);
      groupBytes.set(event.group_id, (groupBytes.get(event.group_id) ?? 0) + this.encode(event).length + 1);
      if (event.sequence > (this.doc.sequences[event.group_id] ?? 0)) changedGroups.add(event.group_id);
    }
    let bytes = next.events.reduce((total, event) => total + this.encode(event).length + 1, 0);
    next.events = next.events.filter(event => {
      const group = event.group_id, count = counts.get(group)!;
      // Never discard facts from the incoming batch to make that batch fit.
      const safe = Math.min(confirmed.get(group) ?? next.sequences[group]!, this.doc.sequences[group] ?? 0);
      if (event.sequence > safe || count <= this.retention && bytes <= this.maxBytes && (!changedGroups.has(group) || groupBytes.get(group)! <= this.maxGroupBytes)) return true;
      counts.set(group, count - 1); bytes -= this.encode(event).length + 1;
      groupBytes.set(group, groupBytes.get(group)! - this.encode(event).length - 1);
      next.prunedThrough[group] = Math.max(next.prunedThrough[group] ?? 0, event.sequence); return false;
    });
    if (bytes > this.maxBytes || [...changedGroups].some(group => groupBytes.get(group)! > this.maxGroupBytes)) {
      for (const group of changedGroups) this.rejected.set(group, bytes);
      this.reportCapacity();
      integrationError('EVENT_STORAGE_FULL', 'Unconfirmed integration events exceed global/group capacity; consume and ACK existing events or increase TERMDOCK_INTEGRATION_EVENT_MAX_BYTES / TERMDOCK_INTEGRATION_EVENT_GROUP_MAX_BYTES. No source update in this group batch was committed', 503);
    }
  }
  consumerStatus() {
    return Object.entries(this.doc.consumers).map(([key, sequence]) => {
      const principal = this.doc.principals.find(p => key.startsWith(`${p.id}:${p.groupId}:`));
      const group = principal?.groupId, lifecycle = this.doc.consumerLifecycle?.[key];
      return { principal_id: principal?.id ?? null, group_id: group ?? null,
        consumer: principal ? key.slice(`${principal.id}:${principal.groupId}:`.length) : key,
        confirmed_sequence: sequence, latest_sequence: group ? this.doc.sequences[group] ?? 0 : null,
        lag: group ? (this.doc.sequences[group] ?? 0) - sequence : null,
        retention_gap: group ? sequence < (this.doc.prunedThrough[group] ?? 0) : null,
        retired_at: lifecycle?.retired_at ?? null, last_ack_at: lifecycle?.last_ack_at ?? null,
        protects_events: !!principal && !principal.revoked && !lifecycle?.retired_at };
    });
  }
  retireConsumer(principalId: string, consumer: string, expectedSequence: number, idempotencyKey: string) {
    const principal = this.doc.principals.find(p => p.id === principalId);
    if (!principal) integrationError('INTEGRATION_NOT_FOUND', 'Integration does not exist', 404);
    const key = this.key(principal, consumer), sequence = this.doc.consumers[key], lifecycle = this.doc.consumerLifecycle?.[key];
    if (!Number.isSafeInteger(expectedSequence) || expectedSequence < 0 || typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 160) integrationError('INVALID_CONSUMER_RETIREMENT', 'An expected sequence and idempotency key are required');
    if (sequence === undefined) integrationError('EVENT_CONSUMER_NOT_STARTED', 'Consumer has not started');
    const operation = hash(idempotencyKey);
    if (lifecycle?.retired_at) {
      if (lifecycle.retirement_key !== operation || sequence !== expectedSequence) integrationError('EVENT_CONSUMER_RETIRED', 'Consumer was already retired by a different decision', 409);
      return { retired_at: lifecycle.retired_at, confirmed_sequence: sequence };
    }
    if (sequence !== expectedSequence) integrationError('EVENT_CONSUMER_CHANGED', 'Consumer advanced; reread before retiring', 409);
    const retired_at = Date.now();
    this.write({ ...this.doc, consumerLifecycle: { ...this.doc.consumerLifecycle,
      [key]: { ...lifecycle, retired_at, retirement_key: operation } } });
    return { retired_at, confirmed_sequence: sequence };
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  policies(): Omit<IntegrationPrincipal, 'tokenHash'>[] { return this.doc.principals.map(({ tokenHash: _, ...principal }) => structuredClone(principal)); }
  permits(id: string, permission: IntegrationPermission): boolean { return this.doc.principals.some(p => p.id === id && !p.revoked && p.permissions.includes(permission)); }
  provision(policy: IntegrationPolicy): { principal: IntegrationPolicy; token: string } {
    const checked = validatePolicy(policy);
    if (this.doc.principals.some(p => p.id === checked.id)) integrationError('INTEGRATION_EXISTS', 'Use a new id; credentials cannot be silently replaced', 409);
    const token = randomBytes(32).toString('base64url');
    const next = { ...this.doc, principals: [...this.doc.principals, { ...checked, tokenHash: hash(token), revoked: false }] }; this.write(next);
    return { principal: structuredClone(checked), token };
  }
  update(policy: IntegrationPolicy): void {
    const checked = validatePolicy(policy), next = { ...this.doc, principals: [...this.doc.principals] };
    const index = next.principals.findIndex(principal => principal.id === checked.id);
    if (index < 0) integrationError('INTEGRATION_NOT_FOUND', 'Integration does not exist', 404);
    const existing = next.principals[index];
    if (existing.revoked) integrationError('INTEGRATION_REVOKED', 'Revoked identities cannot be reactivated', 403);
    if (existing.groupId !== checked.groupId) integrationError('INTEGRATION_GROUP_IMMUTABLE', 'An existing identity cannot change its group', 409);
    next.principals[index] = { ...checked, tokenHash: existing.tokenHash, revoked: false };
    this.write(next);
  }
  revoke(id: string): void {
    const principal = this.doc.principals.find(p => p.id === id);
    if (!principal) integrationError('INTEGRATION_NOT_FOUND', 'Integration does not exist', 404);
    if (principal.revoked) return;
    this.write({ ...this.doc, principals: this.doc.principals.map(p => p.id === id ? { ...p, revoked: true } : p) });
  }
  authenticate(id: string, token: string): IntegrationPrincipal {
    const principal = this.doc.principals.find(p => p.id === id);
    const given = Buffer.from(hash(token)), expected = Buffer.from(principal?.tokenHash ?? hash('invalid'));
    if (!principal || !timingSafeEqual(given, expected)) integrationError('INTEGRATION_UNAUTHORIZED', 'Invalid integration credential', 401);
    if (principal.revoked) integrationError('INTEGRATION_REVOKED', 'Integration authorization was revoked', 403);
    return structuredClone(principal);
  }
  authorize(principal: IntegrationPrincipal, permission: IntegrationPermission, groupId = principal.groupId): void {
    const active = this.doc.principals.find(p => p.id === principal.id);
    if (!active || active.revoked) integrationError('INTEGRATION_REVOKED', 'Integration authorization was revoked', 403);
    if (groupId !== active.groupId || !active.permissions.includes(permission)) integrationError('INTEGRATION_PERMISSION_DENIED', 'Operation is outside the integration grant', 403);
  }
  append(updates: Array<{ sourceKey: string; sourceVersion: string; eventId?: string; event: Omit<IntegrationEvent, 'event_id' | 'sequence' | 'cursor'> }>): void {
    // Most reconciliations repeat already-journaled facts. Do not copy the
    // retained event history until the first actual source-version change.
    let next: Journal | undefined;
    for (const update of updates) {
      if ((next ?? this.doc).sources[update.sourceKey] === update.sourceVersion) continue;
      next ??= { ...this.doc, events: [...this.doc.events], sequences: { ...this.doc.sequences },
        sources: { ...this.doc.sources }, prunedThrough: { ...this.doc.prunedThrough } };
      const group = update.event.group_id, sequence = (next.sequences[group] ?? 0) + 1;
      next.events.push({ ...structuredClone(update.event), event_id: update.eventId ?? randomUUID(), sequence, cursor: this.cursor(group, sequence) });
      next.sequences[group] = sequence; next.sources[update.sourceKey] = update.sourceVersion;
    }
    if (!next) return;
    this.reclaim(next);
    const changedGroups = new Set(updates.filter(update => this.doc.sources[update.sourceKey] !== update.sourceVersion).map(update => update.event.group_id));
    this.write(next);
    for (const group of changedGroups) this.rejected.delete(group);
    this.reportCapacity();
  }
  private cursor(group: string, sequence: number): string { return Buffer.from(JSON.stringify({ v: 1, group, sequence })).toString('base64url'); }
  private decode(group: string, cursor: string): number {
    let value: { v?: number; group?: string; sequence?: number };
    try { value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { return integrationError('INVALID_EVENT_CURSOR', 'Invalid cursor'); }
    if (value.v !== 1 || value.group !== group || !Number.isSafeInteger(value.sequence) || value.sequence! < 0 || value.sequence! > (this.doc.sequences[group] ?? 0)) integrationError('INVALID_EVENT_CURSOR', 'Cursor does not belong to this group');
    return value.sequence!;
  }
  private key(principal: IntegrationPrincipal, consumer: string): string { identifier(consumer, 'consumer'); return `${principal.id}:${principal.groupId}:${consumer}`; }
  private selectPage(principal: IntegrationPrincipal, consumer: string, cursor?: string): { events: IntegrationEvent[]; cursor: string } {
    this.authorize(principal, 'events.read');
    const key = this.key(principal, consumer), group = principal.groupId;
    if (this.doc.consumerLifecycle?.[key]?.retired_at) integrationError('EVENT_CONSUMER_RETIRED', 'Administrator retired this consumer; reconcile and explicitly use a new consumer name', 409);
    const floor = this.doc.prunedThrough[group] ?? 0;
    // A new consumer explicitly starts at the earliest retained fact. Existing
    // consumers never silently skip a retention gap.
    if (this.doc.consumers[key] === undefined) {
      this.write({ ...this.doc, consumers: { ...this.doc.consumers, [key]: floor } });
    }
    const after = cursor ? this.decode(group, cursor) : this.doc.consumers[key];
    if (after < floor) integrationError('EVENT_RETENTION_GAP', 'Confirmed cursor is older than retained history; reconcile task/session snapshots and use a new consumer', 409);
    const events = this.groupEvents.get(group) ?? [];
    let lo = 0, hi = events.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (events[mid]!.sequence <= after) lo = mid + 1; else hi = mid; }
    return { events: events.slice(lo, lo + 100), cursor: this.cursor(group, after) };
  }
  page(principal: IntegrationPrincipal, consumer: string, cursor?: string): { events: IntegrationEvent[]; cursor: string } {
    return structuredClone(this.selectPage(principal, consumer, cursor));
  }
  /** Push uses immutable encoded facts rather than copying and re-encoding
   * every retained payload for each consumer. No mutable record escapes. */
  streamPage(principal: IntegrationPrincipal, consumer: string, cursor?: string) {
    const page = this.selectPage(principal, consumer, cursor);
    return { cursor: page.cursor, events: page.events.map(event => ({ sequence: event.sequence, cursor: event.cursor,
      line: Object.hasOwn(event, 'type') ? Buffer.from(`${JSON.stringify({ type: 'event', ...event })}\n`)
        : Buffer.concat([EVENT_PREFIX, this.encode(event).subarray(1), NEWLINE]) })) };
  }
  ack(principal: IntegrationPrincipal, consumer: string, cursor: string): { cursor: string; ack_semantics: 'durable_received' } {
    this.authorize(principal, 'events.read');
    const key = this.key(principal, consumer), sequence = this.decode(principal.groupId, cursor), confirmed = this.doc.consumers[key];
    if (this.doc.consumerLifecycle?.[key]?.retired_at) integrationError('EVENT_CONSUMER_RETIRED', 'Retired consumers cannot acknowledge', 409);
    if (confirmed === undefined) integrationError('EVENT_CONSUMER_NOT_STARTED', 'Subscribe before acknowledging');
    if (sequence < confirmed) integrationError('EVENT_ACK_REWIND', 'Acknowledgement cannot rewind');
    if (confirmed < (this.doc.prunedThrough[principal.groupId] ?? 0)) integrationError('EVENT_RETENTION_GAP', 'Consumer has a retention gap', 409);
    // Cursor is a cumulative declaration that every preceding event is safely
    // in the bridge inbox. The subscription server separately checks it was sent.
    if (sequence !== confirmed) this.write({ ...this.doc, consumers: { ...this.doc.consumers, [key]: sequence },
      consumerLifecycle: { ...this.doc.consumerLifecycle, [key]: { ...this.doc.consumerLifecycle?.[key], last_ack_at: Date.now() } } });
    return { cursor, ack_semantics: 'durable_received' };
  }
  cursorSequence(group: string, cursor: string): number { return this.decode(group, cursor); }
}
