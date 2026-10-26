import { afterEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { installBrowserUuid } from './browserCrypto';
afterEach(() => vi.unstubAllGlobals());
it('provides UUIDv4 on HTTP using getRandomValues without pretending WebCrypto is available', () => {
  const httpCrypto = { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) } as unknown as Crypto;
  vi.stubGlobal('crypto', httpCrypto); installBrowserUuid();
  const first = httpCrypto.randomUUID(), second = httpCrypto.randomUUID();
  expect(first).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  expect(first).not.toBe(second); expect(httpCrypto.subtle).toBeUndefined();
});
it('preserves the native implementation in secure contexts', () => {
  const randomUUID = vi.fn(); vi.stubGlobal('crypto', { randomUUID });
  installBrowserUuid(); expect(crypto.randomUUID).toBe(randomUUID);
});
