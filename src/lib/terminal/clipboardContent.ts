import { getVeymuxDesktopBridge } from '../desktop/nativeBridge';
import { readTerminalClipboardFiles, readTerminalClipboardImage, readTerminalClipboardVideos, TerminalClipboardVideoError } from './clipboardImage';

export type ClipboardContent = { kind: 'files'; files: File[]; paths: string[] } | { kind: 'text'; text: string } | { kind: 'empty' };
export interface ClipboardEventContent { files: File[]; text: string }
/** Without an active reader (notably LAN HTTP), leave the browser's native
 * paste event intact so its clipboardData can carry images and text. */
export function canReadClipboardContent(): boolean {
  const bridge = getVeymuxDesktopBridge();
  return !!(bridge?.readClipboardFiles || bridge?.readClipboardImage || navigator.clipboard?.read || navigator.clipboard?.readText);
}
/** Snapshot synchronously: browsers may clear clipboardData after the event. */
export function clipboardEventContent(data: Pick<DataTransfer, 'files' | 'items' | 'getData'>): ClipboardEventContent {
  const files = data.files.length ? Array.from(data.files) : Array.from(data.items || [])
    .filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((file): file is File => !!file);
  return { files, text: data.getData('text/plain') };
}

/** All input surfaces use the same native/event/browser precedence and one
 * browser permission request. Callers own insertion, upload destinations and UI. */
export async function readClipboardContent(event?: ClipboardEventContent, isCurrent: () => boolean = () => true): Promise<ClipboardContent> {
  const check = <T>(value: T): T => {
    if (!isCurrent()) throw new DOMException('目标服务已切换或粘贴操作已取消，请重新粘贴', 'AbortError');
    return value;
  };
  check(null);
  const bridge = getVeymuxDesktopBridge();
  if (!event && !canReadClipboardContent() && globalThis.isSecureContext === false) {
    throw new Error('HTTP 页面无法主动读取剪贴板。请使用 Ctrl/Cmd+V、选择文件，或切换 HTTPS / Mac 客户端。');
  }
  let nativeError: unknown;
  if (bridge?.readClipboardFiles) {
    try {
      const content = check(await readTerminalClipboardFiles());
      if (content.files.length || content.paths.length) return { kind: 'files', ...content };
    } catch (error) {
      check(null);
      if (error instanceof TerminalClipboardVideoError) throw error;
      nativeError = error;
    }
  }
  if (event?.files.length) return check({ kind: 'files', files: event.files, paths: [] });
  if (event?.text) return check({ kind: 'text', text: event.text });
  if (!bridge?.readClipboardImage && typeof navigator.clipboard?.read === 'function') {
    const items = check(await navigator.clipboard.read());
    const source = { read: async () => items };
    const videos = check(await readTerminalClipboardVideos(source));
    if (videos.length) return { kind: 'files', files: videos, paths: [] };
    const image = check(await readTerminalClipboardImage(source));
    if (image) return { kind: 'files', files: [image], paths: [] };
    for (const item of items) if (item.types.includes('text/plain')) {
      return { kind: 'text', text: check(await (check(await item.getType('text/plain'))).text()) };
    }
  } else if (bridge?.readClipboardImage) {
    const image = check(await readTerminalClipboardImage());
    if (image) return { kind: 'files', files: [image], paths: [] };
  }
  if (navigator.clipboard?.readText) {
    const text = check(await navigator.clipboard.readText());
    if (text) return { kind: 'text', text };
  }
  if (nativeError) throw nativeError;
  return { kind: 'empty' };
}
