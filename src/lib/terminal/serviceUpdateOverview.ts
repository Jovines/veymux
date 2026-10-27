import type { VeymuxUpdateState } from './api';
import type { ServiceUpdateNode, ServiceUpdatePlan } from './serviceUpdatePlan';
import { compareVersions } from '../utils/version';

export interface ServiceUpdateSnapshot { state?: VeymuxUpdateState; error?: string }
export type ServiceUpdateSnapshots = Record<string, ServiceUpdateSnapshot>;
export interface ServiceUpdateOverview {
  notice: string;
  actionLabel: string;
  confirmation: string;
  version?: string;
  available: boolean;
  busy: boolean;
  details: { label: string; description: string }[];
}

const newer = (left: string, right: string) => compareVersions(left, right) > 0;
export function summarizeServiceUpdates(plan: ServiceUpdatePlan, snapshots: ServiceUpdateSnapshots, chinese: boolean, retry = false): ServiceUpdateOverview {
  let version: string | undefined;
  for (const { state } of Object.values(snapshots)) {
    if (!state) continue;
    for (const candidate of [state.currentVersion, state.status === 'ready' ? state.latestVersion : null]) {
      if (candidate && (!version || newer(candidate, version))) version = candidate;
    }
  }
  const pending = plan.nodes.filter(node => {
    const state = snapshots[node.intent.targetPeerId]?.state;
    return state && version && newer(version, state.currentVersion);
  });
  const busy = plan.nodes.some(node => ['checking', 'installing', 'restarting'].includes(snapshots[node.intent.targetPeerId]?.state?.status ?? ''));
  const unknown = plan.nodes.some(node => !snapshots[node.intent.targetPeerId]?.state);
  const failed = plan.nodes.some(node => snapshots[node.intent.targetPeerId]?.error || snapshots[node.intent.targetPeerId]?.state?.status === 'error');
  const unchecked = plan.nodes.some(node => snapshots[node.intent.targetPeerId]?.state?.status === 'idle');
  const available = !busy && !unknown && !failed && pending.length > 0;
  const names = pending.map(node => `“${node.label}”`).join(chinese ? '、' : ', ');
  const notice = busy ? (chinese ? '正在检查和准备更新，服务暂不重启…' : 'Checking and preparing updates. Services will keep running…')
    : available ? (chinese ? `${names} 可更新至 ${version}。` : `${names} can update to ${version}.`)
      : failed || unknown ? (chinese ? '部分服务的更新状态无法确认，请重新检查。' : 'Some update statuses could not be confirmed. Check again.')
        : unchecked ? (chinese ? '尚未检查更新。' : 'Updates have not been checked yet.')
          : (chinese ? '所有相关服务均已是最新版本。' : 'All connected services are up to date.');
  const relayAffected = pending.some(node => node.intent.targetPeerId === plan.relayId);
  const confirmation = chinese
    ? `将更新并重启 ${names}，切换至 ${version}。已是该版本或更新版本的服务会跳过。\n\n连接会短暂中断，完成后自动重新加载界面，tmux 会话保留。${relayAffected ? '中转服务重启期间，经它连接的其他设备也会短暂断线。' : ''}`
    : `Update and restart ${names} to ${version}? Services already running this version or newer will be skipped.\n\nConnections will be briefly interrupted, then the interface will reload. tmux sessions will be kept.${relayAffected ? ' Other devices using this relay will also briefly disconnect.' : ''}`;
  return {
    notice, version, available, busy, confirmation,
    actionLabel: retry ? (chinese ? '重试更新' : 'Retry update') : (chinese ? '更新并重启' : 'Update and restart'),
    details: plan.nodes.map(node => ({ label: node.label, description: describeNode(node, snapshots[node.intent.targetPeerId], chinese) })),
  };
}

function describeNode(node: ServiceUpdateNode, snapshot: ServiceUpdateSnapshot | undefined, chinese: boolean) {
  const role = node.role === 'target' ? (chinese ? '当前服务' : 'Current service') : node.role === 'interface' ? (chinese ? '界面入口' : 'Interface provider') : (chinese ? '连接入口' : 'Connection relay');
  if (!snapshot?.state) return `${role} · ${chinese ? '状态未知' : 'Status unknown'}${snapshot?.error ? ` · ${snapshot.error}` : ''}`;
  const state = snapshot.state;
  const suffix = snapshot.error || state.error || ({
    idle: chinese ? '尚未检查' : 'Not checked', checking: chinese ? '检查中' : 'Checking',
    installing: chinese ? '准备更新中' : 'Preparing update', ready: chinese ? '待更新' : 'Update ready',
    restarting: chinese ? '重启中' : 'Restarting', current: chinese ? '已是最新' : 'Up to date', error: chinese ? '检查失败' : 'Check failed',
  })[state.status];
  return `${role} · v${state.currentVersion}${state.status === 'ready' && state.latestVersion ? ` → ${state.latestVersion}` : ''} · ${suffix}`;
}
