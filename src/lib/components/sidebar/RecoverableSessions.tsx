import { History, LayoutGrid, RefreshCw, X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../../i18n';
import { useKeyboardLayer } from '../../hooks/useKeyboardLayer';
import { getSessionSnapshotPresentation } from '../../terminal/display';
import type { TmuxSessionSummary } from '../../terminal/types';
import { LoadingSpinner } from '../ui/Loading';

export function RecoverableSessions({ sessions, loading, attachingName, onRefresh, onRestore, onClose }: {
  sessions: TmuxSessionSummary[];
  loading: boolean;
  attachingName: string | null;
  onRefresh?: () => void;
  onRestore: (session: TmuxSessionSummary) => void;
  onClose?: (name: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [confirmingName, setConfirmingName] = useState<string | null>(null);
  const [closingName, setClosingName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closing = useRef(false);

  const dismiss = () => {
    setOpen(false);
    setConfirmingName(null);
    setError(null);
  };

  useKeyboardLayer(panel, open && sessions.length > 0, dismiss, () => trigger.current);

  useLayoutEffect(() => {
    if (!open || !sessions.length) return;
    const viewport = window.visualViewport;
    const position = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      if (!anchor || !panel.current) return;
      const left = (viewport?.offsetLeft ?? 0) + 8;
      const top = (viewport?.offsetTop ?? 0) + 8;
      const width = Math.max(0, (viewport?.width ?? window.innerWidth) - 16);
      const bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight) - 8;
      const panelWidth = Math.min(320, width);
      const above = Math.max(0, anchor.top - top - 6);
      const below = Math.max(0, bottom - anchor.bottom - 6);
      const openAbove = below < 240 && above > below;
      Object.assign(panel.current.style, {
        width: `${panelWidth}px`,
        left: `${Math.max(left, Math.min(anchor.right - panelWidth, left + width - panelWidth))}px`,
        top: `${openAbove ? anchor.top - 6 : anchor.bottom + 6}px`,
        maxHeight: `${Math.min(400, openAbove ? above : below)}px`,
        transform: openAbove ? 'translateY(-100%)' : 'none',
      });
    };
    position();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(position);
    if (trigger.current) observer?.observe(trigger.current);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    viewport?.addEventListener('resize', position);
    viewport?.addEventListener('scroll', position);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      viewport?.removeEventListener('resize', position);
      viewport?.removeEventListener('scroll', position);
    };
  }, [open, sessions.length]);

  useEffect(() => {
    if (!open) return;
    if (!sessions.length) { dismiss(); return; }
    const closeOutside = (event: Event) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !panel.current?.contains(event.target)) dismiss();
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
    };
  }, [open, sessions.length === 0]);

  const closeSession = async (name: string) => {
    if (!onClose || closing.current) return;
    closing.current = true;
    setClosingName(name);
    setError(null);
    try {
      await onClose(name);
      setConfirmingName(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : t('sidebar.closeRecoverableSessionFailed'));
    } finally {
      closing.current = false;
      setClosingName(null);
    }
  };

  if (sessions.length === 0) return null;

  return (
    <div data-sidebar-gesture-ignore className="flex shrink-0 items-center">
      <button ref={trigger} type="button" data-session-sidebar-header-action
        aria-label={t('sidebar.recoverableSessions')} title={`${t('sidebar.recoverableSessions')} (${sessions.length})`}
        aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined}
        onClick={() => { if (open) dismiss(); else setOpen(true); }}
        className={`relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${open ? 'bg-surface-2 text-foreground' : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground'}`}>
        <History size={16} />
        <span aria-hidden="true" className="absolute -right-0.5 top-0 inline-flex min-w-3.5 items-center justify-center rounded-full bg-surface-elevated px-0.5 text-[9px] leading-[14px] text-muted-foreground">{sessions.length > 99 ? '99+' : sessions.length}</span>
      </button>
      {open && createPortal(<div ref={panel} id={panelId} role="dialog" tabIndex={-1}
        data-sidebar-gesture-ignore aria-label={t('sidebar.recoverableSessions')}
        className="fixed z-popover flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/15 bg-surface shadow-[0_12px_32px_var(--app-shadow-soft)] outline-none animate-fade-in">
        <div className="flex shrink-0 items-center gap-2 border-b border-border/30 px-3 py-1">
          <History size={14} className="shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">{t('sidebar.recoverableSessions')}</span>
          <span className="text-[11px] text-muted-foreground">{sessions.length}</span>
          {onRefresh && <button type="button" onClick={onRefresh} disabled={loading || closingName !== null}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-surface-elevated hover:text-foreground disabled:opacity-50 md:h-8 md:w-8"
            aria-label={t('sidebar.refreshRecoverableSessions')} title={t('sidebar.refreshRecoverableSessions')}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>}
          <button type="button" aria-label={t('common.close')} onClick={() => { dismiss(); trigger.current?.focus({ preventScroll: true }); }}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-elevated hover:text-foreground md:h-8 md:w-8"><X size={14} /></button>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain space-y-0.5 p-1">
        {sessions.map(session => {
          const { displayName: title, displaySubtitle } = getSessionSnapshotPresentation({ ...session,
            // Compatibility for servers that predate projected tmux titles.
            name: session.friendlyName?.trim() || session.label?.trim() || `tmux:${session.name}` });
          const attaching = attachingName === session.name;
          const confirming = confirmingName === session.name;
          return (
            <div key={session.name}>
              <div className="flex min-w-0 items-center">
                <button type="button" disabled={attachingName !== null || closingName !== null || confirming}
                  onClick={() => onRestore(session)}
                  className="group flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-muted-foreground transition hover:bg-surface-elevated hover:text-foreground disabled:opacity-60 md:min-h-10"
                  aria-label={t('sidebar.restoreRecoverableSession', { name: title })} title={[title, session.cwd].filter(Boolean).join('\n')}>
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[rgb(var(--tmux-rgb)_/_0.11)] text-[color:var(--tmux)]">
                    {attaching ? <LoadingSpinner size={12} className="animate-spin" /> : <LayoutGrid size={12} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11.5px] font-semibold text-foreground">{title}</span>
                    {displaySubtitle && <span className="block truncate text-[9.5px] text-muted-foreground">{displaySubtitle}</span>}
                  </span>
                  <span className="shrink-0 text-[10px] font-medium text-[color:var(--tmux)] group-hover:text-foreground">
                    {attaching ? t('sidebar.restoringRecoverableSession') : t('sidebar.restore')}
                  </span>
                </button>
                {onClose && <button type="button" disabled={attachingName !== null || closingName !== null}
                  onClick={() => { setConfirmingName(session.name); setError(null); }}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-destructive/15 hover:text-destructive disabled:opacity-50 md:h-7 md:w-7"
                  aria-label={t('sidebar.closeSession', { name: title })} title={t('sidebar.closeSession', { name: title })}>
                  <X size={12} />
                </button>}
              </div>
              {confirming && <div role="group" aria-label={t('sidebar.closeSession', { name: title })} className="space-y-2 rounded-md bg-surface px-2 py-2">
                <p className="text-[11px] text-foreground">{t('sidebar.confirmCloseRecoverableSession', { name: title })}</p>
                {error && <p role="alert" className="text-[11px] text-destructive">{error}</p>}
                <div className="flex justify-end gap-2">
                  <button type="button" disabled={closingName !== null} onClick={() => { setConfirmingName(null); setError(null); }}
                    className="min-h-11 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-surface-elevated disabled:opacity-50 md:min-h-8">{t('common.cancel')}</button>
                  <button type="button" disabled={closingName !== null} onClick={() => void closeSession(session.name)}
                    className="min-h-11 rounded-md bg-destructive/15 px-2 text-[11px] text-destructive hover:bg-destructive/25 disabled:opacity-50 md:min-h-8">
                    {closingName === session.name ? t('common.loading') : t('sidebar.endRecoverableSession')}
                  </button>
                </div>
              </div>}
            </div>
          );
        })}
        </div>
      </div>, document.body)}
    </div>
  );
}
