import type { ReactNode } from 'react';
import { ChevronDown, RefreshCw as RiRefreshLine } from 'lucide-react';
import { useI18n } from '../../i18n';
import type { DesktopAppUpdateState, DesktopNativeSnapshot } from '../../desktop/nativeBridge';
import type { VeymuxUpdateState } from '../../terminal/api';
import type { ServiceUpdateContext } from '../../terminal/useServiceUpdatePlan';

interface VeymuxUpdateSettingsProps {
  state: VeymuxUpdateState | null;
  pending: boolean;
  onCheck: () => void;
  onConfirmRestart: () => void;
  updateContext?: ServiceUpdateContext;
  updateProgress?: string | null;
  desktopState?: DesktopAppUpdateState | null;
  desktopPending?: boolean;
  desktopSnapshot?: DesktopNativeSnapshot | null;
  desktopActions?: ReactNode;
  onCheckDesktop?: () => void;
  onInstallDesktop?: () => void;
}

export function VeymuxUpdateSettings({
  state,
  pending,
  onCheck,
  onConfirmRestart,
  updateContext,
  updateProgress,
  desktopState,
  desktopPending = false,
  desktopSnapshot,
  desktopActions,
  onCheckDesktop,
  onInstallDesktop,
}: VeymuxUpdateSettingsProps) {
  const { t } = useI18n();
  const status = state?.status ?? 'idle';
  const busy = pending || Boolean(updateContext?.busy) || status === 'checking' || status === 'installing' || status === 'restarting';
  const ready = updateContext ? updateContext.available : status === 'ready' && Boolean(state?.latestVersion);
  const statusText = status === 'checking'
    ? t('settings.updateChecking')
    : status === 'installing'
      ? t('sidebar.updateInstalling')
      : status === 'ready'
        ? t('sidebar.updateReady')
        : status === 'restarting'
          ? t('sidebar.updateRestarting')
          : status === 'current'
            ? t('settings.updateCurrent')
            : status === 'error'
              ? (state?.error || t('sidebar.updateFailed'))
              : t('settings.updateHint');
  const desktopVersion = desktopState?.currentVersion || desktopSnapshot?.appVersion;
  const desktopStatus = desktopState?.status ?? 'idle';
  const desktopBusy = desktopPending || desktopStatus === 'checking' || desktopStatus === 'downloading' || desktopStatus === 'installing';
  const desktopReady = desktopStatus === 'ready';
  const desktopStatusText = desktopState?.error || (desktopStatus === 'unsupported'
    ? t('settings.desktopUpdateUnsupported')
    : desktopStatus === 'checking'
      ? t('settings.desktopUpdateChecking')
      : desktopStatus === 'current'
        ? t('settings.desktopUpdateCurrent')
        : desktopStatus === 'downloading'
          ? t('settings.desktopUpdateDownloading')
          : desktopStatus === 'ready'
            ? t('settings.desktopUpdateReady')
            : desktopStatus === 'installing'
              ? t('settings.desktopUpdateInstalling')
              : desktopStatus === 'error'
                ? (desktopState?.error || t('settings.desktopUpdateHint'))
                : t('settings.desktopUpdateHint'));

  return (
    <section className="overflow-hidden rounded-xl bg-surface-2" aria-labelledby="veymux-update-title">
      <div id="veymux-update-title" className="px-3 pt-2 text-[12px] font-semibold text-foreground">
        {t('settings.updateTitle')}
      </div>
      <div className="grid sm:grid-cols-2">
        <div className={`${desktopState || desktopActions ? '' : 'sm:col-span-2'} flex items-center justify-between gap-3 px-3 py-2`}>
          <div className="flex min-w-0 items-start gap-2.5">
            <span
              className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${ready ? 'bg-[rgb(var(--warning-rgb)_/_0.16)] text-[color:var(--warning)]' : 'bg-primary/15 text-primary'}`}
            >
              <RiRefreshLine size={15} className={busy ? 'animate-spin' : ''} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <div className="text-[12px] font-medium text-foreground">{t('settings.updateServiceTitle')}</div>
                {state && (
                  <div className="text-[10px] tabular-nums text-muted-foreground/75">
                    {state.status === 'ready' && state.latestVersion ? `${state.currentVersion} → ${state.latestVersion}` : `v${state.currentVersion}`}
                  </div>
                )}
              </div>
              <div className="mt-0.5 text-[10px] leading-snug text-muted-foreground" role="status">
                {updateProgress || updateContext?.notice || statusText}
              </div>
            </div>
          </div>
          {ready ? (
            <button
              type="button"
              disabled={busy || !state?.currentVersion}
              onClick={onConfirmRestart}
              className={`min-h-11 max-w-[45%] shrink-0 rounded-full bg-[var(--warning)] px-3 py-1.5 text-[11px] font-semibold text-[color:var(--bg)] transition hover:opacity-90 disabled:cursor-wait disabled:opacity-60`}
            >
              {updateContext?.actionLabel || t('sidebar.updateRestart')}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={onCheck}
              className="min-h-11 max-w-[45%] shrink-0 rounded-full bg-surface px-3 py-1.5 text-[11px] font-medium text-foreground transition hover:bg-surface-elevated disabled:cursor-wait disabled:opacity-60"
            >
              {updateContext?.busy
                ? t('settings.updateCheckingShort')
                : status === 'checking'
                ? t('settings.updateCheckingShort')
                : status === 'installing'
                  ? t('settings.updateInstallingShort')
                  : status === 'error'
                    ? t('sidebar.updateRetry')
                    : status === 'current'
                      ? t('settings.updateCheckAgain')
                      : t('settings.updateCheck')}
            </button>
          )}
        </div>
        {(desktopState || desktopActions) && (
          <div className="flex items-center justify-between gap-3 border-t border-border/10 px-3 py-2 sm:border-l sm:border-t-0">
            <div className="flex min-w-0 items-start gap-2.5">
              <span
                className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${desktopReady ? 'bg-[rgb(var(--warning-rgb)_/_0.16)] text-[color:var(--warning)]' : 'bg-primary/15 text-primary'}`}
              >
                <RiRefreshLine size={15} className={desktopBusy ? 'animate-spin' : ''} />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <div className="text-[12px] font-medium text-foreground">{t('settings.desktopUpdateTitle')}</div>
                  <div className="text-[10px] tabular-nums text-muted-foreground/75">
                    {desktopReady && desktopState?.latestVersion
                      ? `${desktopState.currentVersion} → ${desktopState.latestVersion}`
                      : desktopVersion
                        ? `v${desktopVersion}`
                        : null}
                  </div>
                </div>
                <div
                  className={`mt-0.5 text-[10px] leading-snug ${desktopState?.error ? 'text-destructive' : 'text-muted-foreground'}`}
                  role={desktopState?.error ? 'alert' : undefined}
                >
                  {desktopState
                    ? desktopStatusText
                    : t(onCheckDesktop ? 'settings.desktopStatusLoading' : 'settings.desktopUpdateUnsupported')}
                </div>
              </div>
            </div>
            {desktopReady ? (
              <button
                type="button"
                disabled={desktopBusy || !onInstallDesktop}
                onClick={onInstallDesktop}
                className="min-h-11 max-w-[45%] shrink-0 rounded-full bg-[var(--warning)] px-3 py-1.5 text-[11px] font-semibold text-[color:var(--bg)] transition hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
              >
                {t('settings.desktopUpdateRestart')}
              </button>
            ) : (
              <button
                type="button"
                disabled={!desktopState || desktopBusy || desktopStatus === 'unsupported' || !onCheckDesktop}
                onClick={onCheckDesktop}
                className="min-h-11 max-w-[45%] shrink-0 rounded-full bg-surface px-3 py-1.5 text-[11px] font-medium text-foreground transition hover:bg-surface-elevated disabled:cursor-wait disabled:opacity-60"
              >
                {desktopStatus === 'installing'
                  ? t('settings.updateInstallingShort')
                  : desktopStatus === 'downloading'
                    ? t('settings.desktopUpdateDownloadingShort')
                    : desktopStatus === 'checking'
                      ? t('settings.updateCheckingShort')
                      : desktopStatus === 'current' || desktopStatus === 'error'
                        ? t('settings.desktopUpdateCheckAgain')
                        : t('settings.desktopUpdateCheck')}
              </button>
            )}
          </div>
        )}
      </div>
      {updateContext && <details className="group border-t border-border/10 px-3 py-1 text-[11px] text-muted-foreground">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 font-medium"><ChevronDown size={13} className="transition group-open:rotate-180" />{t('settings.updateDetails')}</summary>
        <ul className="space-y-2 pb-2">
          {updateContext.details.map(item => <li key={item.label} className="break-words"><span className="text-foreground">{item.label}</span><span className="block mt-0.5">{item.description}</span></li>)}
        </ul>
        {ready && <button type="button" disabled={busy} onClick={onCheck} className="mb-1 min-h-11 rounded-lg px-2 text-foreground transition hover:bg-surface-elevated disabled:opacity-60">{t('settings.updateCheckAgain')}</button>}
      </details>}
      {desktopActions}
    </section>
  );
}
