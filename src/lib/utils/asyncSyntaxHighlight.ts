import { highlightToLines, shouldHighlight, type RefractorNode } from './syntaxHighlight';
import type { ReactNode } from 'react';

let activeWorkers = 0;
/** Highlighting is optional. Never retry a failed/unsupported worker on the UI
 * thread, and never build an unbounded queue behind a pathological grammar. */
export function highlightLinesAsync(content: string, language: string, signal: AbortSignal): Promise<ReactNode[][] | null> {
  if (signal.aborted || typeof Worker === 'undefined' || activeWorkers >= 2 || content.length > 64 * 1024 || !shouldHighlight(content)) return Promise.resolve(null);
  return new Promise(resolve => {
    let worker: Worker;
    try { worker = new Worker(new URL('../workers/syntaxHighlight.worker.ts', import.meta.url), { type: 'module' }); }
    catch { resolve(null); return; }
    activeWorkers++;
    let finished = false;
    const finish = (value: ReactNode[][] | null) => {
      if (finished) return;
      finished = true; clearTimeout(timeout); signal.removeEventListener('abort', abort);
      worker.terminate(); activeWorkers--; resolve(value);
    };
    const abort = () => finish(null);
    const timeout = setTimeout(abort, 2000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = () => finish(null);
    worker.onmessageerror = () => finish(null);
    worker.onmessage = (event: MessageEvent<RefractorNode[] | null>) => {
      if (signal.aborted || !event.data) { finish(null); return; }
      try { finish(highlightToLines({ registered: () => true, highlight: () => event.data! }, content, language)); }
      catch { finish(null); }
    };
    try { worker.postMessage({ content, language }); } catch { finish(null); }
  });
}
