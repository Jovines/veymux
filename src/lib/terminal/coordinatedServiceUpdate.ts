import type { VeymuxUpdateState } from './api';
import type { ServiceUpdateNode, ServiceUpdatePlan } from './serviceUpdatePlan';
import { compareVersions } from '../utils/version';
import { ConnectionAccessError } from '../federation/accessFailure';

export interface UpdateConnection {
  fetch(path: string, init?: RequestInit): Promise<Response>;
  close(): void;
}
export interface CoordinatedUpdateOptions {
  current(): boolean;
  open(node: ServiceUpdateNode, signal: AbortSignal): Promise<UpdateConnection>;
  progress(message: string): void;
  reload(): Promise<void>;
  chinese: boolean;
  /** Injectable timing keeps failure, partial completion and reconnect tests deterministic. */
  pause?: () => Promise<void>;
  now?: () => number;
  installTimeoutMs?: number;
  restartTimeoutMs?: number;
}
class UpdateHttpError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
const atLeast = (version: string, minimum: string) => compareVersions(version, minimum) >= 0;

/** Writes are issued once. After a dropped restart response only version reads
 * may reconcile it; transport recovery must never replay a restart or install. */
export async function runCoordinatedServiceUpdate(plan: ServiceUpdatePlan, version: string, options: CoordinatedUpdateOptions): Promise<VeymuxUpdateState> {
  const now = options.now ?? Date.now;
  const pause = options.pause ?? (() => new Promise(resolve => window.setTimeout(resolve, 1000)));
  const guard = () => { if (!options.current()) throw new Error(options.chinese ? '更新操作已停止：当前服务或页面已变化。' : 'Update stopped: the active service or page changed.'); };
  let activeNode: ServiceUpdateNode | undefined;
  const progress = (node: ServiceUpdateNode, zh: string, en: string) => { guard(); activeNode = node; options.progress(`“${node.label}”：${options.chinese ? zh : en}`); };
  const participants: { node: ServiceUpdateNode; connection?: UpdateConnection; state?: VeymuxUpdateState; restartVersion?: string }[] = [];
  let targetState: VeymuxUpdateState | undefined;
  async function request(connection: UpdateConnection, suffix = '', body?: object, optional = false): Promise<VeymuxUpdateState | undefined> {
    guard();
    const response = await connection.fetch(`/api/terminal/update${suffix}`, {
      signal: AbortSignal.timeout(15_000), cache: 'no-store',
      ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    if (optional && response.status === 404) { await response.body?.cancel(); return; }
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 409 && data.code === 'UPDATE_STATE_CHANGED' && data.state?.status !== 'error') return data.state;
      throw new UpdateHttpError(data.error || `Update request failed (${response.status})`, response.status);
    }
    if (!data || typeof data.currentVersion !== 'string' || !['idle', 'checking', 'current', 'installing', 'ready', 'restarting', 'error'].includes(data.status)) throw new Error('Invalid update response');
    return data;
  }
  try {
    // Opening checks independent full-service authorization on every node before
    // installation. Relay access alone never authorizes updating that relay.
    for (const node of plan.nodes) {
      progress(node, '正在检查更新权限…', 'Checking update permission…');
      const connection = await options.open(node, AbortSignal.timeout(15_000));
      participants.push({ node, connection }); guard();
    }
    for (const item of participants) {
      const { node } = item;
      progress(node, '正在准备更新…', 'Preparing update…');
      let state = (await request(item.connection!))!;
      if (state.status !== 'error' && atLeast(state.currentVersion, version)) { item.state = state; continue; }
      if (state.latestVersion && compareVersions(state.latestVersion, version) > 0) throw new Error(options.chinese ? '待更新版本已变化，请重新确认。' : 'The pending version changed. Please confirm again.');
      if (!(state.status === 'ready' && state.latestVersion && atLeast(state.latestVersion, version))) {
        state = (await request(item.connection!, '/check', {}))!;
        const deadline = now() + (options.installTimeoutMs ?? 5 * 60_000);
        while (state.status === 'checking' || state.status === 'installing') {
          if (now() >= deadline) throw new Error(options.chinese ? '更新准备超时，尚未重启任何服务。' : 'Update preparation timed out. No services have been restarted.');
          progress(node, state.status === 'installing' ? '正在安装更新…' : '正在检查更新…', state.status === 'installing' ? 'Installing update…' : 'Checking update…');
          await pause(); state = (await request(item.connection!))!;
        }
      }
      if (state.status === 'error') throw new Error(state.error || 'Update installation failed');
      if (atLeast(state.currentVersion, version)) { item.state = state; continue; }
      if (state.status !== 'ready' || !state.latestVersion || !atLeast(state.latestVersion, version)) throw new Error(options.chinese ? `尚未安装 ${version} 或更新版本。` : `Version ${version} or newer is not installed.`);
      if (state.latestVersion !== version) throw new Error(options.chinese ? '待更新版本已变化，请重新确认。' : 'The pending version changed. Please confirm again.');
      item.state = state; item.restartVersion = state.latestVersion;
    }
    for (const item of participants) {
      if (!item.restartVersion) continue;
      progress(item.node, '正在核验重启条件…', 'Verifying restart requirements…');
      // Older installations do not expose this read-only preflight. They still
      // enforce installation, version and supervision checks at /restart.
      const prepared = await request(item.connection!, '/prepare-restart', { version: item.restartVersion }, true);
      if (prepared && (prepared.status !== 'ready' || prepared.latestVersion !== item.restartVersion)) throw new Error('The pending update changed. Please confirm again.');
    }
    for (const item of participants) {
      let state = item.state!;
      if (item.restartVersion) {
        progress(item.node, '正在重启并等待恢复…', 'Restarting and waiting for recovery…');
        try {
          const result = (await request(item.connection!, '/restart', { version: item.restartVersion }))!;
          if (result.status === 'error' || (result.status !== 'restarting' && !atLeast(result.currentVersion, item.restartVersion))) throw new UpdateHttpError(result.error || 'The pending update changed. Please confirm again.', 409);
        } catch (error) {
          // HTTP failures are definitive. A transport failure may have happened
          // after the server accepted the write; inspect its running version.
          if (error instanceof UpdateHttpError || error instanceof ConnectionAccessError) throw error;
          guard();
        }
        item.connection?.close(); item.connection = undefined;
        const deadline = now() + (options.restartTimeoutMs ?? 90_000);
        let lastError: unknown;
        while (true) {
          guard();
          try {
            item.connection ??= await options.open(item.node, AbortSignal.timeout(10_000));
            state = (await request(item.connection))!;
            if (atLeast(state.currentVersion, item.restartVersion)) break;
          } catch (error) {
            if (error instanceof ConnectionAccessError || error instanceof UpdateHttpError && [401, 403].includes(error.status)) throw error;
            lastError = error; item.connection?.close(); item.connection = undefined;
          }
          if (now() >= deadline) throw new Error(options.chinese
            ? `尚未确认服务已运行新版本，请检查连接后重试。${lastError instanceof Error ? ` ${lastError.message}` : ''}`
            : `The new running version could not be confirmed. Check the connection and try again.${lastError instanceof Error ? ` ${lastError.message}` : ''}`);
          await pause();
        }
      }
      if (item.node.role === 'target') targetState = state;
    }
    activeNode = undefined;
    guard(); options.progress(options.chinese ? '服务已更新，正在重新加载界面…' : 'Services updated. Reloading the interface…');
    await options.reload();
    return targetState!;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(activeNode ? `“${activeNode.label}”：${detail}` : detail, { cause: error });
  } finally {
    for (const item of participants) item.connection?.close();
  }
}
