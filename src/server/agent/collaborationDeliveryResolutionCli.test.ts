import { expect, it, vi } from 'vitest';
import { executeCollaborationCommand, parseCollaborationCommand } from './collaborationCli';
it('requires an explicit decision and observed attempt for owner reconciliation', async () => {
  for (const args of [[], ['--decision', 'retry'], ['--decision', 'retry', '--attempt', '0'], ['--decision', 'written', '--attempt', '1']]) {
    expect(() => parseCollaborationCommand(['message', 'resolve-delivery', 'original', ...args])).toThrow();
  }
  expect(() => parseCollaborationCommand(['message', 'get', 'original', '--attempt', '1'])).toThrow();
  const request = vi.fn(async () => ({ statusCode: 200, body: JSON.stringify({ ok: true, status: 'pending' }) }));
  const command = parseCollaborationCommand(['message', 'resolve-delivery', 'original', '--decision', 'retry', '--attempt', '3']);
  expect(await executeCollaborationCommand(command, { sessionId: 'recipient' }, { request, write: () => {} })).toBe(0);
  expect(request).toHaveBeenCalledExactlyOnceWith('POST', expect.stringContaining('/message/original/resolve-delivery'), expect.objectContaining({ action: 'retry', attempt: 3 }), 10000);
});
