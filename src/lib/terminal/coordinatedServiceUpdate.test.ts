import { describe, expect, it, vi } from 'vitest';
import { runCoordinatedServiceUpdate, type CoordinatedUpdateOptions, type UpdateConnection } from './coordinatedServiceUpdate';
import type { ServiceUpdatePlan } from './serviceUpdatePlan';
import type { TermdockUpdateState } from './api';

const plan: ServiceUpdatePlan = { targetId: 'target', relayId: 'entry', interfaceId: 'entry', nodes: [
  { intent: { url: 'https://entry.example', targetPeerId: 'target', entryServiceId: 'entry' }, label: '工作电脑', role: 'target' },
  { intent: { url: 'https://entry.example', targetPeerId: 'entry' }, label: '家中中转', role: 'relay' },
] };
const ready = (): TermdockUpdateState => ({ status: 'ready', currentVersion: '1.0.0', latestVersion: '1.0.1', checkedAt: 1, error: null, source: 'official' });
function setup() {
  const states = [ready(), ready()];
  const requests: string[] = [];
  let time = 0;
  const hook = vi.fn<(index: number, path: string, init?: RequestInit) => Response | undefined | Promise<Response | undefined>>();
  const closes = vi.fn();
  const options: CoordinatedUpdateOptions = {
    current: vi.fn(() => true), chinese: true, progress: vi.fn(), reload: vi.fn(async () => {}),
    now: () => time, pause: async () => { time += 1000; }, restartTimeoutMs: 2000, installTimeoutMs: 2000,
    open: vi.fn(async node => {
      const index = node.role === 'target' ? 0 : 1;
      return { close: closes, fetch: async (path: string, init?: RequestInit) => {
        requests.push(`${index}:${init?.method || 'GET'}:${path}`);
        const overridden = await hook(index, path, init); if (overridden) return overridden;
        if (path.endsWith('/restart')) {
          expect(JSON.parse(String(init?.body))).toEqual({ version: '1.0.1' });
          states[index] = { ...ready(), status: 'current', currentVersion: '1.0.1' };
          return Response.json({ ...ready(), status: 'restarting' });
        }
        return Response.json(states[index]);
      } } satisfies UpdateConnection;
    }),
  };
  return { options, states, requests, hook, closes, run: () => runCoordinatedServiceUpdate(plan, '1.0.1', options) };
}

