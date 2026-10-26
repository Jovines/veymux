/** Public, self-reported display information, never connection or authority data. */
export interface RelayServiceMetadata { hostname?: string; platform?: string; version?: string }
export function relayServiceMetadata(value: unknown): RelayServiceMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const text = (key: string, max: number) => typeof source[key] === 'string' && source[key].length <= max
    && !/[\p{Cc}\p{Cf}]/u.test(source[key]) ? source[key].trim() || undefined : undefined;
  const hostname = text('hostname', 120), platform = text('platform', 24), version = text('version', 48);
  return { ...(hostname ? { hostname } : {}),
    ...(['darwin', 'linux', 'win32', 'freebsd', 'openbsd', 'aix', 'sunos', 'android'].includes(platform || '') ? { platform } : {}),
    ...(version && /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version) ? { version } : {}) };
}
