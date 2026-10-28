import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { highlightLinesAsync } from './asyncSyntaxHighlight';
const workers: FakeWorker[] = [];
class FakeWorker {
  onmessage?: (event: { data: unknown }) => void;
  onerror?: () => void;
  postMessage = vi.fn(); terminate = vi.fn();
  constructor() { workers.push(this); }
}
beforeEach(() => { workers.length = 0; vi.useFakeTimers(); vi.stubGlobal('Worker', FakeWorker); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('caps workers and terminates cancelled or timed-out grammar work', async () => {
  const controller = new AbortController();
  const a = highlightLinesAsync('const a = 1', 'js', controller.signal);
  const b = highlightLinesAsync('const b = 2', 'js', new AbortController().signal);
  expect(await highlightLinesAsync('const c = 3', 'js', new AbortController().signal)).toBeNull();
  expect(workers).toHaveLength(2);
  controller.abort(); expect(await a).toBeNull(); expect(workers[0].terminate).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(2000); expect(await b).toBeNull(); expect(workers[1].terminate).toHaveBeenCalledOnce();
});
it('renders worker output and refuses large input without starting a worker', async () => {
  const result = highlightLinesAsync('hello', 'js', new AbortController().signal);
  workers[0].onmessage?.({ data: [{ type: 'text', value: 'hello' }] });
  expect(await result).toEqual([['hello']]); expect(workers[0].terminate).toHaveBeenCalledOnce();
  expect(await highlightLinesAsync('x'.repeat(100000), 'js', new AbortController().signal)).toBeNull();
  expect(workers).toHaveLength(1);
});
