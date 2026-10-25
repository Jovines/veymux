// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TermdockUpdateState } from './api';
import type { ServiceUpdatePlan } from './serviceUpdatePlan';
import type { ServiceUpdateSnapshots } from './serviceUpdateOverview';
const mocks = vi.hoisted(() => ({ capture: vi.fn(), inspect: vi.fn() }));
vi.mock('./serviceUpdatePlan', () => ({ captureServiceUpdatePlan: mocks.capture }));
vi.mock('./inspectServiceUpdates', () => ({ inspectServiceUpdates: mocks.inspect }));
vi.mock('../federation/browserIntegration', () => ({ SECURE_STATE_EVENT: 'secure-state' }));
vi.mock('../services/serviceDirectory', () => ({ SERVICE_DIRECTORY_EVENT: 'service-directory' }));
vi.mock('../utils/pwaUpdate', () => ({}));
import { useServiceUpdatePlan } from './useServiceUpdatePlan';
const plan: ServiceUpdatePlan = { targetId: 'work', interfaceId: 'entry', nodes: [
  { intent: { targetPeerId: 'work', url: 'https://work.example' }, label: 'Work', role: 'target' },
  { intent: { targetPeerId: 'entry', url: 'https://entry.example' }, label: 'Entry', role: 'interface' },
] };
const current: TermdockUpdateState = { status: 'current', currentVersion: '1.0.1', latestVersion: '1.0.1', checkedAt: 1, source: 'official', error: null };
beforeEach(() => { vi.resetAllMocks(); mocks.capture.mockResolvedValue(plan); });
afterEach(cleanup);

it('only inspects on mount and allows an explicit check even when all services are current', async () => {
  mocks.inspect.mockImplementation(async (_plan, options) => {
    const snapshots = { entry: { state: current } }; options.changed(snapshots); return snapshots;
  });
  const { result } = renderHook(() => useServiceUpdatePlan(true, current));
  await act(async () => {});
  expect(result.current?.available).toBe(false); expect(result.current?.busy).toBe(false);
  expect(mocks.inspect.mock.calls[0][1].check).toBe(false);
  await act(async () => { await result.current!.check(); });
  expect(mocks.inspect.mock.calls[1][1].check).toBe(true);
});

it('clears the old service result immediately and ignores its late response after switching', async () => {
  let oldOptions: { signal: AbortSignal; changed(next: ServiceUpdateSnapshots): void };
  let finish!: (snapshots: ServiceUpdateSnapshots) => void;
  mocks.inspect.mockImplementationOnce((_plan, options) => { oldOptions = options; return new Promise(resolve => { finish = resolve; }); });
  const { result } = renderHook(() => useServiceUpdatePlan(true, current));
  await act(async () => {});
  mocks.capture.mockResolvedValue({ ...plan, targetId: 'other', nodes: [{ ...plan.nodes[0], intent: { ...plan.nodes[0].intent, targetPeerId: 'other' } }] });
  await act(async () => window.dispatchEvent(new Event('secure-state')));
  expect(oldOptions!.signal.aborted).toBe(true); expect(result.current).toBeUndefined();
  await act(async () => { const snapshots = { entry: { state: { ...current, currentVersion: '1.0.0' } } }; oldOptions!.changed(snapshots); finish(snapshots); });
  expect(result.current).toBeUndefined();
});

it('does not call a failed inspection current or reuse its previous update action', async () => {
  mocks.inspect.mockImplementationOnce(async (_plan, options) => { const snapshots = { entry: { state: { ...current, currentVersion: '1.0.0' } } }; options.changed(snapshots); return snapshots; });
  const { result } = renderHook(() => useServiceUpdatePlan(true, current));
  await act(async () => {}); expect(result.current?.available).toBe(true);
  mocks.inspect.mockRejectedValueOnce(new Error('offline'));
  await act(async () => { await expect(result.current!.check()).rejects.toThrow('offline'); });
  expect(result.current?.available).toBe(false); expect(result.current?.notice).toContain('无法确认');
});
