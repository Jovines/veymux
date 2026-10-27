import { LoadingSpinner as Loader2 } from '../../lib/components/ui/Loading';
import { useEffect, useState } from 'react';
import { ChevronRight, Server } from 'lucide-react';
import { listRelayTargets, prepareRelayConnection, inspectConnectionAccess, type ConnectionAccessStatus, type ConnectionIntent, type RelayTarget, type RelayTargetDirectory } from '../../lib/federation/browserIntegration';
import { DeviceAuthorizationRequired } from '../../lib/federation/deviceAuthorization';
import type { ServiceConnection } from '../../lib/services/serviceDirectory';
import { listServiceConnections, observeServiceConnections } from '../../lib/services/serviceDirectory';
import { relayTargetName, relayTargetFailure } from '../../lib/federation/relayTarget';
import { passwordLoginFailure } from '../../lib/federation/passwordLoginFailure';

type TargetAccess = { status?: ConnectionAccessStatus; error?: string; blocked?: boolean };
function targetAddress(target: RelayTarget, saved?: ServiceConnection): string | undefined {
  const address = target.url || saved?.serviceOrigin || (!saved?.entryServiceId ? saved?.url : undefined);
  if (address) try {
    const url = new URL(address);
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash) return url.origin;
  } catch { /* Unknown addresses remain unknown; never display credentials. */ }
}
function RelayServiceItem({ target, saved, entry, access, busy, choose }: {
  target: RelayTarget; saved?: ServiceConnection; entry: ServiceConnection; access?: TargetAccess; busy: boolean; choose: () => void;
}) {
  const name = saved?.label || relayTargetName(target), address = targetAddress(target, saved);
  const failure = !target.available ? relayTargetFailure(target) : access?.error;
  const targetPermission = !target.authorized || !target.available ? '未核验' : access?.status === 'authorized' ? '已授权'
    : access?.status === 'passwordRequired' ? '待登录' : access?.error ? '未确认' : '核验中';
  const action = !target.available || access?.blocked ? '暂不可连接' : !target.authorized ? '授权并连接'
    : access?.status === 'passwordRequired' ? '登录目标服务' : access?.status === 'authorized' ? '连接' : access?.error ? '重试连接' : '正在核验…';
  const platform = target.platform && ({ darwin: 'macOS', linux: 'Linux', win32: 'Windows', freebsd: 'FreeBSD', openbsd: 'OpenBSD', aix: 'AIX', sunos: 'SunOS', android: 'Android' } as Record<string, string>)[target.platform];
  return <article className="service-relay-item" aria-label={name}>
    <button type="button" className="service-row-open service-full-width service-relay-open" disabled={busy || !target.available || access?.blocked || target.authorized && !access} onClick={choose}>
      <span className="service-icon"><Server size={19} /></span>
      <span className="service-row-copy">
        <span className="service-relay-heading"><span className="service-name">{name}</span><span className="service-relay-status">{target.available ? '中转可用' : '中转不可用'}</span></span>
        <span className="service-relay-copy">{address || '仅中转连接 · 未提供直连地址'}</span>
        <span className="service-relay-copy">中转：{target.authorized ? '已授权' : '待授权'} · 目标访问：{targetPermission}</span>
        {failure && <span className="service-relay-failure">{failure}</span>}
        <span className="service-relay-action">{action}<ChevronRight size={14} /></span>
      </span>
    </button>
    <details className="service-relay-details">
      <summary aria-label={`${name}的服务详情`}>服务详情</summary>
      <dl>
        <dt>连接路径</dt><dd>此设备 → {entry.label} → {name}</dd>
        <dt>入口地址</dt><dd>{entry.serviceOrigin || entry.url}</dd>
        <dt>目标地址</dt><dd>{address || '目标未提供直连地址，通过入口中转连接'}</dd>
        <dt>机器名称</dt><dd>{target.hostname || '目标服务尚未提供'}</dd>
        <dt>系统 / 版本</dt><dd>{[platform, target.version && `Veymux ${target.version}`].filter(Boolean).join(' · ') || '目标服务尚未提供'}</dd>
        <dt>服务标识</dt><dd><code>{target.serviceId}</code></dd>
        {target.error && <><dt>诊断代码</dt><dd><code>{target.error}</code></dd></>}
      </dl>
    </details>
  </article>;
}
function accessFailure(error: unknown): TargetAccess {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (code === 'TARGET_PASSWORD_REQUIRED' || code === 'TARGET_SECURITY_UPGRADE_REQUIRED' || code === 'TARGET_IDENTITY_MISMATCH') return { error: relayTargetFailure({ error: code }), blocked: true };
  return { error: passwordLoginFailure(error).message };
}

