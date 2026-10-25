import React, { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { fetchQuota, type QuotaResult } from '../../terminal/api';

/** Compact service-account quota beside the active Codex session title. */
export function CodexQuotaBadge({ onOpen, compact = false }: { onOpen: () => void; compact?: boolean }): React.ReactElement | null {
  const { t } = useI18n();
  const [quota, setQuota] = useState<QuotaResult | null>(null);

  useEffect(() => {
    let disposed = false;
    let revision = 0;
    const apply = (providers: QuotaResult[]) => {
      setQuota(providers.find((provider) => provider.slug === 'codex') ?? null);
    };
    const load = async () => {
      const requestRevision = ++revision;
      try {
        const status = await fetchQuota();
        if (!disposed && requestRevision === revision) apply(status.providers);
      } catch {
        // Keep the last observed quota during a temporary connection failure.
      }
    };
    const onQuota = (event: Event) => {
      const providers = (event as CustomEvent<QuotaResult[]>).detail;
      if (!Array.isArray(providers)) return;
      revision++;
      apply(providers);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    window.addEventListener('termdock:quota-update', onQuota);
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    void load();
    return () => {
      disposed = true;
      window.removeEventListener('termdock:quota-update', onQuota);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (!quota || quota.error || quota.entitlement !== 100 || !Number.isFinite(quota.usagePercent)) return null;

  const remaining = Math.round(Math.max(0, Math.min(100, 100 - quota.usagePercent)));
  const label = t('quota.left', { n: `${remaining}%` });
  const color = quota.usagePercent >= 90 ? 'var(--destructive)'
    : quota.usagePercent >= 70 ? 'var(--warning)' : 'var(--success)';
  const title = [
    `Codex · ${label}`,
    t('quota.updated', { time: new Date(quota.fetchedAt).toLocaleString() }),
  ].join('\n');

  return (
    <button
      type="button"
      onClick={onOpen}
      title={title}
      aria-label={`Codex · ${label} · ${t('quota.title')}`}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md tabular-nums text-muted-foreground transition hover:bg-surface-elevated hover:text-foreground ${compact ? 'px-0 py-0 text-[9px] leading-3' : 'px-1.5 py-1 text-[10px]'}`}
    >
      <span aria-hidden="true" className="h-1 w-8 overflow-hidden rounded-full bg-surface-elevated">
        <span className="block h-full rounded-full transition-all duration-500" style={{ width: `${remaining}%`, background: color }} />
      </span>
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}
