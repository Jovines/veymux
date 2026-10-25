import { savedConnection } from '../../federation/browserIntegration';
import { isContextReference, type ContextReference } from '../../terminal/contextReference';
export const FILE_REFERENCE_MIME = 'application/x-termdock-file-reference';
const service = () => savedConnection()?.targetPeerId || location.origin;
export function writeFileReferenceDrag(data: Pick<DataTransfer, 'setData'>, text: string, reference?: ContextReference): void {
  data.setData('text/plain', text);
  data.setData(FILE_REFERENCE_MIME, JSON.stringify({ service: service(), text, ...(reference ? { reference: { ...reference, text } } : {}) }));
}
/** A path from a different service must never be silently reused as local. */
export function readFileReferenceDrag(data: Pick<DataTransfer, 'getData'>): string | null {
  const raw = data.getData(FILE_REFERENCE_MIME);
  if (!raw) return null;
  try { const value = JSON.parse(raw); if (value.service !== service()) throw new Error('请在文件所属的服务中引用'); if (typeof value.text !== 'string' || !value.text) return null; return value.text; }
  catch (error) { if (error instanceof SyntaxError) return null; throw error; }
}

/** Rich metadata is opt-in; older drag payloads keep their original text behavior. */
export function readContextReferenceDrag(data: Pick<DataTransfer, 'getData'>): ContextReference | null {
  const text = readFileReferenceDrag(data);
  if (!text) return null;
  const value = JSON.parse(data.getData(FILE_REFERENCE_MIME));
  return isContextReference(value.reference) && value.reference.text === text ? value.reference : null;
}
