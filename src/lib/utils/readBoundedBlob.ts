/** Enforce the limit while receiving, including peers without Content-Length. */
export async function readBoundedBlob(response: Response, maxBytes: number, message: string): Promise<Blob> {
  if (Number(response.headers.get('Content-Length')) > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(message);
  }
  if (!response.body) {
    const blob = await response.blob();
    if (blob.size > maxBytes) throw new Error(message);
    return blob;
  }
  const reader = response.body.getReader();
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new Error(message); }
      parts.push(value as Uint8Array<ArrayBuffer>);
    }
    return new Blob(parts, { type: response.headers.get('Content-Type') ?? '' });
  } finally { reader.releaseLock(); }
}
