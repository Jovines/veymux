/** A submitted resume command is not evidence that its conversation returned. */
export async function confirmRecoveryAgent(options: {
  expectedSlug: string;
  expectedNativeId: string;
  observe: () => Promise<{ slug: string | null; nativeId: string | null; shell?: boolean }>;
  timeoutMs?: number;
  intervalMs?: number;
  stableForMs?: number;
}): Promise<void> {
  const deadline = Date.now() + (options.timeoutMs ?? 120_000);
  let matchedAt: number | null = null, shellAt: number | null = null;
  do {
    const observed = await options.observe();
    if (observed.slug === options.expectedSlug && observed.nativeId === options.expectedNativeId) {
      matchedAt ??= Date.now();
      if (Date.now() - matchedAt >= (options.stableForMs ?? 1000)) return;
    } else matchedAt = null;
    if (observed.shell) {
      shellAt ??= Date.now();
      if (Date.now() - shellAt >= 3000) break;
    } else shellAt = null;
    if (observed.slug && (observed.slug !== options.expectedSlug
      || observed.nativeId && observed.nativeId !== options.expectedNativeId)) {
      throw Object.assign(new Error('A different Agent conversation is running in this terminal'), { code: 'RECOVERY_TARGET_BUSY' });
    }
    if (Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, options.intervalMs ?? 500));
  } while (Date.now() <= deadline);
  throw Object.assign(new Error('The original Agent conversation has not returned; check the terminal before retrying'), { code: 'RECOVERY_AGENT_UNCONFIRMED' });
}
