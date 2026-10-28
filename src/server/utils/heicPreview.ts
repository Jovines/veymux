import { Worker } from 'node:worker_threads';

// Each decoder owns a WASM heap and the full decoded image. Bound workers
// globally, including workers that are still terminating after cancellation.
const MAX_CONVERSIONS = 2;
let activeConversions = 0;

export const HEIC_PREVIEW_MIME_TYPES: Record<string, string> = {
  '.heic': 'image/heic',
  '.heif': 'image/heif',
};

export function isHeicPreviewPath(filePath: string): boolean {
  const normalized = filePath.toLowerCase();
  return normalized.endsWith('.heic') || normalized.endsWith('.heif');
}

export function convertHeicPreview(filePath: string, signal?: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason ?? new Error('HEIC preview conversion was cancelled')); return; }
    if (activeConversions >= MAX_CONVERSIONS) {
      reject(Object.assign(new Error('图片转换繁忙，请稍后重试'), { code: 'HEIC_PREVIEW_BUSY', status: 503 }));
      return;
    }
    const worker = new Worker(new URL('../workers/heicPreviewWorker.js', import.meta.url), {
      workerData: { filePath },
    });
    activeConversions += 1;
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      void worker.terminate();
      callback();
    };
    const abort = () => {
      finish(() => reject(signal?.reason instanceof Error ? signal.reason : new Error('HEIC preview conversion was cancelled')));
    };

    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    worker.once('message', (message: { output?: Uint8Array; error?: string }) => {
      if (message.error) {
        finish(() => reject(new Error(message.error)));
        return;
      }
      const { output } = message;
      if (!output) {
        finish(() => reject(new Error('HEIC preview worker returned no image data')));
        return;
      }
      finish(() => resolve(Buffer.from(output.buffer, output.byteOffset, output.byteLength)));
    });
    worker.once('error', (error) => finish(() => reject(error)));
    worker.once('exit', (code) => {
      activeConversions -= 1;
      finish(() => reject(new Error(`HEIC preview worker exited without image data (code ${code})`)));
    });
  });
}
