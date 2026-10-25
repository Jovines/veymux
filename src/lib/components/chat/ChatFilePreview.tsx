import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { requestReferenceInsertion } from '../sidebar/requestReferenceInsertion';
import { buildReferenceInputText } from '../sidebar/referencePaths';
import type { ContextReference } from '../../terminal/contextReference';
import { useKeyboardLayer } from '../../hooks/useKeyboardLayer';

const Preview = lazy(() => import('../sidebar/RightSidebar').then(module => ({ default: module.FilePreview })));

export function ChatFilePreview({ path: initialPath, close, sessionId, canWrite, rootPath = null, fragment = null, line }: {
  path: string; close: () => void; sessionId: string; canWrite: boolean;
  rootPath?: string | null; fragment?: string | null; line?: number;
}) {
  const [path, setPath] = useState(initialPath);
  const [scrollToLine, setScrollToLine] = useState<number | null>(line ?? null);
  const panel = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const [error, setError] = useState(''), [copied, setCopied] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 639px)').matches);
  const [outlineOpen, setOutlineOpen] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 639px)');
    const update = () => setIsMobile(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useKeyboardLayer(panel, true, close);
  const insert = async (text: string, source?: HTMLElement, reference?: ContextReference) => {
    if (!canWrite) { setError('此会话仅允许查看'); return; }
    const accepted = await requestReferenceInsertion(text, sessionId, () => panel.current?.isConnected === true, source, { reference });
    if (accepted) close(); else setError('暂时无法添加到输入框，请稍后重试。');
  };
  return createPortal(
    <div data-sidebar-gesture-ignore
      className="fixed inset-0 z-modal-backdrop flex items-center justify-center bg-[var(--app-backdrop)] preview-safe-area [--preview-safe-area-gap:0.5rem] sm:[--preview-safe-area-gap:1.5rem]"
      onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label="文件预览"
        className="z-modal-panel flex h-full min-h-0 w-full max-w-[1440px] flex-col overflow-hidden rounded-2xl border border-border bg-surface text-foreground">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {error && <p role="alert" className="px-4 py-2 text-xs text-destructive">{error}</p>}
          <Suspense fallback={<div className="flex items-center justify-between gap-3 p-3 text-sm"><p role="status" className="text-muted-foreground">正在读取文件…</p><button type="button" aria-label="关闭文件预览" onClick={close} className="min-h-11 rounded-xl bg-surface-2 px-4">关闭</button></div>}>
            <Preview filePath={path} rootPath={rootPath} onFileSelect={setPath} initialMarkdownFragment={fragment} onClose={close}
              presentation="dialog" canInsertReference={canWrite}
              onInsertReference={(path, _key, source) => { const text = buildReferenceInputText(path, null); void insert(text, source, { kind: 'file', path, text }); }}
              onInsertText={(text, _key, source, reference) => { void insert(text, source, reference); }}
              onReferenceCopied={setCopied} isMobile={isMobile}
              markdownOutlineOpen={outlineOpen} onOpenMarkdownOutline={() => setOutlineOpen(true)} onCloseMarkdownOutline={() => setOutlineOpen(false)} markdownImageLightboxOpen={false}
              lineRange={range} onLineRangeChange={setRange} scrollToLine={scrollToLine} onScrollToLineHandled={() => setScrollToLine(null)} insertedReferenceKey={null} copiedReferenceKey={copied} />
          </Suspense>
        </div>
      </div>
    </div>, document.body,
  );
}