export function RelayServices({ service, onBusyChange, onConnect, onConnectWithPassword }: {
  service: ServiceConnection;
  onBusyChange: (busy: boolean) => void;
  onConnect: (intent: ConnectionIntent) => void | Promise<void>;
  onConnectWithPassword?: (intent: ConnectionIntent, password: string) => Promise<void>;
}) {
  const [directory, setDirectory] = useState<RelayTargetDirectory>();
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState<ConnectionIntent>(), [password, setPassword] = useState('');
  const [access, setAccess] = useState<Record<string, TargetAccess>>({});
  const [savedServices, setSavedServices] = useState<ServiceConnection[]>([]);
  useEffect(() => {
    let disposed = false, sequence = 0;
    const load = async () => {
      const current = ++sequence;
      try {
        const services = await listServiceConnections();
        if (!disposed && current === sequence) setSavedServices(services);
      } catch { /* Public relay metadata remains usable without local bookmarks. */ }
    };
    void load();
    const unsubscribe = observeServiceConnections(() => void load());
    return () => { disposed = true; unsubscribe(); };
  }, []);
  useEffect(() => {
    let disposed = false, hasResult = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const checked = new Map<string, { at: number; value: TargetAccess }>();
    setLoading(true); setError(''); setDirectory(undefined); setAccess({}); setPending(undefined); setPassword('');
    const load = async (initial: boolean) => {
      try {
        const result = await listRelayTargets(service);
        if (disposed) return;
        hasResult = true; setDirectory(result); setError('');
        setLoading(false);
        const targets = result.items.filter(target => target.available && target.authorized);
        let index = 0;
        // Inspect only existing route grants, with bounded concurrency. The
        // target's permissions cannot be inferred from entry authorization.
        await Promise.all(Array.from({ length: Math.min(3, targets.length) }, async () => {
          while (!disposed && index < targets.length) {
            const target = targets[index++];
            const cached = checked.get(target.serviceId);
            if (cached && Date.now() - cached.at < 10_000) continue;
            let value: TargetAccess;
            try {
              const status = await inspectConnectionAccess({ url: result.route.url, entryServiceId: result.route.targetPeerId,
                targetPeerId: target.serviceId, routes: [result.route] }, controller.signal);
              value = status === 'invitationRequired' ? { error: relayTargetFailure({ error: 'TARGET_PASSWORD_REQUIRED' }), blocked: true } : { status };
            } catch (failure) { value = accessFailure(failure); }
            if (disposed) return;
            checked.set(target.serviceId, { at: Date.now(), value });
            setAccess(previous => ({ ...previous, [target.serviceId]: value }));
          }
        }));
      } catch (failure) {
        if (!disposed && (!hasResult || initial)) setError(failure instanceof Error ? failure.message : '暂时无法读取中转列表，请重试。');
      } finally {
        if (!disposed) {
          setLoading(false);
          timer = setTimeout(() => void load(false), 2_000);
        }
      }
    };
    void load(true);
    return () => { disposed = true; controller.abort(); clearTimeout(timer); };
  }, [service.id, service.url, revision]);
  useEffect(() => {
    const target = pending && directory?.items.find(item => item.serviceId === pending.targetPeerId);
    if (pending && directory && (!target || !target.available)) {
      setPending(undefined); setPassword(''); setError(target ? relayTargetFailure(target) : '该服务已不可见，请刷新列表或联系入口管理员。');
    }
  }, [directory, pending]);
  const run = async (task: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); onBusyChange(true); setError('');
    try { await task(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '暂时无法连接，请重试。'); }
    finally { setBusy(false); onBusyChange(false); }
  };
  const choose = async (target: RelayTarget) => {
    const intent = await prepareRelayConnection(directory!.route, target.serviceId);
    try {
      const status = await inspectConnectionAccess({ ...intent, url: directory!.route.url, serviceOrigin: undefined,
        entryServiceId: directory!.route.targetPeerId, routes: [directory!.route] });
      if (status === 'invitationRequired') {
        setAccess(previous => ({ ...previous, [target.serviceId]: { error: relayTargetFailure({ error: 'TARGET_PASSWORD_REQUIRED' }), blocked: true } }));
        return;
      }
      if (status === 'passwordRequired') { setPending(intent); return; }
      await onConnect(intent);
    }
    catch (failure) {
      if (!(failure instanceof DeviceAuthorizationRequired)) {
        const feedback = accessFailure(failure);
        setAccess(previous => ({ ...previous, [target.serviceId]: feedback })); throw new Error(feedback.error);
      }
      setPending(intent);
    }
  };
  return <div className="service-form">
    {pending ? <form className="service-form" onSubmit={event => { event.preventDefault(); void run(async () => {
      try { await onConnectWithPassword?.(pending, password); }
      catch (failure) {
        const code = passwordLoginFailure(failure).code;
        if (code === 'PASSWORD_NOT_CONFIGURED' || code === 'TARGET_PASSWORD_REQUIRED' || code === 'TARGET_SECURITY_UPGRADE_REQUIRED') {
          setAccess(previous => ({ ...previous, [pending.targetPeerId]: { error: relayTargetFailure({ error: code === 'TARGET_SECURITY_UPGRADE_REQUIRED' ? code : 'TARGET_PASSWORD_REQUIRED' }), blocked: true } }));
          setPending(undefined);
        }
        throw failure;
      } finally { setPassword(''); }
    }); }}>
      <p className="service-help">已通过“{service.label}”连接到“{pending.serviceName}”。请登录目标服务，完成此设备的访问授权。</p>
      {onConnectWithPassword ? <><label className="service-field"><span>目标服务密码</span><input type="password" autoFocus required autoComplete="current-password" value={password} disabled={busy} onChange={event => setPassword(event.target.value)} /></label>
        <button type="submit" className="service-button service-primary" disabled={busy || !password}>{busy ? '正在登录…' : '登录并连接'}</button></> : <p className="service-help">请让目标服务管理员邀请此设备后再连接。</p>}
      <button type="button" className="service-button service-secondary" disabled={busy} onClick={() => { setPending(undefined); setPassword(''); setError(''); setRevision(value => value + 1); }}>返回中转列表</button>
    </form> : <>
      <p className="service-help">通过“{service.label}”连接其他电脑。{directory?.canManage ? '首次连接会授权此设备使用中转；目标服务仍需单独登录。' : '仅显示此设备可用的中转；目标服务仍需单独登录。'}</p>
      {loading ? <p className="service-feedback" role="status"><Loader2 size={16} className="service-spinning" />正在读取可中转的服务…</p> : directory && <div className="service-list">
        {directory.items.map(target => <RelayServiceItem key={target.serviceId} target={target} saved={savedServices.find(item => item.targetPeerId === target.serviceId)} entry={service} access={access[target.serviceId]} busy={busy} choose={() => void run(() => choose(target))} />)}
        {directory.items.length === 0 && <p className="service-empty">{directory.canManage ? '暂无可中转的服务。可在本机 Mac 客户端连接目标服务，或在目标服务的“备用连接”中启用本入口。' : '暂无已授权的中转服务，请让入口管理员分享备用连接邀请。'}</p>}
      </div>}
      {busy && <p className="service-feedback" role="status"><Loader2 size={16} className="service-spinning" />正在授权并连接目标服务…</p>}
      {!loading && <button type="button" className="service-button service-secondary" disabled={busy} onClick={() => setRevision(value => value + 1)}>刷新列表</button>}
    </>}
    {error && <p className="service-error" role="alert">{error}</p>}
  </div>;
}
