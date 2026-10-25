import { getActiveClient } from '../../federation/browserIntegration';
import { prepareSecureHtmlPreview, type SecureHtmlPreview } from '../../federation/secureHtmlPreview';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { AlertTriangle, Minimize2 as RiFullscreenExit } from 'lucide-react';
import { useKeyboardLayer } from '../../hooks/useKeyboardLayer';

export interface HtmlPreviewFrameHandle {
  toggleFullscreen: () => Promise<void>;
}

interface HtmlPreviewFrameProps {
  src: string;
  title: string;
  exitFullscreenLabel: string;
  onFullscreenChange?: (fullscreen: boolean) => void;
  onWarningsChange?: (warnings: string[]) => void;
  showInlineWarnings?: boolean;
}

export const HtmlPreviewFrame = forwardRef<HtmlPreviewFrameHandle, HtmlPreviewFrameProps>(function HtmlPreviewFrame({
  src,
  title,
  exitFullscreenLabel,
  onFullscreenChange,
  onWarningsChange,
  showInlineWarnings = true,
}, ref) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [iframe, setIframe] = useState<HTMLIFrameElement | null>(null);
  const [prepared, setPrepared] = useState<SecureHtmlPreview>();
  const [previewError, setPreviewError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); let preview: SecureHtmlPreview | undefined;
    setPrepared(undefined); setPreviewError(''); setWarnings([]);
    void (async () => {
      const client = await getActiveClient();
      preview = await prepareSecureHtmlPreview(src, { fetch: (path, init) => client.fetch(path, init), signal: abort.signal });
      if (abort.signal.aborted) { preview.dispose(); return; }
      setPrepared(preview); setWarnings(preview.errors);
    })().catch(error => { if (!abort.signal.aborted) setPreviewError(error instanceof Error ? error.message : '安全预览加载失败'); });
    return () => { abort.abort(); preview?.dispose(); };
  }, [src, attempt]);
  useEffect(() => {
    if (!prepared || !iframe) return;
    // One resource bridge belongs to the mounted opaque document, including
    // while it is expanded to fill the viewport.
    return prepared.attach(iframe, message => setWarnings(current => current.includes(message) ? current : [...current, message].slice(-20)), () => {
      if (document.activeElement !== iframe) return;
      if (document.fullscreenElement === rootRef.current) void document.exitFullscreen();
      else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
  }, [prepared, iframe]);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const [pseudoFullscreen, setPseudoFullscreen] = useState(false);
  const expanded = nativeFullscreen || pseudoFullscreen;
  useEffect(() => { onWarningsChange?.(warnings); }, [warnings, onWarningsChange]);

  useEffect(() => {
    onFullscreenChange?.(expanded);
  }, [expanded, onFullscreenChange]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setNativeFullscreen(document.fullscreenElement === rootRef.current);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!pseudoFullscreen || !root?.showPopover) return;
    // The top layer escapes transformed drawers without moving/reloading the
    // iframe. Reparenting a live iframe (including via a portal) resets it.
    root.setAttribute('popover', 'manual');
    try { root.showPopover(); } catch { root.removeAttribute('popover'); return; }
    return () => { root.hidePopover(); root.removeAttribute('popover'); };
  }, [pseudoFullscreen]);
  useKeyboardLayer(rootRef, pseudoFullscreen, () => setPseudoFullscreen(false));

  const toggleFullscreen = useCallback(async () => {
    const root = rootRef.current;
    if (!root) return;

    if (pseudoFullscreen) {
      setPseudoFullscreen(false);
      return;
    }
    if (document.fullscreenElement === root) {
      await document.exitFullscreen();
      return;
    }
    if (root.requestFullscreen && document.fullscreenEnabled !== false) {
      try {
        await root.requestFullscreen();
        return;
      } catch {
        // iOS/WebViews can expose the API but still reject element fullscreen.
      }
    }
    setPseudoFullscreen(true);
  }, [pseudoFullscreen]);

  useImperativeHandle(ref, () => ({ toggleFullscreen }), [toggleFullscreen]);

  const preview = (
    <div
      ref={rootRef}
      data-html-preview-frame
      className={expanded
        ? 'fixed inset-0 z-modal-panel m-0 flex h-full max-h-none min-h-0 w-full max-w-none flex-col overflow-hidden border-0 bg-surface p-0 preview-safe-area text-foreground'
        : 'flex h-full min-h-0 flex-col overflow-hidden bg-surface'}
    >
      {expanded && (
        <div className="relative z-20 flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/15 bg-[var(--chrome-bg)] px-2 sm:h-10">
          <span className="min-w-0 truncate text-[12px] font-semibold">{title}</span>
          <div className="flex shrink-0 items-center gap-1">
          {!showInlineWarnings && warnings.length > 0 && <details><summary aria-label="预览提示" title="预览提示" className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-lg text-[color:var(--warning)] hover:bg-surface-2 sm:h-8 sm:w-8 [&::-webkit-details-marker]:hidden"><AlertTriangle size={15} /></summary><ul className="absolute right-2 top-full z-30 mt-1 max-h-[50dvh] w-72 max-w-[calc(100vw-2rem)] space-y-2 overflow-auto break-words rounded-xl border border-border bg-surface-elevated p-3 text-xs text-muted-foreground shadow-xl">{warnings.map(message => <li key={message}>{message}</li>)}</ul></details>}
          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            aria-label={exitFullscreenLabel}
            title={`${exitFullscreenLabel} (Esc)`}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-surface-2 hover:text-foreground sm:h-8 sm:w-8"
          >
            <RiFullscreenExit size={15} />
          </button>
          </div>
        </div>
      )}
      {showInlineWarnings && warnings.length > 0 && <details className="shrink-0 border-b border-border px-3 text-xs text-muted-foreground"><summary className="cursor-pointer py-2">部分内容未能显示 · 查看原因</summary><ul className="max-h-24 list-disc space-y-1 overflow-auto break-words pb-2 pl-4">{warnings.map(message => <li key={message}>{message}</li>)}</ul></details>}
      {previewError && <div role="alert" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-4 text-center text-sm"><p className="font-medium">HTML 未能打开</p><p className="max-w-lg break-words text-xs text-muted-foreground">{previewError}</p><button type="button" className="min-h-11 rounded-xl bg-surface-2 px-4 hover:bg-surface-elevated" onClick={() => setAttempt(value => value + 1)}>重新加载</button></div>}
      {!prepared && !previewError && <div role="status" className="flex flex-1 items-center justify-center p-3 text-sm text-muted-foreground">正在加载 HTML…</div>}
      {prepared && <iframe
        ref={setIframe}
        src={prepared?.shellUrl}
        referrerPolicy="no-referrer"
        title={title}
        sandbox="allow-scripts"
        className="block min-h-0 w-full flex-1 border-0 bg-white"
      />}
    </div>
  );

  // Keep the same opaque document alive: fullscreen must retain scroll,
  // expanded sections, form values and its private resource bridge.
  return preview;
});
