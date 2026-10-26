import { copyInvitationLink } from '../lib/utils/copyInvitationLink';
import { ShareResourceFields, ShareResourceSummary } from './ShareResourceFields';
import type { ShareResources } from '../server/shared/shareResources';
import { validSessionAppearances, type SessionAppearances } from '../server/shared/sessionAppearance';
import { ShareSessionAppearanceFields } from './ShareSessionAppearanceFields';
import { SessionIcon } from '../lib/federation/SessionIcon';
import { useKeyboardLayer } from '../lib/hooks/useKeyboardLayer';
import { LoadingSpinner as Loader2 } from '../lib/components/ui/Loading';
import type { DeviceProfile } from '../server/federation/deviceProfile';
import type { PendingInvitation } from '../server/federation/invitations';
import { RelayServices } from './services/RelayServices';
import { DeviceAuthorizationRequired } from '../lib/federation/deviceAuthorization';
import { describeInvitationFailure } from '../lib/federation/invitationFailure';
import { ServiceRoutes } from './services/ServiceRoutes';
import { ServiceManager, type ServiceNavigation } from './services/ServiceManager';
import { normalizeServiceAddress, saveServiceConnection, type ServiceConnection } from '../lib/services/serviceDirectory';
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { toDataURL } from 'qrcode';
import { parseInviteLink } from '../lib/federation/inviteLink';
import { DesktopInvitationButton } from './DesktopInvitationButton';
import { ArrowLeft, Check, ChevronDown, ChevronRight, Clock3, Copy, Link2Off, MessageCircle, Monitor, Plus, Pencil, QrCode, Server, Smartphone, TerminalSquare, WifiOff, X } from 'lucide-react';

