// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectServiceUpdates } from './inspectServiceUpdates';
import type { ServiceUpdatePlan } from './serviceUpdatePlan';

const mocks = vi.hoisted(() => ({ open: vi.fn(), permission: vi.fn() }));
vi.mock('../federation/browserIntegration', () => ({ openAuthorizedServiceClient: mocks.open }));
vi.mock('../federation/deviceAuthorization', () => ({ readDeviceAuthorization: mocks.permission }));
const plan: ServiceUpdatePlan = { targetId: 'work', interfaceId: 'entry', nodes: [
  { intent: { targetPeerId: 'work', url: 'https://work.example' }, label: 'Work', role: 'target' },
  { intent: { targetPeerId: 'entry', url: 'https://entry.example' }, label: 'Entry', role: 'interface' },
] };
const current = { status: 'current', currentVersion: '1.0.1', latestVersion: '1.0.1', checkedAt: 1, source: 'official', error: null };
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); });
function setup(check: boolean) {
  const fetch = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>(async () => Response.json(current)), close = vi.fn();
  mocks.open.mockResolvedValue({ fetch, close }); mocks.permission.mockResolvedValue({ fullService: true });
  const controller = new AbortController(), changed = vi.fn();
  return { fetch, close, changed, controller, run: () => inspectServiceUpdates(plan, { check, chinese: true, signal: controller.signal, changed }) };
}
describe('inspection through the authorized encrypted clients', () => {
  it('only reads the related service on initial load and never installs or restarts', async () => {
    const f = setup(false); await f.run();
    expect(mocks.open).toHaveBeenCalledTimes(1);
    expect(mocks.open.mock.calls[0][0].targetPeerId).toBe('entry');
    expect(f.fetch).toHaveBeenCalledWith('/api/terminal/update', expect.objectContaining({ cache: 'no-store' }));
    expect(f.fetch.mock.calls.every(([, init]) => !init?.method)).toBe(true);
    expect(f.close).toHaveBeenCalledOnce();
  });
  it('checks all service permissions before issuing any preparation POST', async () => {
    const f = setup(true); mocks.permission.mockResolvedValueOnce({ fullService: true }).mockResolvedValueOnce({ fullService: false });
    await expect(f.run()).rejects.toThrow('管理权限');
    expect(f.fetch).not.toHaveBeenCalled(); expect(f.close).toHaveBeenCalledTimes(2);
  });
  it('checks every participant on an explicit click without restarting any of them', async () => {
    const f = setup(true); const result = await f.run();
    expect(result).toMatchObject({ work: { state: current }, entry: { state: current } });
    expect(f.fetch).toHaveBeenCalledTimes(2);
    expect(f.fetch.mock.calls.every(([path, init]) => path === '/api/terminal/update/check' && init?.method === 'POST')).toBe(true);
  });
  it('re-reads both running versions before showing a restart confirmation, without POSTs', async () => {
    const f = setup(false);
    await inspectServiceUpdates(plan, { check: false, includeTarget: true, chinese: true, signal: f.controller.signal, changed: f.changed });
    expect(mocks.open).toHaveBeenCalledTimes(2);
    expect(f.fetch.mock.calls.every(([path, init]) => path === '/api/terminal/update' && !init?.method)).toBe(true);
  });
  it('reports an offline entry as unknown instead of preserving a successful snapshot', async () => {
    const f = setup(false); f.fetch.mockRejectedValueOnce(new Error('offline'));
    expect(await f.run()).toEqual({ entry: { error: 'offline' } });
    expect(f.close).toHaveBeenCalledOnce();
  });
  it('stops an old inspection without publishing after the active connection changes', async () => {
    const f = setup(false);
    f.fetch.mockImplementationOnce(async () => { f.controller.abort(); return Response.json(current); });
    await expect(f.run()).rejects.toThrow(); expect(f.changed).not.toHaveBeenCalled(); expect(f.close).toHaveBeenCalled();
  });
  it('polls a background check to completion and closes the temporary connections', async () => {
    vi.useFakeTimers(); const f = setup(true);
    f.fetch.mockResolvedValueOnce(Response.json({ ...current, status: 'installing' }));
    const pending = f.run(); await vi.advanceTimersByTimeAsync(1000); await pending;
    expect(f.changed.mock.calls.some(([snapshots]) => snapshots.work?.state?.status === 'installing')).toBe(true);
    expect(f.changed.mock.calls.at(-1)?.[0].work.state.status).toBe('current');
    expect(f.fetch.mock.calls.some(([path]) => path.endsWith('/restart'))).toBe(false);
    expect(f.close).toHaveBeenCalledTimes(2);
  });
});
