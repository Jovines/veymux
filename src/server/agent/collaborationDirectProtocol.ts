/** Strict, canonical addressing for direct contacts. The origin is a pinned
 * service descriptor, never a URL to fetch from a message body. */
export function directRemoteAddress(id: string): { origin: string; id: string } | null {
  if (typeof id !== 'string' || !id.startsWith('remote:')) return null;
  const parts = id.slice(7).split(':');
  if (parts.length !== 2) return null;
  try {
    const origin = decodeURIComponent(parts[0]), sessionId = decodeURIComponent(parts[1]);
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin || !directLocalId(sessionId)
      || `remote:${encodeURIComponent(origin)}:${encodeURIComponent(sessionId)}` !== id) return null;
    return { origin, id: sessionId };
  } catch { return null; }
}
export function directLocalId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-zA-Z0-9._-]{1,160}$/.test(id);
}
