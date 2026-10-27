import fs from 'node:fs';
import path from 'node:path';

interface WatchOptions {
  debounceMs?: number;
  pollIntervalMs?: number;
  onFallback?: (error: unknown) => void;
}

/** Watch the parent for atomic replacements; stat one file if native watches fail. */
export function watchAtomicFile(file: string, changed: () => void, options: WatchOptions = {}): { close(): void } {
  let closed = false;
  let native: fs.FSWatcher | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let polling: ReturnType<typeof setInterval> | undefined;
  const signature = (): string => {
    try {
      const stat = fs.statSync(file, { bigint: true });
      return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
      return 'unavailable';
    }
  };
  let previous = signature();
  const notify = () => {
    if (closed) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = undefined;
      if (closed) return;
      previous = signature();
      changed();
    }, options.debounceMs ?? 40);
    debounce.unref?.();
  };
  const fallback = (error: unknown) => {
    if (closed || polling) return;
    native?.close(); native = undefined;
    polling = setInterval(() => {
      const next = signature();
      if (next === previous) return;
      previous = next;
      notify();
    }, options.pollIntervalMs ?? 1_000);
    polling.unref?.();
    options.onFallback?.(error);
  };
  try {
    native = fs.watch(path.dirname(file), { persistent: false }, (_type, name) => {
      if (!name || name.toString() === path.basename(file)) notify();
    });
    native.on('error', fallback);
  } catch (error) { fallback(error); }
  return {
    close() {
      closed = true;
      native?.close(); native = undefined;
      if (debounce) clearTimeout(debounce);
      if (polling) clearInterval(polling);
      debounce = undefined; polling = undefined;
    },
  };
}
