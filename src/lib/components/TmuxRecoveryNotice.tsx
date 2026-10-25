import { useState } from 'react';
import { AlertTriangle, CheckCircle2, RotateCcw } from 'lucide-react';
import { canDismissTmuxRecoveryOperation } from '../../server/utils/tmuxRecoveryDismissal';
import { useI18n } from '../i18n';
import type { SessionInventory } from '../terminal/types';

type Recovery = NonNullable<SessionInventory['tmuxRecovery']>;
export function TmuxRecoveryNotice({ recovery, pending, error, onRestore, onPause, onDismiss, onOpenSession }: {
  recovery: Recovery;
  pending: 'restore' | 'dismiss' | null;
  error: string | null;
  onRestore: () => void;
  onPause: () => void;
  onDismiss: () => void;
  onOpenSession?: (sessionId: string) => void;
}) {
  const { t } = useI18n();
  const [inspecting, setInspecting] = useState(false);
  const operation = recovery.operation;
  const done = operation?.state === 'succeeded';
  const active = Boolean(operation && !['succeeded', 'partial_failure'].includes(operation.state));
  const remaining = operation ? Math.max(0, operation.total - operation.succeeded) : recovery.sessions.length;
  const names = new Map(recovery.sessions.map(session => [session.sessionId, session.name]));
  const title = done ? t('tab.tmuxRecoverySuccess', { count: operation.total }) : t('tab.tmuxRecoveryTitle', { count: remaining });
  if (inspecting) return <section role="status" aria-live="polite"
    className="fixed inset-x-3 top-[calc(var(--safe-top-inset)+0.75rem)] z-toast mx-auto flex max-w-lg items-center gap-3 rounded-xl border border-warning/30 bg-surface-elevated px-3 py-2 shadow-lg">
    <span className="min-w-0 flex-1 truncate text-xs text-foreground">{title}</span>
    <button type="button" onClick={() => setInspecting(false)} className="min-h-11 shrink-0 rounded-lg px-3 text-xs text-primary hover:bg-surface-2">{t('tab.tmuxRecoveryReturn')}</button>
  </section>;
  return <section role={done ? 'status' : 'alert'} aria-live="polite" aria-label={title}
    className="fixed inset-x-3 top-[calc(var(--safe-top-inset)+0.75rem)] z-toast mx-auto flex max-h-[calc(100dvh-var(--safe-top-inset)-2rem)] max-w-lg flex-col rounded-2xl border border-warning/30 bg-surface-elevated px-4 py-3.5 shadow-[0_20px_60px_var(--app-shadow-strong)]">
    <div className={`flex shrink-0 items-center gap-2 ${done ? 'text-primary' : 'text-warning'}`}>
      {done ? <CheckCircle2 size={18} className="shrink-0" /> : <AlertTriangle size={18} className="shrink-0" />}
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
    </div>
    {!done && <p className="mt-2 shrink-0 text-xs text-muted-foreground">{t('tab.tmuxRecoveryHint')}</p>}
    {operation && !done && <div className="mt-3 shrink-0 space-y-1 text-xs text-muted-foreground" role="status">
      <progress className="h-2 w-full accent-primary" max={Math.max(1, operation.total)} value={operation.succeeded}
        aria-label={t('tab.tmuxRecoveryInProgress')} />
      <p>{t('tab.tmuxRecoveryPartial', { restored: operation.succeeded, failed: operation.failed })}</p>
      {operation.pauseReason === 'resources' && <p>{t('tab.tmuxRecoveryPausedForResources')}</p>}
      {active && !operation.pauseReason && <p>{operation.paused ? t('tab.tmuxRecoveryPause') : t('tab.tmuxRecoveryWaiting')}</p>}
    </div>}
    <div className="mt-3 min-h-0 overflow-y-auto overscroll-contain text-xs">
      <details open={!done}>
      <summary className="cursor-pointer py-2 text-muted-foreground">{t('tab.tmuxRecoveryDetails')}</summary>
      <ul className="space-y-1.5" aria-label={t('tab.tmuxRecoveryDetails')}>
        {(operation?.items ?? recovery.sessions.map(session => ({ sessionId: session.sessionId, state: 'queued' }))).map(item =>
          <li key={item.sessionId} className="flex min-w-0 items-center gap-3">
            <span className="min-w-0 flex-1 truncate text-foreground" title={names.get(item.sessionId)}>{names.get(item.sessionId) ?? item.sessionId}</span>
            {item.state === 'failed' && onOpenSession ? <button type="button" onClick={() => { setInspecting(true); onOpenSession(item.sessionId); }}
              className="min-h-11 shrink-0 rounded-lg px-2 text-primary hover:bg-surface-2">{t('tab.tmuxRecoveryInspect')}</button> : <span className={`shrink-0 ${item.state === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>
              {item.state === 'succeeded' ? t('tab.tmuxRecoveryDone') : item.state === 'failed' ? t('common.retry')
                : item.state === 'running' ? t('tab.tmuxRecoveryRestoring') : item.state === 'paused' || item.state === 'resource_wait'
                  ? t('tab.tmuxRecoveryPause') : t('tab.tmuxRecoveryWaiting')}
            </span>}
          </li>)}
      </ul>
      </details>
      {operation && <details className="mt-3 text-muted-foreground">
        <summary className="cursor-pointer py-2">{t('tab.tmuxRecoveryDiagnostics')}</summary>
        <p>{t('tab.tmuxRecoveryProgress', { total: operation.total, queued: operation.queued, paused: operation.paused_count,
          resourceWait: operation.resource_wait, running: operation.running, succeeded: operation.succeeded, failed: operation.failed })}</p>
        {operation.items.map(item => <p key={item.sessionId} className="mt-1 break-words">{names.get(item.sessionId) ?? item.sessionId}: {item.errorCode ?? item.resourceWaitReason ?? item.phase}{item.error ? ` · ${item.error}` : ''}</p>)}
      </details>}
    </div>
    {error && <p role="alert" className="mt-2 shrink-0 text-xs text-destructive">{error}</p>}
    <div className="mt-3 flex shrink-0 flex-wrap items-center gap-2">
      {!done && <button type="button" disabled={pending !== null || active} onClick={onRestore}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition active:opacity-80 disabled:opacity-50">
        <RotateCcw size={14} className={pending === 'restore' || active ? 'animate-spin' : ''} />
        {pending === 'restore' ? t('tab.tmuxRecoveryRestoring') : active ? t('tab.tmuxRecoveryInProgress') : operation?.failed ? t('tab.tmuxRecoveryRetryFailed') : t('tab.tmuxRecoveryRestoreAll')}
      </button>}
      {active && <button type="button" disabled={pending !== null} onClick={onPause}
        className="min-h-11 rounded-lg px-3 text-xs text-foreground hover:bg-surface-2 disabled:opacity-50">
        {operation?.paused ? t('tab.tmuxRecoveryResume') : t('tab.tmuxRecoveryPause')}
      </button>}
      <button type="button" disabled={pending !== null || Boolean(operation && !canDismissTmuxRecoveryOperation(operation))} onClick={onDismiss}
        className="min-h-11 rounded-lg px-3 text-xs text-muted-foreground hover:bg-surface-2 disabled:opacity-50">{done ? t('common.close') : t('tab.tmuxRecoveryDismiss')}</button>
    </div>
  </section>;
}