export interface FederationConnection { certificateUrl?: string; url: string; targetPeerId: string; pairingCode?: string; serviceName?: string; serviceOrigin?: string; entryServiceId?: string; routeCode?: string; routeOnly?: boolean }
export interface FederationGrantInput {
  subjectId: string;
  resources?: ShareResources;
  sessionAppearance?: SessionAppearances;
  scope: { kind: 'service' } | { kind: 'sessions'; sessionIds: string[] };
  actions: string[];
  expiresAt?: number;
}
export interface FederationGrant extends FederationGrantInput { id: string; revokedAt?: number; label?: string; deviceProfile?: DeviceProfile; routeTargetServiceId?: string; routeTargetName?: string }
export interface FederationInviteInput {
  reusable?: boolean;
  linkExpiresAt?: number | null;
  viewLayout?: 'split';
  viewMode?: 'terminal' | 'chat';
  resources?: ShareResources;
  sessionAppearance?: SessionAppearances;
  includeBackup?: boolean;
  entryAddress?: string;
  scope: FederationGrantInput['scope'];
  actions: string[];
  label?: string;
  expiresAt?: number;
}
export interface FederationAccessProps {
  initialServicePage?: { kind: 'edit' | 'routes'; service: ServiceConnection };
  onConnect: (connection: FederationConnection) => void | Promise<void>;
  onClose: () => void;
  onConnectWithPassword?: (connection: FederationConnection, password: string) => Promise<void>;
  onAddService?: (input: string, password?: string) => Promise<{ passwordRequired?: boolean } | void>;
  onOpenService?: (service: ServiceConnection) => Promise<{ passwordRequired?: boolean } | void>;
  currentIdentity?: string;
  currentServiceName?: string;
  currentServiceId?: string;
  currentServiceOrigin?: string;
  loading?: boolean;
  loadError?: string;
  onRetry?: () => void;
  paired?: boolean;
  hasBackup?: boolean;
  inviteAddresses?: { url: string; label: string }[];
  initialInvite?: FederationConnection;
  initialShareSessionId?: string;
  initialShareSessionIds?: string[];
  initialViewLayout?: 'split';
  initialViewMode?: 'terminal' | 'chat';
  sessions?: { sessionId: string; name: string; sourceSessionId?: string }[];
  grants?: FederationGrant[];
  invitations?: PendingInvitation[];
  /** Legacy integration compatibility; invitations are the normal authorization flow. */
  onGrant?: (grant: FederationGrantInput) => void | Promise<void>;
  onCreateInvite?: (invite: FederationInviteInput) => Promise<{ id?: string; url: string; expiresAt: number | null; certificateFingerprint?: string }>;
  onRevokeInvitation?: (invitationId: string) => Promise<void>;
  onRename?: (subjectId: string, name: string) => Promise<void>;
  onRevoke?: (grantId: string) => void | Promise<void>;
}
const field = 'w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-ring sm:text-sm';
const button = 'appearance-none min-h-11 rounded-lg px-3 py-2 text-sm hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';
const primaryButton = `${button.replace('hover:bg-surface-2', '')} bg-primary text-primary-foreground hover:opacity-90`;
function connectionName(connection: FederationConnection) { return connection.serviceName || new URL(connection.url).hostname; }
function permissionName(actions: string[]) {
  if (actions.includes('service:*')) return '完整权限';
  if (actions.includes('session.input')) return '可操作';
  if (actions.includes('session.view')) return '只读';
  return [actions.includes('session.chat-view') ? actions.includes('session.chat-send') ? '对话可发送' : '对话只读' : '', actions.includes('session.terminal-view') ? actions.includes('session.terminal-input') ? '终端可操作' : '终端只读预览' : '', actions.includes('route.use') ? '仅中转' : ''].filter(Boolean).join(' · ') || '自定义权限';
}
function DeviceInformation({ profile, subjectId }: { profile?: DeviceProfile; subjectId: string }) {
  return <details className="mt-2 text-xs text-muted-foreground">
    <summary className="cursor-pointer leading-relaxed">{[profile?.model || profile?.hostname || profile?.system, profile?.route, `ID ${subjectId.slice(-8)}`].filter(Boolean).join(' · ')}</summary>
    <dl className="mt-2 space-y-2 rounded-lg bg-surface-2 p-3">
      {([['设备型号', profile?.model], ['主机名称', profile?.hostname], ['操作系统', profile?.system], ['客户端', profile?.client], ['打开方式', profile?.mode], ['处理器', profile?.cpu], ['架构', profile?.arch], ['最近连接路径', profile?.route], ['首次记录', profile?.firstSeenAt ? new Date(profile.firstSeenAt).toLocaleString() : undefined], ['最近连接', profile?.lastSeenAt ? new Date(profile.lastSeenAt).toLocaleString() : undefined], ['设备标识', subjectId]] as const).filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="mt-0.5 select-text break-all text-foreground">{value}</dd></div>)}
      <p className="leading-relaxed">{profile ? '系统、硬件与路径由设备报告；连接时间由服务记录。' : '此设备尚未报告详情，更新客户端并重新连接后可补齐。'}</p>
    </dl>
  </details>;
}
function qrColors() {
  const style = getComputedStyle(document.documentElement);
  const background = style.getPropertyValue('--background').trim(); const foreground = style.getPropertyValue('--foreground').trim();
  const brightness = (color: string) => {
    const rgb = color.replace('#', '');
    return parseInt(rgb.slice(0, 2), 16) * 0.299 + parseInt(rgb.slice(2, 4), 16) * 0.587 + parseInt(rgb.slice(4, 6), 16) * 0.114;
  };
  if (!background || !foreground) throw new Error('Theme unavailable');
  return brightness(background) < brightness(foreground) ? { dark: background, light: foreground } : { dark: foreground, light: background };
}
/** Pairing codes remain in component memory only and are cleared after successful use. */
export function FederationAccess({ onConnect, onClose, onConnectWithPassword, onAddService, onOpenService, currentIdentity, currentServiceName, currentServiceId, currentServiceOrigin, hasBackup = false, inviteAddresses = [], paired = false, initialInvite, initialServicePage, initialShareSessionId, initialShareSessionIds, initialViewLayout, initialViewMode, sessions = [], grants = [], invitations = [], onCreateInvite, onRevokeInvitation, onRevoke, onRename, loading = false, loadError, onRetry }: FederationAccessProps) {
  const [initialNeedsPassword, setInitialNeedsPassword] = useState(false);
  const [initialPassword, setInitialPassword] = useState('');
  const [inviteDismissed, setInviteDismissed] = useState(false);
  const [failedInvite, setFailedInvite] = useState<FederationConnection>();
  const [inviteFailure, setInviteFailure] = useState<ReturnType<typeof describeInvitationFailure>>();
  const [replacingInvite, setReplacingInvite] = useState(false);
  const [replacementLink, setReplacementLink] = useState('');
  const displayedInvite = failedInvite || (inviteDismissed ? undefined : initialInvite);
  useEffect(() => {
    setInviteDismissed(false); setFailedInvite(undefined); setInviteFailure(undefined);
    setInitialNeedsPassword(false); setInitialPassword('');
    setReplacingInvite(false); setReplacementLink('');
  }, [initialInvite?.url, initialInvite?.targetPeerId, initialInvite?.pairingCode, initialInvite?.routeCode]);
  const [serviceNavigation, setServiceNavigation] = useState<ServiceNavigation>({});
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const [inviting, setInviting] = useState(!!initialShareSessionId || !!initialShareSessionIds?.length); const [adding, setAdding] = useState(!paired);
  const [includeBackup, setIncludeBackup] = useState(true);
  const [entryAddress, setEntryAddress] = useState<string>(); const [customAddress, setCustomAddress] = useState('');
  const [preset, setPreset] = useState<'read' | 'write' | 'chat' | 'custom' | 'full'>('read');
  const [chatView, setChatView] = useState(true), [chatSend, setChatSend] = useState(true);
  const [terminalView, setTerminalView] = useState(false), [terminalControl, setTerminalControl] = useState(false);
  const [allowClear, setAllowClear] = useState(false), [reusable, setReusable] = useState(false), [linkExpiry, setLinkExpiry] = useState('600000');
  const [resource, setResource] = useState<'all' | 'selected'>('selected'); const [selectedIds, setSelectedIds] = useState<string[]>(() => { const match = sessions.find(s => s.sessionId === initialShareSessionId || s.sourceSessionId === initialShareSessionId); return match ? [match.sessionId] : sessions.length === 1 ? [sessions[0].sessionId] : []; });
  const [viewMode, setViewMode] = useState<'terminal' | 'chat'>(initialViewMode || 'chat');
  const [resources, setResources] = useState<ShareResources>({});
  const [sessionAppearance, setSessionAppearance] = useState<SessionAppearances>({});
  const [invitationSummary, setInvitationSummary] = useState<FederationInviteInput>();
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const [advanced, setAdvanced] = useState(false);
  const [moreOptions, setMoreOptions] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [expiryPreset, setExpiryPreset] = useState('never');
  const invitationGeneration = useRef(0);
  useEffect(() => () => { invitationGeneration.current++; }, []);
  const [label, setLabel] = useState(''); const [grantExpiry, setGrantExpiry] = useState('');
  const [invitation, setInvitation] = useState<{ id?: string; url: string; expiresAt: number | null; certificateFingerprint?: string }>(); const [qr, setQr] = useState('');
  const [pendingInvitationRevoke, setPendingInvitationRevoke] = useState<string>();
  const [pendingGrantRevoke, setPendingGrantRevoke] = useState<string>();
  const [tab, setTab] = useState<'services' | 'devices'>('services');
  const [editingDevice, setEditingDevice] = useState<string>();
  const [deviceLabel, setDeviceLabel] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<string>();
  const [selectingSessions, setSelectingSessions] = useState(false);
  const [draftSessionIds, setDraftSessionIds] = useState<string[]>([]);
  const selectionSources = useRef(new Map<string, string>());
  useEffect(() => {
    // Rebind an open dialog through stable inventory ids when the service
    // replaces its backend PTYs, including a transient empty directory.
    for (const session of sessions) selectionSources.current.set(session.sessionId, session.sourceSessionId || session.sessionId);
    const currentId = (id: string) => {
      const stable = selectionSources.current.get(id);
      return sessions.find(session => session.sessionId === id || (stable && session.sourceSessionId === stable))?.sessionId || id;
    };
    const rebind = (ids: string[]) => {
      const next = [...new Set(ids.map(currentId))];
      return next.every((id, index) => id === ids[index]) && next.length === ids.length ? ids : next;
    };
    setSelectedIds(rebind); setDraftSessionIds(rebind);
    setSessionAppearance(previous => Object.keys(previous).some(id => currentId(id) !== id)
      ? Object.fromEntries(Object.entries(previous).map(([id, value]) => [currentId(id), value])) : previous);
  }, [sessions]);
  const requestedIds = initialShareSessionIds?.length ? initialShareSessionIds : initialShareSessionId ? [initialShareSessionId] : [];
  const requestKey = JSON.stringify(requestedIds);
  const appliedShare = useRef<string>();
  const missingRequested = requestedIds.filter(id => !sessions.some(session => session.sessionId === id || session.sourceSessionId === id));
  useEffect(() => {
    if (!requestedIds.length || appliedShare.current === requestKey || missingRequested.length) return;
    appliedShare.current = requestKey;
    setSelectedIds([...new Set(requestedIds.map(id => sessions.find(session => session.sessionId === id || session.sourceSessionId === id)!.sessionId))]);
    setResource('selected'); setInviting(true); setAdding(false);
  }, [requestKey, sessions]);
  const currentOrigin = currentServiceOrigin || location.origin;
  const loopback = (address: string) => { try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(address).hostname); } catch { return false; } };
  const shareableAddresses = inviteAddresses.filter(address => !loopback(address.url));
  // Advertising mDNS does not establish that the recipient can resolve it.
  // Prefer a supplied LAN/IP address for links created from the local client.
  const suggestedAddress = loopback(currentOrigin) ? (shareableAddresses.find(address => !new URL(address.url).hostname.endsWith('.local')) || shareableAddresses[0])?.url || '' : '';
  const inviteAddress = entryAddress ?? suggestedAddress;
  let inviteHostname: string | undefined;
  try { inviteHostname = new URL(inviteAddress === 'custom' ? normalizeServiceAddress(customAddress) : inviteAddress || currentOrigin).hostname; } catch { /* Keep custom addresses editable. */ }
  const localInviteAddress = !!inviteHostname && ['localhost', '127.0.0.1', '[::1]'].includes(inviteHostname);
  const selectedSessions = sessions.filter(session => selectedIds.includes(session.sessionId));
  const effectiveViewMode = preset === 'chat' || preset === 'custom' && !terminalView ? 'chat' : preset === 'custom' && !chatView ? 'terminal' : viewMode;
  const shareNames = resource === 'all' || preset === 'full' ? '全部终端' : selectedSessions.map(session => sessionAppearance[session.sessionId]?.name || session.name).join('、');
  const setExpiry = (value: string) => {
    setExpiryPreset(value);
    if (value === 'never') setGrantExpiry('');
    else if (value !== 'custom') {
      const date = new Date(Date.now() + Number(value));
      setGrantExpiry(new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
    }
  };
  const activeGrants = grants.filter(grant => grant.revokedAt === undefined && (!grant.expiresAt || grant.expiresAt > Date.now()));
  const inactiveGrants = grants.filter(grant => !activeGrants.includes(grant));
  const devices = [...new Set(activeGrants.map(grant => grant.subjectId))].map(subjectId => {
    const own = activeGrants.filter(grant => grant.subjectId === subjectId);
    return { subjectId, grants: own, name: subjectId === currentIdentity ? '此设备' : own.find(grant => grant.label)?.label || '未命名设备' };
  }).sort((a, b) => Number(b.subjectId === currentIdentity) - Number(a.subjectId === currentIdentity));
  const overview = !editingDevice && !showDetails && paired && !adding && !inviting && !displayedInvite;
  const back = () => { setEditingDevice(undefined); setShowDetails(false); setAdding(false); setInviting(false); setInvitation(undefined); setAdvanced(false); setError(''); setNotice(''); setPendingRevoke(undefined); setPendingInvitationRevoke(undefined); setPendingGrantRevoke(undefined); setEntryAddress(undefined); setCustomAddress(''); setMoreOptions(false); setShowQr(false); setCopyState('idle'); invitationGeneration.current++; };
  const beginInvite = () => { setMoreOptions(false); setShowQr(false); setCopyState('idle'); invitationGeneration.current++; setInvitation(undefined); setInvitationSummary(undefined); setInviting(true); setAdding(false); setAdvanced(false); setError(''); setNotice(''); };
  const deviceName = (grant: FederationGrant) => grant.subjectId === currentIdentity ? '此设备' : grant.label || '未命名设备';
  const dismiss = () => { if (selectingSessions) setSelectingSessions(false); else if (replacingInvite) { setReplacingInvite(false); setReplacementLink(''); setError(''); } else onClose(); };
  const panel = useRef<HTMLDivElement>(null);
  useKeyboardLayer(panel, true, () => { if (!busy) dismiss(); });
  useLayoutEffect(() => { panel.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    let canceled = false; setQr('');
    if (invitation && showQr) {
      try { void toDataURL(invitation.url, { width: 220, margin: 3, errorCorrectionLevel: 'M', color: qrColors() }).then(data => { if (!canceled) setQr(data); }).catch(() => {}); } catch { /* Copying the invitation remains available. */ }
    }
    return () => { canceled = true; };
  }, [invitation, showQr]);
  async function connect(connection: FederationConnection) {
    setBusy(true); setError(''); setNotice(''); setInviteFailure(undefined);
    try {
      await onConnect(connection);
      const { url, targetPeerId, serviceName, serviceOrigin } = connection;
      await saveServiceConnection({ id: targetPeerId, url, targetPeerId, label: serviceName || new URL(url).host, serviceOrigin, entryServiceId: connection.entryServiceId });
      setFailedInvite(undefined); setInviteDismissed(true); setAdding(false); setNotice('已连接。');
    } catch (failure) {
      if (connection.routeOnly && failure instanceof DeviceAuthorizationRequired) { setFailedInvite(connection); setInitialNeedsPassword(true); }
      else if (connection.pairingCode || connection.routeCode) { setFailedInvite(connection); setInviteFailure(describeInvitationFailure(failure)); }
      else setError('暂时无法连接，请检查网络后重试。');
    }
    finally { setBusy(false); }
  }
  async function createInvitation(event?: FormEvent) {
    event?.preventDefault(); if (!onCreateInvite || missingRequested.length) return; setError(''); setNotice('');
    const selected = selectedIds.filter(id => sessions.some(s => s.sessionId === id));
    if (preset !== 'full' && resource === 'selected' && !selected.length) { setError('请选择至少一个 Session。'); return; }
    // Grant the stable client session id so replacing the backend PTY (restart,
    // tmux recovery, re-attach) never invalidates the invitation.
    const stableSelected = selected.map(id => sessions.find(s => s.sessionId === id)?.sourceSessionId || id);
    const appearance = Object.fromEntries(selected.flatMap(id => {
      const value = sessionAppearance[id], session = sessions.find(s => s.sessionId === id)!;
      const name = value?.name?.trim(), icon = value?.icon;
      const display = { ...(name && name !== session.name ? { name } : {}), ...(icon ? { icon } : {}) };
      return Object.keys(display).length ? [[session.sourceSessionId || id, display]] : [];
    }));
    if (preset !== 'full' && resource === 'selected' && !validSessionAppearances(appearance, { kind: 'sessions', sessionIds: stableSelected })) { setError('请检查分享名称和图标。'); return; }
    const expiresAt = grantExpiry ? new Date(grantExpiry).getTime() : undefined;
    if (expiresAt !== undefined && (!Number.isFinite(expiresAt) || expiresAt <= Date.now())) { setError('授权到期时间必须晚于现在。'); return; }
    let address: string | undefined;
    if (inviteAddress === 'custom') {
      try { address = normalizeServiceAddress(customAddress); } catch { setError('请输入有效的接入地址，例如 https://192.168.1.23:9834。'); return; }
    } else if (inviteAddress) address = inviteAddress;
    setBusy(true);
    try {
      const customActions = [...(chatView ? ['session.chat-view'] : []), ...(chatSend && chatView ? ['session.chat-send'] : []), ...(terminalView ? ['session.terminal-view'] : []), ...(terminalControl && terminalView ? ['session.terminal-input', 'session.resize'] : [])];
      if (preset === 'custom' && !chatView && !terminalView) throw new Error('请至少开放一种查看方式');
      const input: FederationInviteInput = { viewMode: effectiveViewMode,
        ...(reusable ? { reusable: true } : {}), ...(linkExpiry !== '600000' ? { linkExpiresAt: linkExpiry === 'never' ? null : Date.now() + Number(linkExpiry) } : {}),
        ...(initialViewLayout === 'split' && stableSelected.length > 1 ? { viewLayout: 'split' as const } : {}),
        ...(preset !== 'full' && resource === 'selected' && Object.keys(appearance).length ? { sessionAppearance: appearance } : {}),
        ...(preset !== 'full' && (resources.android?.length || resources.computers?.length || resources.directories?.length) ? { resources } : {}),
        ...(hasBackup ? { includeBackup } : {}),
        ...(address ? { entryAddress: address } : {}),
        scope: preset === 'full' || resource === 'all' ? { kind: 'service' } : { kind: 'sessions', sessionIds: stableSelected },
        actions: preset === 'full' ? ['service:*'] : [...(preset === 'write' ? ['session.view', 'session.input', 'session.resize'] : preset === 'chat' ? ['session.chat-view', 'session.chat-send'] : preset === 'custom' ? customActions : ['session.view']), ...(allowClear ? ['session.chat-clear'] : [])],
        ...(label.trim() ? { label: label.trim() } : {}), ...(expiresAt === undefined ? {} : { expiresAt }),
      };
      const generation = ++invitationGeneration.current;
      const pending = onCreateInvite(input);
      // Start clipboard access while this submit still has user activation.
      const copying = copyInvitationLink(pending.then(result => result.url));
      const result = await pending;
      if (generation !== invitationGeneration.current) return;
      setInvitationSummary(input); setInvitation(result); setShowQr(false); setCopyState('idle');
      void copying.then(copied => { if (generation === invitationGeneration.current) setCopyState(copied ? 'copied' : 'failed'); });
    } catch (failure) { setError(failure instanceof Error && failure.message.startsWith('无法分享备用连接：') ? '无法分享备用连接：需要入口管理员授权。你也可以关闭“包含备用连接”，生成直连邀请。' : '暂时无法生成邀请，请确认当前设备有授权管理权限。'); }
    finally { setBusy(false); }
  }
  async function copyInvite() {
    if (!invitation || (invitation.expiresAt !== null && invitation.expiresAt <= Date.now())) return;
    const generation = invitationGeneration.current;
    const copied = await copyInvitationLink(invitation.url);
    if (generation === invitationGeneration.current) setCopyState(copied ? 'copied' : 'failed');
  }
  const scopeDescription = (scope: FederationGrantInput['scope'], appearance?: SessionAppearances) => scope.kind === 'service' ? '全部终端' : scope.sessionIds.map(id => appearance?.[id]?.name || sessions.find(session => session.sessionId === id || session.sourceSessionId === id)?.name || id).join('、');
  const invitationRevokeControl = (id: string) => !onRevokeInvitation ? null : pendingInvitationRevoke === id ? <div className="mt-2 rounded-lg border border-border bg-background p-3 text-left">
    <p className="text-xs leading-relaxed">撤销后，原邀请链接和二维码将立即失效。可重复链接产生的访问授权也会同时撤销。</p>
    <div className="mt-2 flex justify-end gap-2"><button type="button" className={`${button} text-xs text-muted-foreground`} disabled={busy} onClick={() => setPendingInvitationRevoke(undefined)}>取消</button><button type="button" className={`${button} text-xs text-destructive`} disabled={busy} onClick={async () => {
      setBusy(true); setError(''); setNotice('');
      try { await onRevokeInvitation(id); if (invitation?.id === id) { invitationGeneration.current++; setInvitation(undefined); setCopyState('idle'); setShowQr(false); } setPendingInvitationRevoke(undefined); setNotice('邀请已撤销，原链接和二维码已失效。'); }
      catch { setError('暂时无法撤销。如果邀请已被接受，请在设备列表撤销访问权限。'); }
      finally { setBusy(false); }
    }}>确认撤销邀请</button></div>
  </div> : <button type="button" className={`${button} text-xs text-destructive`} disabled={busy} onClick={() => { setPendingInvitationRevoke(id); setNotice(''); }}>撤销邀请</button>;
  const title = replacingInvite ? '输入新的邀请链接' : serviceNavigation.title || (editingDevice ? '设备名称' : showDetails ? (tab === 'devices' ? '授权详情' : '连接详情') : selectingSessions ? '选择终端' : inviting ? '分享' : adding && paired ? '添加服务' : paired ? '服务与设备' : '连接 Termdock');
  const showBack = replacingInvite || !!serviceNavigation.back || !!editingDevice || showDetails || selectingSessions || (paired && (adding || inviting));
  const returnToOverview = () => { if (replacingInvite) { setReplacingInvite(false); setReplacementLink(''); setError(''); return; } if (serviceNavigation.back) { serviceNavigation.back(); return; } if (selectingSessions) setSelectingSessions(false); else back(); };
  const scopeName = (deviceGrants: FederationGrant[]) => deviceGrants.every(grant => grant.routeTargetServiceId) ? `${new Set(deviceGrants.map(grant => grant.routeTargetServiceId)).size} 台服务` : deviceGrants.some(grant => grant.scope.kind === 'service') ? '全部终端' : `${new Set(deviceGrants.flatMap(grant => grant.scope.kind === 'sessions' ? grant.scope.sessionIds : [])).size} 个终端`;
  return createPortal(<div className="fixed inset-0 z-modal-backdrop flex items-end justify-center bg-[var(--app-backdrop)] backdrop-blur-sm sm:items-center sm:p-6" data-sidebar-gesture-ignore onMouseDown={event => { if (event.target === event.currentTarget && !busy) dismiss(); }}>
    <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="federation-title" className="z-modal-panel flex max-h-[calc(100dvh-env(safe-area-inset-top)-12px)] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-border bg-surface font-sans text-foreground shadow-xl outline-none sm:max-h-[min(800px,92dvh)] sm:rounded-2xl">
      <header className="shrink-0 border-b border-border px-5 pt-3">
        <div className="flex min-h-12 items-center gap-2 pb-2">
          {showBack && <button type="button" className={`${button} -ml-3 inline-flex w-11 items-center justify-center text-muted-foreground`} disabled={busy} onClick={returnToOverview} aria-label={replacingInvite ? '返回邀请' : selectingSessions ? '取消选择终端' : tab === 'devices' ? '返回设备' : '返回服务'}><ArrowLeft size={20} /></button>}
          <h2 id="federation-title" className="min-w-0 flex-1 text-base font-semibold">{title}</h2>
          <button type="button" className={`${button} -mr-3 inline-flex w-11 items-center justify-center text-muted-foreground`} disabled={busy} onClick={dismiss} aria-label="关闭"><X size={20} /></button>
        </div>
        {overview && !serviceNavigation.title && <div className="flex gap-6" role="tablist" aria-label="管理内容">{([['services', '服务'], ['devices', '设备']] as const).map(([value, name]) => <button type="button" key={value} role="tab" aria-selected={tab === value} aria-controls={`federation-${value}`} id={`federation-tab-${value}`} className={`min-h-11 border-b-2 px-1 text-sm transition ${tab === value ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`} onClick={() => { setTab(value); setAdvanced(false); setPendingRevoke(undefined); setError(''); setNotice(''); }}>{name}{value === 'devices' && devices.length > 0 && <span className="ml-1.5 text-xs text-muted-foreground">{devices.length}</span>}</button>)}</div>}
      </header>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-4 pb-[max(20px,env(safe-area-inset-bottom))]">
        {((overview && tab === 'services') || (adding && !inviting && !displayedInvite)) && <ServiceManager initialServicePage={initialServicePage} renderRelayServices={(service, onBusyChange) => <RelayServices service={service} onBusyChange={onBusyChange} onConnect={onConnect} onConnectWithPassword={onConnectWithPassword} />} renderRoutes={(service, onBusyChange) => <ServiceRoutes service={service} onBusyChange={onBusyChange} />} hideHeader initiallyAdding={adding} current={currentServiceId ? { id: currentServiceId, targetPeerId: currentServiceId, url: currentServiceOrigin || location.origin, label: currentServiceName || '当前服务' } : undefined} onNavigation={setServiceNavigation} onBusyChange={setBusy} onInvite={onCreateInvite ? beginInvite : undefined}
          onOpen={async service => { if (onOpenService) return onOpenService(service); else if (service.targetPeerId) await connect({ ...service, targetPeerId: service.targetPeerId, serviceName: service.label }); else if (onAddService) await onAddService(service.url); }}
          onAdd={async (input, password) => {
            if (onAddService) return onAddService(input, password);
            await connect(parseInviteLink(input));
          }} />}
        {overview && tab === 'devices' && <section role="tabpanel" id="federation-devices" aria-labelledby="federation-tab-devices">
          <p className="mb-2 text-xs leading-relaxed text-muted-foreground">可访问此服务的设备</p>
          {loading ? <p role="status" className="flex items-center gap-2 py-5 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" />正在读取设备…</p> : <div className="divide-y divide-border">{devices.map(device => <div key={device.subjectId} className="py-3">
            <div className="flex items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted-foreground">{/iPhone|iPad|Android|手机|平板/i.test(device.grants.find(grant => grant.label)?.label || (device.subjectId === currentIdentity ? navigator.userAgent : '')) ? <Smartphone size={19} /> : <Monitor size={19} />}</span><div className="min-w-0 flex-1"><div className="flex min-w-0 items-center gap-1"><p className="truncate text-sm font-medium">{device.name}</p>{onRename && (onRevoke || device.subjectId === currentIdentity) && <button type="button" aria-label={`重命名 ${device.name}`} className="inline-flex h-9 w-9 shrink-0 appearance-none items-center justify-center rounded-lg bg-transparent text-muted-foreground hover:bg-surface-2" onClick={() => { setEditingDevice(device.subjectId); setDeviceLabel(device.grants.find(grant => grant.label)?.label || ''); }}><Pencil size={14} /></button>}</div>{device.subjectId === currentIdentity && device.grants.find(grant => grant.label)?.label && <p className="truncate text-xs text-muted-foreground">{device.grants.find(grant => grant.label)?.label}</p>}<p className="mt-0.5 text-xs text-muted-foreground">{permissionName(device.grants.flatMap(grant => grant.actions))} · {scopeName(device.grants)}</p></div>{onRevoke && device.subjectId !== currentIdentity && pendingRevoke !== device.subjectId && <button type="button" className={`${button} -mr-2 text-xs text-muted-foreground hover:text-destructive`} disabled={busy} aria-label={`撤销 ${device.name} 的访问权限`} onClick={() => setPendingRevoke(device.subjectId)}>撤销</button>}</div>
            <DeviceInformation profile={device.grants.find(grant => grant.deviceProfile)?.deviceProfile} subjectId={device.subjectId} />
            {pendingRevoke === device.subjectId && <div className="mt-3 rounded-lg border border-border bg-background p-3"><p className="text-xs leading-relaxed">撤销后，这台设备将断开连接，需重新邀请才能访问。</p><div className="mt-2 flex justify-end gap-2"><button type="button" className={`${button} text-xs text-muted-foreground`} disabled={busy} onClick={() => setPendingRevoke(undefined)}>取消</button><button type="button" className={`${button} text-xs text-destructive`} disabled={busy} onClick={async () => { setBusy(true); setError(''); try { for (const grant of device.grants) await onRevoke?.(grant.id); setPendingRevoke(undefined); setNotice('设备访问权限已撤销。'); } catch { setError('暂时无法撤销，请重试。'); } finally { setBusy(false); } }}>确认撤销</button></div></div>}
          </div>)}{devices.length === 0 && !loadError && <p className="py-5 text-sm text-muted-foreground">暂无设备授权。{onCreateInvite ? '可通过邀请添加设备。' : ''}</p>}</div>}
          {onCreateInvite && <button type="button" className={`${button} mt-4 inline-flex w-full items-center justify-center gap-2 border border-border text-sm`} disabled={busy} onClick={beginInvite}><Plus size={16} />邀请设备</button>}
          {invitations.length > 0 && <section className="mt-5 border-t border-border pt-4" aria-label="待接受的邀请"><h3 className="text-sm font-medium">待接受的邀请</h3><div className="divide-y divide-border">{invitations.map(item => <div key={item.id} className="py-3"><p className="text-sm">{item.label || '设备邀请'}</p><p className="mt-1 break-words text-xs text-muted-foreground">{permissionName(item.actions)} · {scopeDescription(item.scope, item.sessionAppearance)}</p><p className="mt-1 text-xs text-muted-foreground">{item.reusable ? '可重复使用 · ' : '单次使用 · '}{item.invitationExpiresAt === null ? '直到撤销有效' : new Date(item.invitationExpiresAt).toLocaleString() + ' 前有效'}</p><ShareResourceSummary resources={item.resources} />{invitationRevokeControl(item.id)}</div>)}</div></section>}
          {inactiveGrants.length > 0 && <details className="mt-4 text-xs text-muted-foreground"><summary className="cursor-pointer py-2">已失效的授权（{inactiveGrants.length}）</summary><div className="mt-1 space-y-2 border-l border-border pl-3">{inactiveGrants.map(grant => <p key={grant.id} className="flex gap-3"><span className="min-w-0 flex-1 truncate">{deviceName(grant)}</span><span className="shrink-0">{grant.revokedAt !== undefined ? '已撤销' : '已到期'}</span></p>)}</div></details>}
        </section>}
        {editingDevice && <form className="space-y-4" onSubmit={async event => { event.preventDefault(); setBusy(true); setError(''); try { await onRename?.(editingDevice, deviceLabel.trim()); setEditingDevice(undefined); } catch { setError('暂时无法保存设备名称，请重试。'); } finally { setBusy(false); } }}>
          <label className="block space-y-2 text-sm"><span>设备名称</span><input autoFocus className={field} maxLength={80} required value={deviceLabel} onChange={event => setDeviceLabel(event.target.value)} placeholder="例如：我的 iPhone、办公室电脑" /></label>
          <p className="text-xs leading-relaxed text-muted-foreground">为设备起一个容易辨认的名字，会同步显示在此服务的设备列表中。</p>
          <button type="submit" className={`${primaryButton} w-full`} disabled={busy || !deviceLabel.trim()}>{busy ? '正在保存…' : '保存名称'}</button>
        </form>}
        {showDetails && <section className="space-y-5">
          {tab === 'devices' ? devices.map(device => <div key={device.subjectId} className="space-y-3">
            <h3 className="text-sm font-medium">{device.name}</h3>
            <dl className="space-y-3 rounded-xl bg-surface-2 p-3 text-xs">
              <div><dt className="text-muted-foreground">访问权限</dt><dd className="mt-1">{permissionName(device.grants.flatMap(grant => grant.actions))} · {scopeName(device.grants)}</dd></div>
              {device.grants.map(grant => <div key={grant.id}><dt className="text-muted-foreground">{grant.routeTargetServiceId ? '允许经此入口访问' : permissionName(grant.actions)}</dt><dd className="mt-1 leading-relaxed">{grant.routeTargetServiceId ? grant.routeTargetName || '指定服务' : scopeDescription(grant.scope, grant.sessionAppearance)}{!grant.routeTargetServiceId && <span className="mt-1 block text-muted-foreground">{grant.expiresAt ? new Date(grant.expiresAt).toLocaleString() : '保留至撤销'}</span>}<ShareResourceSummary resources={grant.resources} /></dd>{onRevoke && (grant.routeTargetServiceId || device.subjectId !== currentIdentity) && (pendingGrantRevoke === grant.id ? <div className="mt-2"><p className="leading-relaxed">确认撤销此项授权？此设备的其他授权将保留。</p><div className="mt-1 flex justify-end gap-2"><button type="button" className={`${button} text-xs text-muted-foreground`} disabled={busy} onClick={() => setPendingGrantRevoke(undefined)}>取消</button><button type="button" className={`${button} text-xs text-destructive`} disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await onRevoke(grant.id); setPendingGrantRevoke(undefined); setNotice('此项授权已撤销。'); } catch { setError('暂时无法撤销，请重试。'); } finally { setBusy(false); } }}>确认撤销此项授权</button></div></div> : <button type="button" className={`${button} mt-1 -ml-3 text-xs text-destructive`} disabled={busy} onClick={() => setPendingGrantRevoke(grant.id)}>{grant.routeTargetServiceId ? '撤销此中转权限' : '撤销此项授权'}</button>)}</div>)}
              <div><dt className="text-muted-foreground">设备标识</dt><dd className="mt-1 break-all font-mono leading-relaxed text-muted-foreground select-text">{device.subjectId}</dd></div>
            </dl>
          </div>) : <dl className="space-y-4 text-xs"><div><dt className="text-muted-foreground">当前服务</dt><dd className="mt-1 text-sm">{currentServiceName || '当前服务'}</dd></div><div><dt className="text-muted-foreground">服务标识</dt><dd className="mt-1 break-all font-mono leading-relaxed select-text">{currentServiceId}</dd></div><div><dt className="text-muted-foreground">本设备标识</dt><dd className="mt-1 break-all font-mono leading-relaxed select-text">{currentIdentity}</dd></div></dl>}
        </section>}
        {replacingInvite && <form className="space-y-4 py-1" onSubmit={async event => {
          event.preventDefault(); setError('');
          let connection: FederationConnection;
          try { connection = parseInviteLink(replacementLink.trim()); }
          catch { setError('请输入完整的 Termdock 邀请链接。'); return; }
          setReplacingInvite(false); setReplacementLink(''); await connect(connection);
        }}>
          <p className="text-sm leading-6 text-muted-foreground">请粘贴分享者重新生成的邀请链接。</p>
          <label className="block space-y-2 text-sm"><span>新的邀请链接</span><input className={field} type="text" required autoFocus autoComplete="off" spellCheck={false} placeholder="粘贴完整链接" value={replacementLink} onChange={event => { setReplacementLink(event.target.value); setError(''); }} /></label>
          <button type="submit" className={`${primaryButton} w-full text-sm`} disabled={busy || !replacementLink.trim()}>接受新邀请</button>
        </form>}
        {displayedInvite && !inviting && !replacingInvite && <section className="space-y-5 py-1">
          <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-2 text-muted-foreground"><Server size={22} /></span><div className="min-w-0"><p className="text-xs text-muted-foreground">受邀连接的服务</p><p className="mt-1 break-words text-base font-medium">{connectionName(displayedInvite)}</p></div></div>
          {inviteFailure && <div role="alert" className="flex gap-3 rounded-xl border border-border bg-surface-2 p-4">
            {inviteFailure.kind === 'connection' ? <WifiOff size={20} className="mt-0.5 shrink-0 text-muted-foreground" /> : inviteFailure.kind === 'expired' ? <Clock3 size={20} className="mt-0.5 shrink-0 text-warning" /> : <Link2Off size={20} className="mt-0.5 shrink-0 text-warning" />}
            <div className="min-w-0"><h3 className="text-sm font-medium">{inviteFailure.title}</h3><p className="mt-1.5 text-sm leading-6 text-muted-foreground">{inviteFailure.description}</p></div>
          </div>}
          {displayedInvite.routeOnly && !inviteFailure && <p className="text-xs leading-relaxed text-muted-foreground">此邀请提供备用连接，目标服务仍会验证你的访问权限。</p>}
          {initialNeedsPassword ? <form className="space-y-3" onSubmit={async event => { event.preventDefault(); setBusy(true); setError(''); try { await onConnectWithPassword?.(displayedInvite, initialPassword); } catch (failure) { setError(failure instanceof Error ? failure.message : '暂时无法登录，请重试。'); } finally { setInitialPassword(''); setBusy(false); } }}><label className="block space-y-2 text-sm"><span>目标服务密码</span><input className={field} type="password" required autoFocus autoComplete="current-password" value={initialPassword} onChange={event => setInitialPassword(event.target.value)} /></label><button className={`${primaryButton} w-full`} disabled={busy || !initialPassword}>{busy ? '正在登录…' : '登录并连接'}</button></form> : inviteFailure && !inviteFailure.retryable ? <button type="button" className={`${primaryButton} w-full text-sm`} onClick={() => { setReplacingInvite(true); setError(''); }}>输入新的邀请链接</button> : <button type="button" className={`${primaryButton} w-full text-sm`} disabled={busy} onClick={() => void connect(displayedInvite)}>{busy ? '正在连接…' : inviteFailure ? '重试连接' : '接受邀请'}</button>}
          {(!inviteFailure || inviteFailure.retryable) && !initialNeedsPassword && <DesktopInvitationButton invitation={displayedInvite} />}
          {displayedInvite.certificateUrl && <p className="text-xs leading-6 text-muted-foreground">直接接受邀请将通过 HTTP 打开，内容经应用加密通道传输。也可<a className="ml-1 text-primary underline underline-offset-2" href={displayedInvite.certificateUrl} target="_blank" rel="noopener noreferrer">安装本地 CA 证书，使用 HTTPS</a>。</p>}
        </section>}
        {inviting && !selectingSessions && <section>
          {!loading && missingRequested.length > 0 && <p role="alert" className="mb-3 text-xs text-destructive">有 {missingRequested.length} 个会话尚未加载或不属于此服务，暂不能生成完整分享。跨服务协作组请分别在所属服务创建邀请。</p>}
          {invitation ? <div className="space-y-4">
            <div className="flex items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Check size={20} /></span><div><p role="status" className="text-base font-medium">{(invitation.expiresAt !== null && invitation.expiresAt <= now) ? '邀请链接已过期' : copyState === 'copied' ? '链接已复制' : '链接已生成'}</p><p className="mt-1 text-xs text-muted-foreground">{(invitation.expiresAt !== null && invitation.expiresAt <= now) ? '重新生成即可获得新链接' : `${reusable ? '可重复使用' : '单次使用'} · ${invitation.expiresAt === null ? '直到撤销有效' : linkExpiry === '600000' ? '10 分钟内有效' : new Date(invitation.expiresAt).toLocaleString() + ' 前有效'}`}</p></div></div>
            {invitationSummary && <div className="rounded-xl border border-border p-3"><p className="break-words text-sm font-medium">{scopeDescription(invitationSummary.scope, invitationSummary.sessionAppearance)}</p><p className="mt-2 text-xs text-muted-foreground">{permissionName(invitationSummary.actions)} · {invitationSummary.viewMode === 'chat' ? '普通对话' : '终端'} · 访问{invitationSummary.expiresAt ? `至 ${new Date(invitationSummary.expiresAt).toLocaleString()}` : '保留至撤销'}</p><ShareResourceSummary resources={invitationSummary.resources} /></div>}
            <label className="block space-y-2 text-xs text-muted-foreground"><span>分享链接</span><input aria-label="分享链接" readOnly value={invitation.url} onFocus={event => event.currentTarget.select()} className={`${field} text-sm`} /></label>
            {invitation.certificateFingerprint && <div className="text-xs leading-relaxed text-muted-foreground"><p>接收方可直接接受邀请，通过 HTTP 进入；安装 CA 证书是可选的 HTTPS 方式。</p><details className="mt-2"><summary className="min-h-9 cursor-pointer">向接收方核对证书指纹</summary><p className="mt-1">通过你们已信任的对话渠道发送此 SHA-256 指纹，确认引导页证书属于你的设备。</p><code className="mt-2 block select-all break-all rounded-lg bg-background p-2 text-foreground">{invitation.certificateFingerprint}</code></details></div>}
            {copyState === 'failed' && <p role="status" className="text-xs text-muted-foreground">未能自动复制，请点击下方按钮或选中链接复制。</p>}
            <p className="text-xs leading-5 text-muted-foreground">HTTP 入口无需安装证书；选择 HTTPS 时需信任服务证书。</p>
            <div className="flex flex-wrap items-center justify-between gap-1"><button type="button" aria-expanded={showQr} className={`${button} inline-flex items-center gap-2 text-xs text-muted-foreground`} onClick={() => setShowQr(value => !value)}><QrCode size={15} />{showQr ? '隐藏二维码' : '显示二维码'}</button><button type="button" className={`${button} text-xs text-muted-foreground`} onClick={() => { invitationGeneration.current++; setInvitation(undefined); setShowQr(false); setCopyState('idle'); setNotice(''); setError(''); }}>调整分享内容 / 重新生成</button></div>
            {showQr && (qr ? <img src={qr} width={220} height={220} className="mx-auto max-w-full rounded-xl" alt="设备邀请二维码" /> : <div className="mx-auto flex h-48 w-48 items-center justify-center"><Loader2 size={22} className="animate-spin text-muted-foreground" /></div>)}
            {invitation.id && invitationRevokeControl(invitation.id)}
          </div> : <form id="federation-invite-form" className="space-y-3" onSubmit={createInvitation}>
            <fieldset disabled={loading || busy || preset === 'full'}>
              <legend className="mb-2 text-xs text-muted-foreground">分享范围</legend>
              <div className="grid grid-cols-2 gap-2">{([['selected', '指定会话'], ['all', '全部终端']] as const).map(([value, name]) => {
                const checked = (preset === 'full' ? 'all' : resource) === value;
                return <label key={value} className={`flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm transition focus-within:ring-2 focus-within:ring-ring ${checked ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-surface-2'}`}><input type="radio" name="federation-scope" value={value} checked={checked} onChange={() => setResource(value)} className="sr-only" /><span aria-hidden="true" className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`}>{checked && <Check size={11} />}</span>{name}</label>;
              })}</div>
            </fieldset>
            {resource === 'selected' && preset !== 'full' ? <section aria-label="分享会话" className="flex min-h-14 items-center gap-3 rounded-xl bg-surface-2 px-3 py-2"><span className="shrink-0 text-primary"><SessionIcon icon={selectedSessions.length === 1 ? sessionAppearance[selectedSessions[0].sessionId]?.icon : undefined} size={22} /></span><div className="min-w-0 flex-1"><p className="text-[11px] text-muted-foreground">已选会话</p><p className="line-clamp-2 break-words text-sm font-medium">{shareNames || (loading ? '正在准备当前会话…' : '选择要分享的会话')}</p></div><button type="button" aria-label={selectedIds.length ? `已选 ${selectedIds.length} 个` : '选择终端'} className={`${button} shrink-0 text-xs text-primary`} disabled={loading || busy} onClick={() => { setDraftSessionIds(selectedIds); setSelectingSessions(true); }}>{selectedIds.length ? '更改' : '选择'}</button></section> : <p className="text-xs text-muted-foreground">包含以后新建的终端</p>}
            <fieldset><legend className="sr-only">访问权限</legend><div className="grid grid-cols-2 gap-2">{([
              ['read', '仅查看', '不能输入或发送消息'], ['write', '可操作', '允许对话和终端输入'], ['chat', '仅对话', '可发消息，不控制终端'],
            ] as const).map(([value, name, description]) => <label key={value} className={`flex min-h-14 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 transition focus-within:ring-2 focus-within:ring-ring ${preset === value ? 'border-primary bg-primary/10' : 'border-border hover:bg-surface-2'}`}><input type="radio" name="federation-permission" value={value} checked={preset === value} onChange={() => setPreset(value)} className="sr-only" /><span aria-hidden="true" className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${preset === value ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`}>{preset === value && <Check size={11} />}</span><span><span className="block text-sm font-medium">{name}</span><span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">{description}</span></span></label>)}</div></fieldset>
            <button type="button" className={`${button} w-full border border-border text-left text-xs`} aria-expanded={preset === 'custom'} onClick={() => setPreset('custom')}>按功能自定义权限</button>
            {preset === 'custom' && <fieldset className="space-y-1 rounded-xl border border-border p-3"><legend className="px-1 text-xs text-muted-foreground">开放给接收者的功能</legend>
              <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={chatView} onChange={e => { setChatView(e.target.checked); if (!e.target.checked) setChatSend(false); }} />查看对话</label>
              <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={chatSend} onChange={e => { setChatSend(e.target.checked); if (e.target.checked) setChatView(true); }} />发送对话消息</label>
              <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={terminalView} onChange={e => { setTerminalView(e.target.checked); if (!e.target.checked) setTerminalControl(false); }} />查看终端预览（未授权控制时只读）</label>
              <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={terminalControl} onChange={e => { setTerminalControl(e.target.checked); if (e.target.checked) setTerminalView(true); }} />终端输入与控制</label>
            </fieldset>}
            {(preset === 'chat' || preset === 'custom' && chatSend && !terminalControl) && <p className="text-xs leading-5 text-muted-foreground">只向运行中的 tmux Agent 投递普通消息，不支持退出命令或终端按键。Agent 自身的工具权限不受此开关隔离。</p>}
            <fieldset className="flex items-center gap-3"><legend className="sr-only">打开后的默认视图</legend><span className="w-[72px] shrink-0 text-xs text-muted-foreground">打开方式</span><div className="grid flex-1 grid-cols-2 gap-2">{([['chat', '普通对话', MessageCircle], ['terminal', '终端', TerminalSquare]] as const).map(([value, name, Icon]) => <button key={value} type="button" disabled={preset === 'chat' && value === 'terminal' || preset === 'custom' && (value === 'chat' ? !chatView : !terminalView)} aria-pressed={effectiveViewMode === value} className={`${button} inline-flex items-center justify-center gap-2 border ${effectiveViewMode === value ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`} onClick={() => setViewMode(value)}><Icon size={15} />{name}</button>)}</div></fieldset>
            <label className="flex items-center gap-3 text-xs text-muted-foreground"><span className="w-[72px] shrink-0">链接使用</span><select aria-label="链接使用" className={`${field} min-w-0 flex-1 text-sm`} value={reusable ? 'multiple' : 'single'} onChange={e => setReusable(e.target.value === 'multiple')}><option value="single">仅接受一次</option><option value="multiple">可重复使用</option></select></label>
            <label className="flex items-center gap-3 text-xs text-muted-foreground"><span className="w-[72px] shrink-0">链接有效期</span><select aria-label="链接有效期" className={`${field} min-w-0 flex-1 text-sm`} value={linkExpiry} onChange={e => setLinkExpiry(e.target.value)}><option value="600000">10 分钟</option><option value="86400000">1 天</option><option value="604800000">7 天</option><option value="never">直到撤销</option></select></label>
            {reusable && <p className="text-xs leading-5 text-muted-foreground">持链接者可接受邀请；撤销此链接会同时撤销由它产生的访问授权。</p>}
            <label className="flex items-center gap-3 text-xs text-muted-foreground"><span className="w-[72px] shrink-0">访问有效期</span><select aria-label="访问有效期" className={`${field} min-w-0 flex-1 text-sm`} value={expiryPreset} onChange={event => setExpiry(event.target.value)}><option value="never">直到撤销</option><option value="3600000">1 小时</option><option value="86400000">1 天</option><option value="604800000">7 天</option><option value="custom">自定义时间</option></select></label>
            {expiryPreset === 'custom' && <label className="block space-y-1 text-xs text-muted-foreground"><span>授权到期时间</span><input type="datetime-local" className={field} value={grantExpiry} onChange={event => setGrantExpiry(event.target.value)} /></label>}
            <label className="flex items-center gap-3 text-xs text-muted-foreground"><span className="w-[72px] shrink-0">链接地址</span><select aria-label="接入地址" className={`${field} min-w-0 flex-1 text-sm`} value={inviteAddress} onChange={event => setEntryAddress(event.target.value)}><option value="">当前地址 · {new URL(currentOrigin).host}</option>{inviteAddresses.map(address => <option key={address.url} value={address.url}>{address.label} · {new URL(address.url).host}</option>)}<option value="custom">自定义地址</option></select></label>
            {inviteAddress === 'custom' && <input aria-label="自定义接入地址" type="text" className={field} inputMode="url" placeholder="例如：https://192.168.1.23:9834" value={customAddress} onChange={event => setCustomAddress(event.target.value)} />}
            {localInviteAddress && <p className="text-xs leading-5 text-muted-foreground">当前地址仅供这台电脑使用。其他设备需选择能访问的域名或 IP 地址。</p>}
            {preset === 'write' && <p className="text-xs leading-5 text-muted-foreground">终端命令可读写该系统用户有权访问的文件。</p>}
            {preset === 'full' && <p className="text-xs leading-5 text-destructive">当前为完整服务权限，包含设置和权限管理。</p>}
            <button type="button" aria-expanded={moreOptions} className="flex min-h-9 w-full items-center justify-between text-xs text-muted-foreground" onClick={() => setMoreOptions(value => !value)}>更多选项<span className="flex items-center gap-1">名称、图标与附带资源<ChevronDown size={13} className={moreOptions ? 'rotate-180' : ''} /></span></button>
            {moreOptions && <div className="space-y-4 border-t border-border pt-3">
              {preset !== 'full' && resource === 'selected' && selectedSessions.length > 0 && <ShareSessionAppearanceFields sessions={selectedSessions} value={sessionAppearance} onChange={setSessionAppearance} />}
              <label className="block space-y-1 text-xs text-muted-foreground"><span>设备备注（可选）</span><input className={field} value={label} onChange={event => setLabel(event.target.value)} placeholder="例如：项目协作" /></label>
              {hasBackup && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={includeBackup} onChange={event => setIncludeBackup(event.target.checked)} />让新设备也能使用备用连接</label>}
              <fieldset className="space-y-2"><legend className="text-xs text-muted-foreground">管理权限</legend><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={preset === 'full'} onChange={event => setPreset(event.target.checked ? 'full' : 'read')} />授予完整服务权限</label><p className="text-xs leading-5 text-muted-foreground">完整权限包含所有终端、文件、设备、设置和权限管理。</p></fieldset>
              {preset !== 'full' && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={allowClear} onChange={e => setAllowClear(e.target.checked)} />允许接收者清空自己的聊天显示</label>}
              {preset !== 'full' && <ShareResourceFields value={resources} onChange={setResources} expanded />}
            </div>}
          </form>}
        </section>}
        {selectingSessions && <section><p className="mb-3 text-xs text-muted-foreground">仅允许访问勾选的终端。</p><div className="space-y-1">{sessions.map(session => <label key={session.sessionId} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-surface-2"><input type="checkbox" className="h-4 w-4 accent-primary" checked={draftSessionIds.includes(session.sessionId)} onChange={event => setDraftSessionIds(event.target.checked ? [...draftSessionIds, session.sessionId] : draftSessionIds.filter(id => id !== session.sessionId))} /><span className="min-w-0 break-words">{session.name}</span></label>)}{!sessions.length && <p className="py-4 text-sm text-muted-foreground">当前没有可共享的终端。</p>}</div></section>}
        {loadError && <p role="alert" className="mt-4 text-sm text-destructive">{loadError}{onRetry && <button type="button" className={`${button} ml-1 text-sm underline`} onClick={onRetry}>重试</button>}</p>}
        {!displayedInvite && !serviceNavigation.title && !adding && !editingDevice && !showDetails && !selectingSessions && !invitation && !inviting && <div className="mt-4 border-t border-border pt-2"><button type="button" className={`${button} -ml-3 inline-flex items-center gap-1 bg-transparent text-xs text-muted-foreground`} aria-expanded={overview ? undefined : advanced} onClick={() => overview ? setShowDetails(true) : setAdvanced(value => !value)}>{inviting ? '有效期与备注' : adding ? '手动连接' : tab === 'devices' ? '授权详情' : '连接详情'}{overview ? <ChevronRight size={14} /> : <ChevronDown size={13} className={advanced ? 'rotate-180' : ''} />}</button>
          {advanced && <section className="space-y-3 pb-1 pt-2">
            {inviting && <><label className="block space-y-1 text-sm"><span>设备备注（可选）</span><input className={field} value={label} onChange={event => setLabel(event.target.value)} placeholder="例如：工作电脑" /></label><label className="block space-y-1 text-sm"><span>授权到期时间</span><input type="datetime-local" className={field} value={grantExpiry} onChange={event => setGrantExpiry(event.target.value)} /></label></>}
            {!inviting && currentIdentity && <p className="break-all text-xs leading-relaxed text-muted-foreground">本设备身份：{currentIdentity}</p>}


          </section>}
        </div>}
        {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}{notice && <p role="status" className="mt-3 text-sm text-muted-foreground">{notice}</p>}
      </div>
      {inviting && !selectingSessions && <footer className="shrink-0 border-t border-border bg-surface px-5 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">{invitation ? <button type="button" className={`${primaryButton} inline-flex w-full items-center justify-center gap-2`} disabled={busy} onClick={() => { if ((invitation.expiresAt !== null && invitation.expiresAt <= now)) void createInvitation(); else void copyInvite(); }}><Copy size={16} />{busy ? '正在生成…' : (invitation.expiresAt !== null && invitation.expiresAt <= now) ? '重新生成链接' : '复制邀请链接'}</button> : <><button type="submit" form="federation-invite-form" className={`${primaryButton} inline-flex w-full items-center justify-center gap-2`} disabled={busy || loading || missingRequested.length > 0 || preset === 'custom' && !chatView && !terminalView}>{busy && <Loader2 size={16} className="animate-spin" />}{busy ? '正在生成…' : loading ? '正在准备分享…' : '生成并复制链接'}</button><p className="mt-2 text-center text-[11px] leading-4 text-muted-foreground">{reusable ? '链接可重复接受' : '链接单次接受'} · {linkExpiry === 'never' ? '直到撤销有效' : linkExpiry === '600000' ? '10 分钟内有效' : '按所选时间到期'} · 接收后{grantExpiry ? '按所选时间到期' : '可访问至撤销'}</p></>}</footer>}
      {selectingSessions && <footer className="shrink-0 border-t border-border px-5 pt-3 pb-[max(16px,env(safe-area-inset-bottom))]"><button type="button" className={`${primaryButton} w-full text-sm`} disabled={!draftSessionIds.length} onClick={() => { setSelectedIds(draftSessionIds); setResource('selected'); setSelectingSessions(false); }}>使用所选终端（{draftSessionIds.length}）</button></footer>}
    </div>
  </div>, document.body);
}
export default FederationAccess;
