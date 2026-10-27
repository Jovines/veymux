/** Bounded snapshots with one refresh per key, including forced refreshes.
 * Optional failure backoff rejects without returning stale observations. */
export class SharedSnapshotCache<K, V> {
  private readonly entries = new Map<K, { value: V; at: number }>();
  private readonly pending = new Map<K, Promise<V>>();
  private readonly failures = new Map<K, { count: number; retryAt: number; error: unknown }>();

  constructor(private readonly ttlMs: number, private readonly maxEntries = 256, private readonly failureBackoffMs = 0) {}

  get(key: K, load: () => Promise<V>, refresh = false): Promise<V> {
    const pending = this.pending.get(key);
    if (pending) return pending;
    const failure = this.failures.get(key);
    if (!refresh && failure && Date.now() < failure.retryAt) return Promise.reject(failure.error);
    const entry = this.entries.get(key);
    if (!refresh && entry && Date.now() - entry.at < this.ttlMs) return Promise.resolve(entry.value);
    const promise = Promise.resolve().then(load).then(value => {
      this.failures.delete(key);
      this.entries.delete(key);
      this.entries.set(key, { value, at: Date.now() });
      while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
      return value;
    }).catch(error => {
      if (this.failureBackoffMs > 0) {
        const count = (failure?.count ?? 0) + 1;
        this.failures.delete(key);
        this.failures.set(key, { count, error, retryAt: Date.now() + Math.min(30_000, this.failureBackoffMs * 2 ** (count - 1)) });
        while (this.failures.size > this.maxEntries) this.failures.delete(this.failures.keys().next().value!);
      }
      throw error;
    }).finally(() => { this.pending.delete(key); });
    this.pending.set(key, promise);
    return promise;
  }
}

export interface SampleEvent { type: string; [key: string]: unknown }

/** One non-overlapping sampler per session. Observers receive a full initial
 * snapshot and subsequent changes, including observers joining during a poll. */
export class SharedSessionSampler {
  private readonly observers = new Set<(event: SampleEvent) => void>();
  private readonly latest = new Map<string, { event: SampleEvent; signature: string }>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: Promise<void> | null = null;
  private epoch = 0;
  private failures = 0;
  private retryAt = 0;

  constructor(
    private readonly sample: () => Promise<SampleEvent[]>,
    private readonly intervalMs: () => number,
    private readonly onError: (error: unknown) => void,
  ) {}

  subscribe(observer: (event: SampleEvent) => void): () => void {
    this.observers.add(observer);
    for (const { event } of this.latest.values()) observer(event);
    if (!this.timer && !this.pending) void this.poll();
    return () => {
      this.observers.delete(observer);
      if (this.observers.size === 0) this.stop();
    };
  }

  stop(): void {
    this.epoch += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.failures = 0;
    this.retryAt = 0;
    this.latest.clear();
    this.observers.clear();
  }

  refresh(): void {
    if (!this.observers.size || this.pending) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.retryAt > Date.now()) {
      this.timer = setTimeout(() => { this.timer = null; void this.poll(); }, this.retryAt - Date.now());
      this.timer.unref?.();
    } else void this.poll();
  }

  private poll(): Promise<void> {
    if (this.pending) return this.pending;
    if (!this.observers.size) return Promise.resolve();
    const epoch = this.epoch;
    this.pending = Promise.resolve().then(this.sample).then(events => {
      if (epoch !== this.epoch) return;
      this.failures = 0;
      this.retryAt = 0;
      for (const event of events) {
        const signature = JSON.stringify(event);
        if (this.latest.get(event.type)?.signature === signature) continue;
        this.latest.set(event.type, { event, signature });
        for (const observer of this.observers) {
          try { observer(event); } catch (error) { this.onError(error); }
        }
      }
    }).catch(error => {
      if (epoch !== this.epoch) return;
      this.failures += 1;
      this.retryAt = Date.now() + Math.min(30_000, Math.max(1000, this.intervalMs()) * 2 ** (this.failures - 1));
      this.onError(error);
    }).finally(() => {
      this.pending = null;
      if (!this.observers.size) return;
      // Re-evaluate activity after every sample, rather than capturing the
      // interval when the first browser subscribes.
      const delay = epoch !== this.epoch ? 0 : Math.max(this.intervalMs(), this.retryAt - Date.now());
      this.timer = setTimeout(() => { this.timer = null; void this.poll(); }, delay);
      this.timer.unref?.();
    });
    return this.pending;
  }
}
