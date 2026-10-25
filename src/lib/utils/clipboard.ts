import { getTermdockDesktopBridge } from '../desktop/nativeBridge';

/** Explicit user copy writes on this client, independently of service APIs. */
export async function writeClipboardText(text: string, current: () => boolean = () => true): Promise<boolean> {
  if (!current()) return false;
  const desktop = getTermdockDesktopBridge();
  if (desktop?.writeClipboardText) {
    try { await desktop.writeClipboardText(text); return current(); }
    catch { return false; }
  }
  try { await navigator.clipboard.writeText(text); return current(); }
  catch {
    if (!current()) return false;
    const previous = document.activeElement, textarea = document.createElement('textarea');
    textarea.value = text; textarea.readOnly = true; textarea.style.position = 'fixed'; textarea.style.left = '-9999px';
    document.body.append(textarea);
    try { textarea.select(); return current() && document.execCommand('copy'); }
    catch { return false; }
    finally {
      textarea.remove();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    }
  }
}
