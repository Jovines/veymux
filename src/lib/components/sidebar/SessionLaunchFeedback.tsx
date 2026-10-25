import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';

/** Creation has no measurable percentage; only report elapsed waiting time. */
export function SessionLaunchFeedback({ startedAt }: { startedAt: number }) {
  const { t } = useI18n();
  const [seconds, setSeconds] = useState(() => Math.floor((Date.now() - startedAt) / 1000));
  useEffect(() => {
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  if (seconds < 8) return null;
  return <div className="mb-2 rounded-lg bg-surface-2 px-2.5 py-2 text-[11px] leading-5 text-muted-foreground">
    <div className="flex items-center justify-between gap-2">
      <p role="status">{t('sidebar.sessionCreateWaiting')}</p>
      <span aria-hidden="true" className="shrink-0 tabular-nums">{t('sidebar.sessionCreateElapsed', { seconds })}</span>
    </div>
    <p>{t('sidebar.sessionCreateContinue')}</p>
  </div>;
}
