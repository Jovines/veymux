import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, Folder, X } from 'lucide-react';
import { listDirectory, type FileEntry } from '../../terminal/api';
import { contextReferenceLabel } from '../../terminal/contextReference';
import { useKeyboardLayer } from '../../hooks/useKeyboardLayer';
import { ChatMarkdown } from './ChatMarkdown';
import type { ChatAttachment } from './chatComposerContent';

/** Code previews show the captured selection; directory previews only browse. */
export function ChatContextPreview({ file, close, open }: { file: ChatAttachment; close: () => void; open: (file: ChatAttachment) => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const [entries, setEntries] = useState<FileEntry[] | null>(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const reference = file.context!;
  useKeyboardLayer(panel, true, close);
  useEffect(() => {
    if (reference.kind !== 'directory') return;
    const controller = new AbortController();
    setEntries(null); setError('');
    void listDirectory(file.path, controller.signal).then(result => {
      if (!controller.signal.aborted) setEntries(result.entries);
    }).catch(() => { if (!controller.signal.aborted) setError('目录读取失败，请检查连接或访问权限。'); });
    return () => controller.abort();
  }, [file.path, reference.kind, attempt]);
  return createPortal(<div data-sidebar-gesture-ignore className="fixed inset-0 z-modal-backdrop flex items-center justify-center bg-[var(--app-backdrop)] preview-safe-area [--preview-safe-area-gap:0.5rem] sm:[--preview-safe-area-gap:1.5rem]" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <section ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={reference.kind === 'code' ? '代码引用预览' : '目录引用预览'} className="z-modal-panel flex max-h-full min-h-0 w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-surface text-foreground">
      <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-border/30 px-3">
        <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-medium">{contextReferenceLabel(reference)}</h2><p className="truncate text-xs text-muted-foreground" title={file.path}>{file.path}</p></div>
        {reference.kind === 'code' && <button type="button" className="min-h-11 rounded-lg px-3 text-xs text-primary hover:bg-surface-2" onClick={() => open({ ...file, context: { ...reference, kind: 'file' } })}>查看当前文件</button>}
        <button type="button" aria-label="关闭引用预览" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-2" onClick={close}><X size={17} /></button>
      </header>
      <div className="min-h-0 overflow-y-auto overscroll-contain p-4">
        {reference.kind === 'code' ? <div className="session-chat-markdown"><ChatMarkdown content={reference.text} /></div> : error ? <div role="alert" className="space-y-3 text-sm"><p>{error}</p><button type="button" className="min-h-11 rounded-lg bg-surface-2 px-4" onClick={() => setAttempt(value => value + 1)}>重试读取目录</button></div> : entries === null ? <p role="status" className="py-6 text-sm text-muted-foreground">正在读取目录…</p> : entries.length === 0 ? <p className="py-6 text-sm text-muted-foreground">此目录为空</p> : <ul className="space-y-1">{entries.map(entry => {
          const Icon = entry.type === 'directory' ? Folder : FileText;
          return <li key={entry.path}><button type="button" className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => open({ path: entry.path, name: entry.name, ...(entry.type === 'directory' ? { context: { kind: 'directory', path: entry.path, text: entry.path } } : {}) })}><Icon size={17} aria-hidden="true" className="shrink-0 text-primary" /><span className="min-w-0 truncate">{entry.name}</span></button></li>;
        })}</ul>}
      </div>
    </section>
  </div>, document.body);
}
