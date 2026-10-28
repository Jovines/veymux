import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useI18n } from '../../i18n';
import { findTextPreviewMatches, textPreviewPageAt, textPreviewPages, textPreviewRows } from '../../utils/textPreviewBudget';

export interface BoundedTextPreviewHandle { openSearch(): void }
export const BoundedTextPreview = forwardRef<BoundedTextPreviewHandle, {
  content: string;
  active?: boolean;
  embedded?: boolean;
  lineRange?: { start: number; end: number } | null;
  onLineClick?: (event: MouseEvent<HTMLElement>, line: number) => void;
  onReference?: (event: MouseEvent<HTMLElement>) => void;
  scrollToLine?: number | null;
  onScrollToLineHandled?: () => void;
}>(function BoundedTextPreview({ content, active = true, embedded = false, lineRange, onLineClick, onReference, scrollToLine, onScrollToLineHandled }, ref) {
  const { t } = useI18n();
  const pages = useMemo(() => textPreviewPages(content), [content]);
  const [requestedPage, setPage] = useState(0);
  const pageIndex = Math.min(requestedPage, pages.length - 1), current = pages[pageIndex];
  const rows = useMemo(() => textPreviewRows(content, current), [content, current]);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState({ offsets: [] as number[], limited: false, length: 0 });
  const [matchIndex, setMatchIndex] = useState(0);
  const [lineInput, setLineInput] = useState('');
  const input = useRef<HTMLInputElement>(null), scroller = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => ({ openSearch: () => { input.current?.focus(); input.current?.select(); } }), []);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => {
      const found = findTextPreviewMatches(content, query);
      setMatches(found); setMatchIndex(0);
      if (found.offsets.length) setPage(textPreviewPageAt(pages, found.offsets[0]));
    }, 120);
    return () => clearTimeout(timer);
  }, [content, query, pages, active]);
  const goToLine = (target: number) => {
    if (!Number.isSafeInteger(target) || target < 1) return;
    let offset = 0;
    for (let line = 1; line < target; line++) {
      const next = content.indexOf('\n', offset);
      if (next < 0) { offset = content.length; break; }
      offset = next + 1;
    }
    setPage(textPreviewPageAt(pages, offset));
  };
  useEffect(() => {
    if (scrollToLine == null) return;
    goToLine(scrollToLine); onScrollToLineHandled?.();
  }, [scrollToLine, content]);
  useEffect(() => { if (scroller.current) { scroller.current.scrollTop = 0; scroller.current.scrollLeft = 0; } }, [pageIndex]);
  const moveMatch = (direction: number) => {
    if (!matches.offsets.length) return;
    const next = (matchIndex + direction + matches.offsets.length) % matches.offsets.length;
    setMatchIndex(next); setPage(textPreviewPageAt(pages, matches.offsets[next]));
  };
  const selectedOffset = matches.offsets[matchIndex];
  useEffect(() => {
    scroller.current?.querySelector('mark')?.scrollIntoView?.({ block: 'nearest' });
  }, [pageIndex, selectedOffset, matches]);
  const button = 'min-h-11 min-w-11 shrink-0 rounded-lg px-2 text-xs hover:bg-surface-2 disabled:opacity-35';
  return <div data-bounded-text-preview style={embedded ? { maxHeight: '60vh', minHeight: 240 } : undefined} className="flex min-h-0 flex-1 flex-col overflow-hidden" onKeyDown={event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); input.current?.focus(); }
  }}>
    <div className="shrink-0 border-b border-border/15 px-2 text-muted-foreground">
      <div className="flex min-w-0 items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-xs" title={t('rightSidebar.boundedPreviewHint')}>{t('rightSidebar.boundedPreview')}</span>
        <button className={button} disabled={pageIndex === 0} aria-label={t('rightSidebar.previousPage')} onClick={() => setPage(pageIndex - 1)}>←</button>
        <span className="text-xs tabular-nums">{pageIndex + 1}/{pages.length}</span>
        <button className={button} disabled={pageIndex + 1 === pages.length} aria-label={t('rightSidebar.nextPage')} onClick={() => setPage(pageIndex + 1)}>→</button>
        <form onSubmit={event => { event.preventDefault(); goToLine(Number(lineInput)); }}>
          <input type="number" min="1" value={lineInput} onChange={event => setLineInput(event.target.value)} aria-label={t('rightSidebar.goToLine')} placeholder={t('rightSidebar.goToLine')} className="h-11 w-20 rounded-lg bg-surface-2 px-2 text-xs text-foreground" />
        </form>
        {onReference && lineRange && <button className={button} onClick={onReference}>{t('rightSidebar.insertFileRef')}</button>}
      </div>
      <div className="flex min-w-0 items-center gap-1">
        <input ref={input} type="search" maxLength={200} value={query} onChange={event => { setQuery(event.target.value); setMatches({ offsets: [], limited: false, length: 0 }); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); moveMatch(event.shiftKey ? -1 : 1); } }} aria-label={t('rightSidebar.findInFile')} placeholder={t('rightSidebar.findInFilePlaceholder')} className="h-11 min-w-0 flex-1 bg-transparent px-2 text-sm text-foreground outline-none" />
        <span aria-live="polite" className="text-xs tabular-nums">{matches.offsets.length ? matchIndex + 1 : 0}/{matches.offsets.length}{matches.limited ? '+' : ''}</span>
        <button className={button} disabled={!matches.offsets.length} aria-label={t('rightSidebar.previousSearchMatch')} onClick={() => moveMatch(-1)}>↑</button>
        <button className={button} disabled={!matches.offsets.length} aria-label={t('rightSidebar.nextSearchMatch')} onClick={() => moveMatch(1)}>↓</button>
      </div>
    </div>
    <div ref={scroller} className="veymux-native-select min-h-0 flex-1 overflow-auto p-2 font-mono text-xs leading-5 text-foreground" style={{ overflowWrap: 'anywhere' }}>
      {rows.map(row => {
        const start = selectedOffset == null ? -1 : Math.max(0, selectedOffset - row.offset);
        const end = selectedOffset == null ? -1 : Math.min(row.text.length, selectedOffset + matches.length - row.offset);
        const selected = lineRange && row.line >= lineRange.start && row.line <= lineRange.end;
        return <div key={row.offset} data-file-preview-line={row.line} role={onLineClick ? 'button' : undefined} tabIndex={onLineClick ? 0 : undefined}
          onClick={event => onLineClick?.(event, row.line)} onKeyDown={event => { if (onLineClick && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onLineClick(event as unknown as MouseEvent<HTMLElement>, row.line); } }}
          className={`grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-2 ${selected ? 'bg-surface-2' : ''}`}>
          <span className="min-w-8 select-none text-right text-muted-foreground">{row.continuation ? '↳' : row.line}</span>
          <span data-sidebar-selectable className="min-w-0 whitespace-pre-wrap select-text">{end > start && start >= 0 ? <>{row.text.slice(0, start)}<mark className="bg-primary/20 text-foreground">{row.text.slice(start, end)}</mark>{row.text.slice(end)}</> : row.text || ' '}</span>
        </div>;
      })}
    </div>
  </div>;
});
