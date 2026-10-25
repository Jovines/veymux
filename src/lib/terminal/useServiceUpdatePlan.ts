import { useCallback, useEffect, useRef, useState } from 'react';
import { openAuthorizedServiceClient, SECURE_STATE_EVENT } from '../federation/browserIntegration';
import { readDeviceAuthorization } from '../federation/deviceAuthorization';
import { SERVICE_DIRECTORY_EVENT } from '../services/serviceDirectory';
import { flushApplicationDrafts, reloadApplicationAfterServiceUpdate } from '../utils/pwaUpdate';
import { captureServiceUpdatePlan, type ServiceUpdatePlan } from './serviceUpdatePlan';
import { runCoordinatedServiceUpdate } from './coordinatedServiceUpdate';
import type { TermdockUpdateState } from './api';
import { inspectServiceUpdates } from './inspectServiceUpdates';
import { summarizeServiceUpdates, type ServiceUpdateOverview, type ServiceUpdateSnapshots } from './serviceUpdateOverview';

export interface ServiceUpdateContext extends ServiceUpdateOverview {
  check(): Promise<TermdockUpdateState | undefined>;
}

export function useServiceUpdatePlan(chinese: boolean, targetState: TermdockUpdateState | null, retry = false): ServiceUpdateContext | undefined {
  const [plan, setPlan] = useState<ServiceUpdatePlan>();
  const [snapshots, setSnapshots] = useState<ServiceUpdateSnapshots>({});
  const [checking, setChecking] = useState(false);
  const inspection = useRef<AbortController>();
  useEffect(() => {
    let revision = 0;
    const refresh = () => {
      const request = ++revision;
      inspection.current?.abort(); setChecking(false); setSnapshots({}); setPlan(undefined);
      void captureServiceUpdatePlan().then(next => { if (request === revision) setPlan(next); }).catch(() => {
        if (request === revision) setPlan(undefined);
      });
    };
    refresh();
    window.addEventListener(SECURE_STATE_EVENT, refresh);
    window.addEventListener(SERVICE_DIRECTORY_EVENT, refresh);
    return () => { revision++; inspection.current?.abort(); window.removeEventListener(SECURE_STATE_EVENT, refresh); window.removeEventListener(SERVICE_DIRECTORY_EVENT, refresh); };
  }, []);
  const inspect = useCallback(async (check: boolean) => {
    if (!plan || plan.nodes.length < 2) return;
    inspection.current?.abort();
    const controller = new AbortController(); inspection.current = controller;
    setChecking(true);
    try {
      const result = await inspectServiceUpdates(plan, {
        signal: controller.signal, check, chinese,
        changed: next => { if (!controller.signal.aborted) setSnapshots(next); },
      });
      return result[plan.targetId]?.state;
    } catch (error) {
      if (!controller.signal.aborted) {
        // A failed read cannot certify that a previously observed update is
        // still available. Keep the next action a check, not a blind restart.
        setSnapshots({});
        if (check) throw error;
      }
    } finally {
      if (inspection.current === controller) setChecking(false);
    }
  }, [plan, chinese]);
  useEffect(() => { void inspect(false); return () => inspection.current?.abort(); }, [inspect]);
  const check = useCallback(() => inspect(true), [inspect]);
  if (!plan || plan.nodes.length < 2) return undefined;
  const overview = summarizeServiceUpdates(plan, {
    ...snapshots, [plan.targetId]: { state: targetState ?? snapshots[plan.targetId]?.state },
  }, chinese, retry);
  return { ...overview, check, busy: checking || overview.busy,
    available: !checking && overview.available,
    notice: checking ? (chinese ? '正在检查更新…' : 'Checking for updates…') : overview.notice };
}

export async function updateConnectedServices(plan: ServiceUpdatePlan, version: string, current: () => boolean, progress: (message: string) => void, chinese: boolean) {
  flushApplicationDrafts(window.top && window.top.location.origin === location.origin ? window.top : window);
  return runCoordinatedServiceUpdate(plan, version, {
    current, progress, chinese,
    async open(node, signal) {
      const client = await openAuthorizedServiceClient(node.intent, signal);
      try {
        const permission = await readDeviceAuthorization(client, { maxAgeMs: 0 });
        if (!permission.fullService) throw new Error(chinese ? `没有“${node.label}”的服务管理权限，未执行更新。请联系该服务管理员。` : `Full service access to “${node.label}” is required. Contact its administrator.`);
        return client;
      } catch (error) { client.close(); throw error; }
    },
    reload: reloadApplicationAfterServiceUpdate,
  });
}
