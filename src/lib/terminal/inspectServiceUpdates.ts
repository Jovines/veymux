import { openAuthorizedServiceClient } from '../federation/browserIntegration';
import { readDeviceAuthorization } from '../federation/deviceAuthorization';
import type { VeymuxUpdateState } from './api';
import type { ServiceUpdatePlan } from './serviceUpdatePlan';
import type { ServiceUpdateSnapshots } from './serviceUpdateOverview';
import { compareVersions } from '../utils/version';

/** Mounting is read-only. Only an explicit check prepares new versions; neither
 * path restarts a service or falls back to unencrypted HTTP. */
export async function inspectServiceUpdates(plan: ServiceUpdatePlan, options: {
  signal: AbortSignal;
  check: boolean;
  includeTarget?: boolean;
  chinese: boolean;
  changed(snapshots: ServiceUpdateSnapshots): void;
}) {
  const snapshots: ServiceUpdateSnapshots = {};
  const clients: { id: string; client: Awaited<ReturnType<typeof openAuthorizedServiceClient>> }[] = [];
  const guard = () => options.signal.throwIfAborted();
  const publish = () => { guard(); options.changed({ ...snapshots }); };
  const abort = () => { for (const { client } of clients) client.close(); };
  options.signal.addEventListener('abort', abort, { once: true });
  async function read(id: string, client: typeof clients[number]['client'], check = false) {
    guard();
    const response = await client.fetch(`/api/terminal/update${check ? '/check' : ''}`, {
      signal: AbortSignal.any([options.signal, AbortSignal.timeout(15_000)]), cache: 'no-store',
      ...(check ? { method: 'POST' } : {}),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || (options.chinese ? '无法检查更新，请检查连接和管理权限。' : 'Could not check updates. Check the connection and management permission.'));
    if (!data || typeof data.currentVersion !== 'string' || !['idle', 'checking', 'current', 'installing', 'ready', 'restarting', 'error'].includes(data.status)) throw new Error('Invalid update response');
    compareVersions(data.currentVersion, data.currentVersion);
    if (data.latestVersion != null) compareVersions(data.latestVersion, data.currentVersion);
    snapshots[id] = { state: data as VeymuxUpdateState }; publish();
  }
  try {
    // An explicit check verifies every participant before it prepares any update.
    for (const node of plan.nodes.filter(node => options.check || options.includeTarget || node.role !== 'target')) {
      guard();
      const id = node.intent.targetPeerId;
      try {
        const client = await openAuthorizedServiceClient(node.intent, AbortSignal.any([options.signal, AbortSignal.timeout(15_000)]));
        clients.push({ id, client }); guard();
        if (options.check && !(await readDeviceAuthorization(client, { maxAgeMs: 0 })).fullService) throw new Error(options.chinese ? '需要该服务的管理权限。' : 'Service management permission is required.');
        if (!options.check) await read(id, client);
      } catch (error) {
        guard(); snapshots[id] = { error: error instanceof Error ? error.message : String(error) }; publish();
        if (options.check) throw error;
      }
    }
    if (options.check) for (const { id, client } of clients) await read(id, client, true);
    const deadline = Date.now() + 5 * 60_000;
    while (clients.some(({ id }) => ['checking', 'installing', 'restarting'].includes(snapshots[id]?.state?.status ?? ''))) {
      if (Date.now() >= deadline) throw new Error(options.chinese ? '检查更新超时，请稍后重试。' : 'Update check timed out. Please try again.');
      await new Promise<void>((resolve, reject) => {
        const done = () => { options.signal.removeEventListener('abort', cancel); resolve(); };
        const timer = window.setTimeout(done, 1000);
        const cancel = () => { window.clearTimeout(timer); reject(options.signal.reason); };
        options.signal.addEventListener('abort', cancel, { once: true });
        if (options.signal.aborted) cancel();
      });
      for (const { id, client } of clients) await read(id, client);
    }
    return snapshots;
  } finally {
    options.signal.removeEventListener('abort', abort); abort();
  }
}
