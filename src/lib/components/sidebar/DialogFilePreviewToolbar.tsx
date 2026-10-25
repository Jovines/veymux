import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowLeft, Check, Copy, Download, Link2, Maximize2, MoreHorizontal, RefreshCw, Search, X } from 'lucide-react';
import { useKeyboardLayer } from '../../hooks/useKeyboardLayer';
import type { FileDownloadStatus } from '../../hooks/useFileDownload';
import { DownloadFeedback } from '../ui/DownloadFeedback';

interface Props {
  name: string;
  path: string;
  sizeLabel?: string;
  isMobile: boolean;
  back?: { label: string; go: () => void };
  view?: { label: string; toggle: () => void };
  fullscreen?: { label: string; toggle: () => void };
  reference?: { label: string; insert: (source: HTMLElement) => void };
  search?: { label: string; toggle: () => void };
  searchPanel?: ReactNode;
  warnings: string[];
  copied: boolean;
  copyError: string;
  onCopy: () => void;
  onRefresh: () => void;
  onClose?: () => void;
  download: { status: FileDownloadStatus; error: string | null; disabled: boolean; start: () => void; cancel: () => void };
}

/** One row belongs to navigation; optional information overlays the document. */
export function DialogFilePreviewToolbar({ name, path, sizeLabel, isMobile, back, view, fullscreen, reference, search, searchPanel, warnings, copied, copyError, onCopy, onRefresh, onClose, download }: Props) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null), popup = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useKeyboardLayer(popup, open, () => setOpen(false), () => trigger.current);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [open]);
  useEffect(() => { setOpen(false); }, [path]);
  const control = `inline-flex shrink-0 items-center justify-center gap-1 rounded-lg text-xs text-muted-foreground transition hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isMobile ? 'h-11 min-w-11' : 'h-8 min-w-8'}`;
  const action = 'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-foreground hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40';
  return <div data-file-preview-toolbar className="relative z-20 shrink-0 border-b border-border/30 bg-surface">
    <div className={`flex items-center gap-1 px-2 ${isMobile ? 'h-12' : 'h-10'}`}>
      {back && <button type="button" className={control} onClick={back.go} title={back.label} aria-label={back.label}><ArrowLeft size={16} /></button>}
      <span className="min-w-0 flex-1 truncate pr-2 text-[13px] font-medium" title={path}>{name}</span>
      {!isMobile && search && <button type="button" className={control} title={search.label} aria-label={search.label} onClick={search.toggle}><Search size={15} /></button>}
      {view && <button type="button" className={`${control} px-2`} onClick={view.toggle} title={view.label} aria-label={view.label}>{view.label}</button>}
      {fullscreen && <button type="button" className={control} onClick={fullscreen.toggle} title={fullscreen.label} aria-label={fullscreen.label}><Maximize2 size={16} /></button>}
      {reference && <button type="button" className={`${control} text-primary`} title={reference.label} aria-label={reference.label} onClick={event => reference.insert(event.currentTarget)}><Link2 size={16} /></button>}
      <div ref={container} className="shrink-0">
        <button ref={trigger} type="button" className={`${control} relative`} aria-label="更多文件操作" title={warnings.length ? '更多文件操作 · 有预览提示' : '更多文件操作'} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)}>
          {download.status === 'pending' ? <Download size={16} className="animate-pulse" /> : <MoreHorizontal size={18} />}
          {warnings.length > 0 && <span aria-label="有预览提示" className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[var(--warning)]" />}
        </button>
        {open && <div ref={popup} id={id} role="dialog" aria-label="文件信息与操作" tabIndex={-1} className="absolute right-2 top-full z-30 mt-1 max-h-[min(24rem,60dvh)] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain rounded-xl border border-border bg-surface p-1.5 shadow-xl">
          <div className="border-b border-border/40 px-3 pb-3 pt-2">
            <p className="text-xs font-medium text-foreground">文件信息</p>
            <p className="mt-1 break-all text-[11px] text-muted-foreground">{path}</p>
            {sizeLabel && <p className="mt-1 text-[11px] text-muted-foreground">{sizeLabel}</p>}
          </div>
          {warnings.length > 0 && <div className="border-b border-border/40 px-3 py-3"><p className="flex items-center gap-2 text-xs text-[color:var(--warning)]"><AlertTriangle size={13} />预览提示</p><ul className="mt-2 space-y-2 break-words text-[11px] text-muted-foreground">{warnings.map(message => <li key={message}>{message}</li>)}</ul></div>}
          {isMobile && search && <button type="button" className={action} onClick={() => { setOpen(false); search.toggle(); }}><Search size={16} />{search.label}</button>}
          <button type="button" className={action} onClick={onCopy}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? '已复制文件引用' : '复制文件引用'}</button>
          {copyError && <p role="alert" className="px-3 pb-2 text-xs text-destructive">{copyError}</p>}
          <button type="button" className={action} disabled={download.disabled && download.status !== 'pending'} onClick={download.status === 'pending' ? download.cancel : download.start}><Download size={16} />{download.status === 'pending' ? '取消下载' : '下载文件'}</button>
          <DownloadFeedback status={download.status} error={download.error} className="px-3 pb-2 text-xs" />
          <button type="button" className={action} onClick={() => { setOpen(false); onRefresh(); }}><RefreshCw size={16} />重新加载文件</button>
        </div>}
      </div>
      <button type="button" className={control} onClick={onClose} aria-label="关闭文件预览" title="关闭文件预览 (Esc)"><X size={17} /></button>
    </div>
    {searchPanel && <div className="px-2 pb-2">{searchPanel}</div>}
  </div>;
}
