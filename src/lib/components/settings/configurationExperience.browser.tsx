import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import '../../../index.css';
import { SettingsSections } from './SettingsSections';
import { CollectorEditor, LaunchEditor, TodoDialog, TodoEditor } from '../todos/TodoForms';
import { CollaborationGroupLauncher } from '../sidebar/CollaborationGroupLauncher';
import type { AgentLauncherInfo } from '../../terminal/api';

let root: Root;
const agents: AgentLauncherInfo[] = ['Codex', 'Claude', 'Gemini'].map(name => ({ slug: name.toLowerCase(), displayName: name, command: name.toLowerCase(), accentColor: 'var(--primary)', icon: null }));
const config = { agentSlug: 'codex', command: 'codex', cwd: '/projects/veymux', prompt: '' };
const saved: unknown[][] = [];
function mount(children: React.ReactNode) {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  flushSync(() => root.render(children));
}
afterEach(() => { flushSync(() => root?.unmount()); document.body.innerHTML = ''; saved.length = 0; });
const props = { workspace: 'configuration-browser', config, agents, loading: false, service: '开发电脑', directories: ['/projects/veymux'], currentCwd: config.cwd, busy: false, onSave: (...args: unknown[]) => saved.push(args), onCancel: () => {} };

it.each([320, 390, 1280])('keeps settings navigation and controls usable at %i px', async width => {
  await page.viewport(width, 844);
  mount(<div className="fixed inset-0 flex flex-col bg-surface"><SettingsSections footer={<button>Sign out</button>}><section><label>Draft<input defaultValue="Original" /></label></section><section><button>Customize toolbar</button></section><section><button>Service health</button></section></SettingsSections></div>);
  await page.getByRole('textbox', { name: 'Draft' }).fill('My preference');
  const tabs = [...document.querySelectorAll<HTMLElement>('[role="tab"]')];
  for (const tab of tabs) { expect(tab.getBoundingClientRect().width).toBeGreaterThan(40); expect(tab.getBoundingClientRect().right).toBeLessThanOrEqual(width); }
  await page.getByRole('tab', { name: 'Controls and alerts' }).click();
  await expect.element(page.getByRole('button', { name: 'Customize toolbar' })).toBeVisible();
  expect(document.querySelector('input')?.closest('[role="tabpanel"]')?.hasAttribute('hidden')).toBe(true);
  await userEvent.keyboard('{ArrowRight}');
  await expect.element(page.getByRole('button', { name: 'Service health' })).toBeVisible();
  await page.getByRole('tab', { name: 'Appearance and terminal' }).click();
  await expect.element(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('My preference');
  expect(document.documentElement.scrollWidth).toBe(width);
});

it.each([320, 390, 1280])('selects an Agent without executing it and keeps save reachable at %i px', async width => {
  await page.viewport(width, 844);
  mount(<TodoDialog title="处理配置" error="" busy={false} onClose={() => {}}><LaunchEditor {...props} draftId={`launch-${width}`} settings /></TodoDialog>);
  await page.getByRole('radio', { name: 'Claude', exact: true }).click();
  expect(saved).toEqual([]);
  await expect.element(page.getByRole('radio', { name: 'Claude', exact: true })).toBeChecked();
  const save = document.querySelector<HTMLButtonElement>('button[type="submit"]') ?? [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('保存配置'))!;
  const box = save.getBoundingClientRect(); expect(box.bottom).toBeLessThanOrEqual(844); expect(box.height).toBeGreaterThanOrEqual(44);
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  expect(saved[0][0]).toMatchObject({ agentSlug: 'claude', command: 'claude' });
  expect(document.documentElement.scrollWidth).toBe(width);
});

it('distinguishes saving a todo from handing it off without an extra step', async () => {
  mount(<TodoDialog title="新建待办" error="" busy={false} onClose={() => {}}><TodoEditor {...props} /></TodoDialog>);
  await expect.element(page.getByRole('button', { name: '存入清单' })).toBeDisabled();
  await page.getByRole('textbox', { name: '要做什么' }).fill('检查布局');
  await page.getByRole('button', { name: '存入清单' }).click();
  expect(saved.at(-1)?.[1]).toBe(false);
  await page.getByRole('button', { name: '保存并交给会话' }).click();
  expect(saved.at(-1)?.[1]).toBe(true);
});

it('requires a recipient for automatic processing and never runs on a choice change', async () => {
  mount(<TodoDialog title="收集方向" error="" busy={false} onClose={() => {}}><CollectorEditor {...props} /></TodoDialog>);
  await page.getByRole('button', { name: '项目巡检', exact: true }).click();
  await expect.element(page.getByRole('button', { name: '仅保存', exact: true })).toBeEnabled();
  await page.getByRole('radio', { name: '自动交给会话', exact: true }).click();
  await expect.element(page.getByRole('button', { name: '仅保存', exact: true })).toBeDisabled();
  expect(saved).toEqual([]);
  await page.getByRole('radio', { name: '存入清单', exact: true }).click();
  await page.getByRole('button', { name: '仅保存', exact: true }).click();
  expect(saved[0][0]).toMatchObject({ processing: { mode: 'manual' } }); expect(saved[0][1]).toBe(false);
});

it.each([320, 1280])('shows an actionable empty group then separate message and board entries at %i px', async width => {
  await page.viewport(width, 844);
  const callbacks = { onOpen: (...args: unknown[]) => saved.push(args), onCreate: () => saved.push(['create']), onSettings: () => {} };
  mount(<CollaborationGroupLauncher groups={[]} sessions={[]} busy={false} {...callbacks} />);
  await page.getByRole('button', { name: '新建协作组', exact: true }).click(); expect(saved).toEqual([['create']]);
  flushSync(() => root.render(<CollaborationGroupLauncher groups={[{ id: 'team', name: '体验优化', sessionIds: [], createdAt: 1, updatedAt: 1 }]} sessions={[]} busy={false} {...callbacks} />));
  await page.getByRole('button', { name: '成员消息：体验优化', exact: true }).click(); expect(saved.at(-1)).toEqual(['team', 'messages']);
  await page.getByRole('button', { name: '看板：体验优化', exact: true }).click(); expect(saved.at(-1)).toEqual(['team', 'tasks']);
  expect(document.documentElement.scrollWidth).toBe(width);
});
