import { expect, it, vi } from 'vitest';
import { readBoundedBlob } from './readBoundedBlob';
it('rejects oversized declared content before reading its stream', async () => {
  const cancel = vi.fn();
  const response = new Response(new ReadableStream({ cancel }), { headers: { 'Content-Length': '100' } });
  await expect(readBoundedBlob(response, 10, 'too large')).rejects.toThrow('too large');
  expect(cancel).toHaveBeenCalledOnce();
});
it('stops undeclared streams at the byte budget and accepts the exact limit', async () => {
  const cancel = vi.fn(); let count = 0;
  const body = new ReadableStream({ pull(controller) { count++; controller.enqueue(new Uint8Array(6)); }, cancel });
  await expect(readBoundedBlob(new Response(body), 10, 'too large')).rejects.toThrow('too large');
  expect(cancel).toHaveBeenCalledOnce(); expect(count).toBeLessThanOrEqual(3);
  expect((await readBoundedBlob(new Response('1234567890'), 10, 'too large')).size).toBe(10);
});
