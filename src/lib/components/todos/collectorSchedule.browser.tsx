import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import '../../../index.css';
import { CollectorEditor, TodoDialog } from './TodoForms';
import { useTodoWorkspace } from '../../todos/workspace';
import type { AgentLauncherInfo } from '../../terminal/api';
import type { TodoCollector } from '../../todos/api';

let root: Root;
const saves: Array<{ input: Partial<TodoCollector>; start: boolean }> = [];
const config = { agentSlug: 'codex', command: 'codex', cwd: '/projects/veymux', prompt: '' };
const agents: AgentLauncherInfo[] = [{ slug: 'codex', displayName: 'Codex', command: 'codex', accentColor: 'var(--primary)', icon: null }];
function mount(collector?: TodoCollector) {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  flushSync(() => root.render(<TodoDialog title="添加收集方向" busy={false} error="" onClose={() => {}}><CollectorEditor workspace="schedule-browser" collector={collector} config={config} agents={agents} loading={false} service="开发电脑" directories={[config.cwd]} currentCwd={config.cwd} busy={false} onCancel={() => {}} onSave={(input, start) => saves.push({ input, start })} /></TodoDialog>));
}
afterEach(() => { flushSync(() => root?.unmount()); document.body.innerHTML = ''; saves.length = 0; useTodoWorkspace.setState({ views: {} }); });

it.each([320, 390, 1280])('sets multiple times and weekdays, preserves drafts and keeps actions reachable at %i px', async width => {
  await page.viewport(width, 844); mount();
  await page.getByRole('button', { name: '项目巡检', exact: true }).click();
  await page.getByText('定时与启用 · 手动运行', { exact: true }).click();
  await page.getByRole('radio', { name: '定时', exact: true }).click();
  await page.getByRole('button', { name: '工作日', exact: true }).click();
  await page.getByRole('button', { name: '周二', exact: true }).click();
  await page.getByRole('button', { name: '周四', exact: true }).click();
  await page.getByRole('button', { name: '添加时间', exact: true }).click();
  await expect.element(page.getByRole('button', { name: '仅保存', exact: true })).toBeDisabled();
  await expect.element(page.getByText('请补全时间，或删除空白时间点', { exact: true })).toBeVisible();
  await page.getByLabelText('时间 2', { exact: true }).fill('20:00');
  await page.getByRole('button', { name: '添加时间', exact: true }).click();
  await page.getByLabelText('时间 3', { exact: true }).fill('14:00');
  expect(saves).toEqual([]);
  await page.getByRole('button', { name: '仅保存', exact: true }).click();
  expect(saves[0]).toMatchObject({ start: false, input: { schedule: { kind: 'daily', time: '09:00', times: ['09:00', '14:00', '20:00'], weekdays: [1, 3, 5] } } });
  await page.getByRole('button', { name: '取消', exact: true }).click();
  expect(saves).toHaveLength(1);
  flushSync(() => root.unmount()); document.body.innerHTML = ''; mount();
  await page.getByText('定时与启用 · 周一、周三、周五 09:00、14:00、20:00', { exact: true }).click();
  await expect.element(page.getByLabelText('时间 2', { exact: true })).toHaveValue('20:00');
  await page.getByRole('button', { name: '删除时间 2', exact: true }).click();
  await page.getByRole('radio', { name: '按间隔', exact: true }).click();
  await page.getByRole('spinbutton', { name: '间隔（分钟）', exact: true }).fill('120');
  await page.getByRole('button', { name: '仅保存', exact: true }).click();
  expect(saves.at(-1)).toMatchObject({ start: false, input: { schedule: { kind: 'interval', everyMinutes: 120 } } });
  await page.getByRole('radio', { name: '定时', exact: true }).click();
  await expect.element(page.getByLabelText('时间 2', { exact: true })).toHaveValue('14:00');
  const save = page.getByRole('button', { name: '保存并收集', exact: true }).element().getBoundingClientRect();
  expect(save.bottom).toBeLessThanOrEqual(844); expect(save.height).toBeGreaterThanOrEqual(44);
  expect(document.documentElement.scrollWidth).toBe(width);
  const dialog = page.getByRole('dialog').element();
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
  page.getByRole('group', { name: '运行频率', exact: true }).element().scrollIntoView({ block: 'start' });
  await page.screenshot({ path: `/tmp/veymux-collector-schedule-${width}.png` });
});

it('restores saved schedules, merges duplicates and requires at least one weekday', async () => {
  await page.viewport(390, 844);
  mount({ id: 'saved', name: '早晚收集', config: { ...config, prompt: '检查更新' }, enabled: true, revision: 1, createdAt: 1, updatedAt: 1, nextRunAt: null, schedule: { kind: 'daily', time: '09:00', times: ['09:00', '20:00'], weekdays: [0, 6] } });
  await page.getByText('定时与启用 · 周末 09:00、20:00', { exact: true }).click();
  await expect.element(page.getByRole('button', { name: '周末', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabelText('时间 2', { exact: true }).fill('09:00');
  await expect.element(page.getByText('相同时间只运行一次', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '仅保存', exact: true }).click();
  expect(saves.at(-1)?.input.schedule).toEqual({ kind: 'daily', time: '09:00', weekdays: [0, 6] });
  await page.getByRole('button', { name: '周六', exact: true }).click();
  await page.getByRole('button', { name: '周日', exact: true }).click();
  await expect.element(page.getByText('至少选择一天', { exact: true })).toBeVisible();
  await expect.element(page.getByRole('button', { name: '仅保存', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '每天', exact: true }).click();
  await page.getByRole('button', { name: '删除时间 2', exact: true }).click();
  await expect.element(page.getByRole('button', { name: '删除时间 1', exact: true })).toBeDisabled();
  await page.getByRole('radio', { name: '手动', exact: true }).click();
  await page.getByRole('button', { name: '仅保存', exact: true }).click();
  expect(saves.at(-1)?.input.schedule).toBeNull();
});

it('loads legacy single-time schedules without losing the configured weekdays', async () => {
  mount({ id: 'legacy', name: '旧方向', config: { ...config, prompt: '检查更新' }, enabled: false, revision: 1, createdAt: 1, updatedAt: 1, nextRunAt: null, schedule: { kind: 'daily', time: '08:30', weekdays: [1] } });
  await page.getByText('定时与启用 · 周一 08:30', { exact: true }).click();
  await page.getByRole('button', { name: '仅保存', exact: true }).click();
  expect(saves[0]).toMatchObject({ start: false, input: { enabled: false, schedule: { kind: 'daily', time: '08:30', weekdays: [1] } } });
});
