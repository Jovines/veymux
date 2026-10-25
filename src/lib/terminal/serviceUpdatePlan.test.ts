// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { buildServiceUpdatePlan, serviceUpdateCopy } from './serviceUpdatePlan';

const entry = { id: 'a', targetPeerId: 'a', url: 'https://entry.example', label: '家中入口' };
const target = { url: entry.url, targetPeerId: 'b', entryServiceId: 'a', serviceName: '工作电脑', routes: [{ url: entry.url, targetPeerId: 'a' }] };
afterEach(() => localStorage.clear());

describe('service update participants', () => {
  it('includes the actual relay and never mistakes its URL for the target resource origin', () => {
    const plan = buildServiceUpdatePlan(target, [entry], entry.url, 'a');
    expect(plan.nodes.map(node => [node.intent.targetPeerId, node.role])).toEqual([['b', 'target'], ['a', 'relay']]);
    expect(plan.interfaceId).toBe('a');
    expect(serviceUpdateCopy(plan, true).confirmation).toContain('当前通过“家中入口”中转连接');
    expect(serviceUpdateCopy(plan, true).confirmation).toContain('仅更新当前服务无法更新全部界面功能');
    expect(serviceUpdateCopy(plan, true).confirmation).toContain('其他设备');
  });
  it('uses the active alternative relay, and updates a distinct shell provider last', () => {
    const alternate = { id: 'c', targetPeerId: 'c', url: 'https://relay.example', label: '备用中转' };
    const plan = buildServiceUpdatePlan(target, [entry, alternate], entry.url, 'c');
    expect(plan.nodes.map(node => node.intent.targetPeerId)).toEqual(['b', 'c', 'a']);
    expect(plan.relayId).toBe('c');
    expect(plan.nodes[2].role).toBe('interface');
  });
  it('updates a distinct interface provider even when the remote target becomes directly reachable', () => {
    const plan = buildServiceUpdatePlan({ ...target, url: 'https://target.example', serviceOrigin: 'https://target.example' }, [entry], entry.url);
    expect(plan.nodes.map(node => node.intent.targetPeerId)).toEqual(['b', 'a']);
    expect(serviceUpdateCopy(plan, false).notice).toContain('interface is provided by');
  });
  it('does not restart an unused relay when the target and shell are local', () => {
    const plan = buildServiceUpdatePlan({ ...entry, serviceName: entry.label }, [entry], entry.url);
    expect(plan.nodes).toHaveLength(1);
  });
  it('uses a pinned route address when the relay has no standalone directory row', () => {
    const plan = buildServiceUpdatePlan(target, [], entry.url, 'a');
    expect(plan.nodes[1].intent).toMatchObject({ url: entry.url, targetPeerId: 'a' });
  });
  it('refuses ambiguous origin pins and an unknown shell provider', () => {
    expect(() => buildServiceUpdatePlan(target, [entry, { ...entry, id: 'other', targetPeerId: 'other' }], entry.url, 'a')).toThrow('身份记录不一致');
    expect(() => buildServiceUpdatePlan(target, [entry], 'https://unknown.example', 'a')).toThrow('入口服务');
  });
});
