import { describe, expect, it } from 'vitest';
import { summarizeServiceUpdates } from './serviceUpdateOverview';
import type { TermdockUpdateState } from './api';
import type { ServiceUpdatePlan } from './serviceUpdatePlan';

const plan: ServiceUpdatePlan = { targetId: 'work', interfaceId: 'linux', relayId: 'linux', nodes: [
  { intent: { targetPeerId: 'work', url: 'https://work.example' }, label: '工作电脑', role: 'target' },
  { intent: { targetPeerId: 'linux', url: 'https://linux.example' }, label: 'Linux', role: 'relay' },
] };
const state = (currentVersion: string, status: TermdockUpdateState['status'] = 'current', latestVersion = currentVersion): TermdockUpdateState => ({ currentVersion, latestVersion, status, checkedAt: 1, source: 'official', error: null });
const overview = (work = state('1.0.1'), linux: TermdockUpdateState | undefined = state('1.0.1'), retry = false) => summarizeServiceUpdates(plan, { work: { state: work }, linux: { state: linux } }, true, retry);

describe('service updates from the user perspective', () => {
  it('does not invent an update just because another service provides the interface', () => {
    const result = overview();
    expect(result.available).toBe(false);
    expect(result.notice).toBe('所有相关服务均已是最新版本。');
    expect(result.notice).not.toContain('仅更新');
  });
  it('offers only the entry update when the current service is already current', () => {
    const result = overview(state('1.0.1'), state('1.0.0'));
    expect(result.available).toBe(true);
    expect(result.notice).toBe('“Linux” 可更新至 1.0.1。');
    expect(result.confirmation).not.toContain('“工作电脑”');
    expect(result.confirmation).toContain('其他设备');
  });
  it('names both services when both need a prepared update', () => {
    const result = overview(state('1.0.0', 'ready', '1.0.1'), state('1.0.0'));
    expect(result.notice).toContain('“工作电脑”、“Linux”');
    expect(result.actionLabel).toBe('更新并重启');
  });
  it('can discover an update on the entry independently of the current target', () => {
    const result = overview(state('1.0.0'), state('1.0.0', 'ready', '1.0.2'));
    expect(result.version).toBe('1.0.2'); expect(result.available).toBe(true);
  });
  it('keeps unknown or failed reads distinct from up to date', () => {
    const result = summarizeServiceUpdates(plan, { work: { state: state('1.0.1') }, linux: { error: 'offline' } }, true);
    expect(result.available).toBe(false); expect(result.notice).toContain('无法确认');
    expect(result.details[1].description).toContain('状态未知');
  });
  it.each(['checking', 'installing', 'restarting'] as const)('disables restart while a participant is %s', status => {
    const result = overview(state('1.0.0', 'ready', '1.0.1'), state('1.0.0', status, '1.0.1'));
    expect(result.available).toBe(false); expect(result.busy).toBe(true);
  });
  it('offers a retry for the remaining service after a partial failure', () => {
    const result = overview(state('1.0.1'), state('1.0.0', 'ready', '1.0.1'), true);
    expect(result.actionLabel).toBe('重试更新'); expect(result.available).toBe(true);
    expect(result.confirmation).not.toContain('“工作电脑”');
  });
  it('requires a new check after a preparation error even when the running entry is older', () => {
    const result = overview(state('1.0.1'), { ...state('1.0.0', 'error'), error: 'Installation failed' });
    expect(result.available).toBe(false); expect(result.notice).toContain('重新检查');
  });
});
