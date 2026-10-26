/** getRandomValues remains available on HTTP. UUIDs are identifiers, not keys. */
export function installBrowserUuid(): void {
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID === 'function') return;
  Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128;
    const value = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
  } });
}
installBrowserUuid();