describe('coordinated service update', () => {
  it('prepares both services, restarts the target first, verifies running versions, then reloads once', async () => {
    const f = setup(); await expect(f.run()).resolves.toMatchObject({ currentVersion: '1.0.1' });
    const preparations = f.requests.filter(path => path.includes('prepare-restart'));
    expect(preparations).toHaveLength(2);
    const restarts = f.requests.filter(path => path.endsWith('/restart'));
    expect(restarts).toEqual(['0:POST:/api/terminal/update/restart', '1:POST:/api/terminal/update/restart']);
    expect(f.requests.indexOf(preparations[1])).toBeLessThan(f.requests.indexOf(restarts[0]));
    expect(f.options.reload).toHaveBeenCalledOnce(); expect(f.closes).toHaveBeenCalledTimes(4);
  });
  it('checks every independent authorization before making any install or restart request', async () => {
    const f = setup(); const open = f.options.open;
    f.options.open = vi.fn(async (node, signal) => { if (node.role === 'relay') throw new Error('没有管理权限'); return open(node, signal); });
    await expect(f.run()).rejects.toThrow('家中中转');
    expect(f.requests).toEqual([]); expect(f.closes).toHaveBeenCalledOnce(); expect(f.options.reload).not.toHaveBeenCalled();
  });
  it('installs an older relay with one check POST, polls progress, and waits before any restart', async () => {
    const f = setup(); f.states[1] = { ...ready(), status: 'idle', latestVersion: null };
    f.hook.mockImplementation((index, path) => {
      if (index === 1 && path.endsWith('/check')) { f.states[1] = ready(); return Response.json({ ...ready(), status: 'installing' }); }
    });
    await f.run();
    expect(f.requests.filter(path => path.endsWith('/check'))).toEqual(['1:POST:/api/terminal/update/check']);
    expect(f.requests.indexOf('1:POST:/api/terminal/update/check')).toBeLessThan(f.requests.indexOf('0:POST:/api/terminal/update/restart'));
  });
  it.each(['installation', 'supervision'])('does not restart either service when relay %s fails', async failure => {
    const f = setup();
    if (failure === 'installation') {
      f.states[1] = { ...ready(), status: 'error', error: 'npm unavailable' };
      f.hook.mockImplementation((index, path) => index === 1 && path.endsWith('/check') ? Response.json(f.states[1]) : undefined);
    } else f.hook.mockImplementation((index, path) => index === 1 && path.endsWith('/prepare-restart') ? Response.json({ error: 'Not supervised' }, { status: 409 }) : undefined);
    await expect(f.run()).rejects.toThrow(failure === 'installation' ? 'npm unavailable' : 'Not supervised');
    expect(f.requests.some(path => path.endsWith('/restart'))).toBe(false); expect(f.options.reload).not.toHaveBeenCalled();
  });
  it('supports old preflight-less services, keeping exact-version restart validation', async () => {
    const f = setup(); f.hook.mockImplementation((_index, path) => path.endsWith('/prepare-restart') ? new Response('Not found', { status: 404 }) : undefined);
    await f.run(); expect(f.options.reload).toHaveBeenCalledOnce();
  });
  it('reconciles a dropped restart acknowledgement through reads and never retries its POST', async () => {
    const f = setup(); f.hook.mockImplementation((index, path) => {
      if (index === 0 && path.endsWith('/restart')) { f.states[0] = { ...ready(), currentVersion: '1.0.1', status: 'current' }; throw new Error('Secure connection closed'); }
      return undefined;
    });
    await f.run(); expect(f.requests.filter(path => path === '0:POST:/api/terminal/update/restart')).toHaveLength(1);
    expect(f.options.reload).toHaveBeenCalledOnce();
  });
  it('stops before the relay restart if the target never returns on the new version', async () => {
    const f = setup(); f.hook.mockImplementation((index, path) => { if (index === 0 && path.endsWith('/restart')) throw new Error('offline'); return undefined; });
    await expect(f.run()).rejects.toThrow('尚未确认');
    expect(f.requests.filter(path => path.endsWith('/restart'))).toEqual(['0:POST:/api/terminal/update/restart']);
    expect(f.options.reload).not.toHaveBeenCalled();
  });
  it('does not claim completion after a partial update; retry skips the already updated target', async () => {
    const f = setup(); f.hook.mockImplementation((index, path) => index === 1 && path.endsWith('/restart') ? Response.json({ error: 'Installation changed' }, { status: 409 }) : undefined);
    await expect(f.run()).rejects.toThrow('Installation changed'); expect(f.options.reload).not.toHaveBeenCalled();
    f.hook.mockReset(); await f.run();
    expect(f.requests.filter(path => path === '0:POST:/api/terminal/update/restart')).toHaveLength(1);
    expect(f.options.reload).toHaveBeenCalledOnce();
  });
  it('requires fresh confirmation for a changed target version, and stops after the active selection changes', async () => {
    const f = setup(); f.states[0].latestVersion = '1.0.2'; await expect(f.run()).rejects.toThrow('版本已变化');
    expect(f.requests.some(path => path.includes('POST'))).toBe(false);
    const g = setup(); g.hook.mockImplementation((_index, path) => { if (path.endsWith('/prepare-restart')) g.options.current = () => false; return undefined; });
    await expect(g.run()).rejects.toThrow('已停止'); expect(g.requests.some(path => path.endsWith('/restart'))).toBe(false);
  });
  it('keeps an already current relay running but still reloads the interface', async () => {
    const f = setup(); f.states[1].currentVersion = '1.0.2'; f.states[1].status = 'current'; await f.run();
    expect(f.requests.filter(path => path.endsWith('/restart'))).toEqual(['0:POST:/api/terminal/update/restart']);
    expect(f.options.reload).toHaveBeenCalledOnce();
  });
  it('prepares an older target when a newer entry version was discovered independently', async () => {
    const f = setup(); f.states[0] = { ...ready(), status: 'current', latestVersion: '1.0.0' };
    f.states[1] = { ...ready(), status: 'current', currentVersion: '1.0.1' };
    f.hook.mockImplementation((index, path) => {
      if (index === 0 && path.endsWith('/check')) { f.states[0] = ready(); return Response.json(f.states[0]); }
    });
    await f.run();
    expect(f.requests.filter(path => path.endsWith('/check'))).toEqual(['0:POST:/api/terminal/update/check']);
    expect(f.requests.filter(path => path.endsWith('/restart'))).toEqual(['0:POST:/api/terminal/update/restart']);
  });
  it('requires fresh confirmation when the entry pending version changes too', async () => {
    const f = setup(); f.states[1].latestVersion = '1.0.2';
    await expect(f.run()).rejects.toThrow('版本已变化');
    expect(f.requests.some(path => path.includes('POST'))).toBe(false);
  });
});
