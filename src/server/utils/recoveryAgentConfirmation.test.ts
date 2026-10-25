import { afterEach, expect, it, vi } from 'vitest';
import { confirmRecoveryAgent } from './recoveryAgentConfirmation';

afterEach(() => vi.useRealTimers());

it('waits beyond a recreated shell and a process without its native identity', async () => {
  vi.useFakeTimers();
  const observe = vi.fn().mockResolvedValueOnce({ slug: null, nativeId: null })
    .mockResolvedValueOnce({ slug: 'codex', nativeId: null })
    .mockResolvedValue({ slug: 'codex', nativeId: 'original' });
  const result = confirmRecoveryAgent({ expectedSlug: 'codex', expectedNativeId: 'original', stableForMs: 0, observe });
  await vi.advanceTimersByTimeAsync(1000);
  await expect(result).resolves.toBeUndefined();
  expect(observe).toHaveBeenCalledTimes(3);
});

it('refuses another conversation rather than clearing the recovery notice', async () => {
  await expect(confirmRecoveryAgent({ expectedSlug: 'codex', expectedNativeId: 'original',
    observe: async () => ({ slug: 'codex', nativeId: 'different' }) }))
    .rejects.toMatchObject({ code: 'RECOVERY_TARGET_BUSY' });
});

it('does not count a command that exits back to the shell as restored', async () => {
  vi.useFakeTimers();
  const result = expect(confirmRecoveryAgent({ expectedSlug: 'codex', expectedNativeId: 'original', timeoutMs: 1000,
    observe: async () => ({ slug: null, nativeId: null }) })).rejects.toMatchObject({ code: 'RECOVERY_AGENT_UNCONFIRMED' });
  await vi.advanceTimersByTimeAsync(1000);
  await result;
});


it('does not report success for a resume process that immediately exits back to its shell', async () => {
  vi.useFakeTimers();
  const observe = vi.fn().mockResolvedValueOnce({ slug: 'codex', nativeId: 'original' })
    .mockResolvedValue({ slug: null, nativeId: null, shell: true });
  const result = expect(confirmRecoveryAgent({ expectedSlug: 'codex', expectedNativeId: 'original', observe })).rejects.toMatchObject({ code: 'RECOVERY_AGENT_UNCONFIRMED' });
  await vi.advanceTimersByTimeAsync(4000); await result;
});
