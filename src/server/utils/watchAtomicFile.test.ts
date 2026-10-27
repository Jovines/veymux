// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { watchAtomicFile } from './watchAtomicFile.js';

const cleanup: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose(); vi.restoreAllMocks(); vi.useRealTimers(); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veymux-polling-'));
  cleanup.push(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'state.json'); fs.writeFileSync(file, 'initial');
  const replace = (value: string) => { fs.writeFileSync(`${file}.tmp`, value); fs.renameSync(`${file}.tmp`, file); };
  return { file, replace };
}
it.each(['ENOSPC', 'EMFILE', 'ENFILE'])('keeps observing atomic replacements after %s and stops on disposal', code => {
  vi.useFakeTimers();
  const { file, replace } = fixture(), changed = vi.fn(), failed = vi.fn();
  vi.spyOn(fs, 'watch').mockImplementation(() => { throw Object.assign(new Error('watch exhausted'), { code }); });
  const watcher = watchAtomicFile(file, changed, { onFallback: failed }); cleanup.push(() => watcher.close());
  vi.advanceTimersByTime(3_000); expect(changed).not.toHaveBeenCalled();
  replace('updated'); vi.advanceTimersByTime(1_040); expect(changed).toHaveBeenCalledTimes(1);
  expect(failed).toHaveBeenCalledTimes(1);
  watcher.close(); replace('after close'); vi.advanceTimersByTime(5_000);
  expect(changed).toHaveBeenCalledTimes(1);
});
it('releases a failed native watcher and polls without repeatedly acquiring new watchers', () => {
  vi.useFakeTimers();
  const { file, replace } = fixture(), changed = vi.fn();
  const native = Object.assign(new EventEmitter(), { close: vi.fn() });
  const watch = vi.spyOn(fs, 'watch').mockReturnValue(native as unknown as fs.FSWatcher);
  const watcher = watchAtomicFile(file, changed); cleanup.push(() => watcher.close());
  native.emit('error', Object.assign(new Error('exhausted'), { code: 'ENOSPC' }));
  expect(native.close).toHaveBeenCalledTimes(1);
  replace('runtime fallback'); vi.advanceTimersByTime(1_040);
  expect(changed).toHaveBeenCalledTimes(1); expect(watch).toHaveBeenCalledTimes(1);
  watcher.close(); expect(native.close).toHaveBeenCalledTimes(1);
});
it('coalesces parent events and cancels a pending delivery when closed', () => {
  vi.useFakeTimers();
  const { file } = fixture(), changed = vi.fn();
  let receive: (kind: string, name: string | null) => void = () => undefined;
  const native = Object.assign(new EventEmitter(), { close: vi.fn() });
  vi.spyOn(fs, 'watch').mockImplementation((...args: unknown[]) => {
    receive = args.at(-1) as typeof receive; return native as unknown as fs.FSWatcher;
  });
  const watcher = watchAtomicFile(file, changed); cleanup.push(() => watcher.close());
  receive('rename', 'other.json'); vi.advanceTimersByTime(100); expect(changed).not.toHaveBeenCalled();
  receive('rename', path.basename(file)); receive('change', path.basename(file));
  vi.advanceTimersByTime(40); expect(changed).toHaveBeenCalledTimes(1);
  receive('rename', null); watcher.close(); vi.advanceTimersByTime(1_000);
  expect(changed).toHaveBeenCalledTimes(1); expect(native.close).toHaveBeenCalledTimes(1);
});
