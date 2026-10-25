/** Only explicit file-tree/preview actions create this metadata. Text is never scanned. */
export interface ContextReference {
  kind: 'file' | 'directory' | 'code';
  path: string;
  text: string;
  id?: string;
  lines?: { start: number; end: number };
}

export function isContextReference(value: unknown): value is ContextReference {
  if (!value || typeof value !== 'object') return false;
  const reference = value as ContextReference;
  if (!['file', 'directory', 'code'].includes(reference.kind) || typeof reference.path !== 'string'
    || !reference.path.startsWith('/') || reference.path.length > 4096 || /[\r\n\0]/.test(reference.path)
    || typeof reference.text !== 'string' || !reference.text || reference.text.length > 32000) return false;
  if (reference.id !== undefined && (typeof reference.id !== 'string' || !/^[a-f\d-]{36}$/i.test(reference.id))) return false;
  const lines = reference.lines;
  if (lines && (!Number.isSafeInteger(lines.start) || !Number.isSafeInteger(lines.end) || lines.start < 1 || lines.end < lines.start)) return false;
  return reference.kind !== 'code' || !!lines;
}

export function contextReferenceLabel(reference: ContextReference): string {
  const name = reference.path.replace(/\/$/, '').split('/').pop() || '/';
  return reference.lines ? `${name} · L${reference.lines.start}${reference.lines.end === reference.lines.start ? '' : `–${reference.lines.end}`}` : name;
}
