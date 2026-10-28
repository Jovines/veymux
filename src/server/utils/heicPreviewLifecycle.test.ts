import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ workers: [] as any[] }));
vi.mock('node:worker_threads', () => ({
  Worker: class extends EventEmitter {
    terminate = vi.fn(async () => 0);
    constructor() { super(); state.workers.push(this); }
  },
}));

beforeEach(() => { state.workers = []; vi.resetModules(); });
describe('HEIC worker lifecycle', () => {
  it('does not spawn cancelled work and caps decoders until they actually exit', async () => {
    const { convertHeicPreview } = await import('./heicPreview.js');
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    await expect(convertHeicPreview('cancelled', controller.signal)).rejects.toThrow('cancelled');
    expect(state.workers).toHaveLength(0);
    const a = convertHeicPreview('a'), b = convertHeicPreview('b');
    await expect(convertHeicPreview('c')).rejects.toMatchObject({ code: 'HEIC_PREVIEW_BUSY', status: 503 });
    state.workers[0].emit('message', { output: new Uint8Array([1, 2]) });
    expect(await a).toEqual(Buffer.from([1, 2]));
    expect(state.workers[0].terminate).toHaveBeenCalledOnce();
    await expect(convertHeicPreview('still terminating')).rejects.toMatchObject({ code: 'HEIC_PREVIEW_BUSY' });
    state.workers[0].emit('exit', 1);
    const c = convertHeicPreview('c');
    state.workers[1].emit('message', { output: new Uint8Array([3]) });
    state.workers[2].emit('message', { output: new Uint8Array([4]) });
    await Promise.all([b, c]);
    state.workers[1].emit('exit', 0); state.workers[2].emit('exit', 0);
  });
  it('settles clean exits without data and aborts active work', async () => {
    const { convertHeicPreview } = await import('./heicPreview.js');
    const empty = convertHeicPreview('empty');
    const rejected = expect(empty).rejects.toThrow('without image data');
    state.workers[0].emit('exit', 0);
    await rejected;
    const controller = new AbortController();
    const active = convertHeicPreview('active', controller.signal);
    const cancelled = expect(active).rejects.toThrow('stop');
    controller.abort(new Error('stop'));
    await cancelled;
    expect(state.workers[1].terminate).toHaveBeenCalledOnce();
    state.workers[1].emit('exit', 1);
  });
});
