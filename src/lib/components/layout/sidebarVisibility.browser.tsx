import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import '../../../index.css';
import App from '../../../App';
import { I18nProvider } from '../../i18n';
import { useSidebarStore } from '../../stores/useSidebarStore';

let root: Root | undefined;
const initial = useSidebarStore.getState();
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  localStorage.setItem('veymux:locale', 'zh');
  useSidebarStore.setState({ ...initial, desktopLeftOpen: true, desktopRightOpen: false, leftOpen: false, rightOpen: false });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    let data: unknown = { groups: [], sessions: [], messages: [], tasks: [], agents: [], automations: [], runs: [] };
    if (url.includes('/settings')) data = { locale: 'zh' };
    else if (url.includes('/inventory')) data = { clientSessions: [], tmuxSessions: [], tmuxStatus: { available: false }, updatedAt: 1 };
    else if (url.includes('/sessions') || url.includes('/agents')) data = [];
    else if (url.includes('/tmux/status')) data = { available: false, version: null };
    else if (url.includes('/tmux/')) data = [];
    else if (url.includes('/list')) data = { entries: [], path: '/review' };
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => {
  root?.unmount(); root = undefined;
  document.body.replaceChildren();
  useSidebarStore.setState(initial);
  vi.unstubAllGlobals();
});
async function mount(width: number) {
  await page.viewport(width, 900);
  const host = document.createElement('div'); host.id = 'root'; document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(<I18nProvider><App /></I18nProvider>));
  await expect.poll(() => document.querySelector('button[aria-label="展开工具面板"]')).toBeTruthy();
}
const panel = (side: string) => document.querySelector<HTMLElement>(`[data-desktop-sidebar="${side}"]`)!;

it('shows exactly one control per side and preserves the real panel, search draft and scroll position across collapse', async () => {
  await mount(1440);
  expect(document.querySelectorAll('button[aria-label="收起会话列表"]')).toHaveLength(1);
  await page.getByRole('button', { name: '展开工具面板', exact: true }).click();
  await page.getByRole('button', { name: '切换搜索', exact: true }).click();
  await page.getByRole('searchbox', { name: '过滤改动或文件', exact: true }).fill('sidebar-draft');
  const content = panel('right').querySelector('[data-sidebar="right"]');
  const search = panel('right').querySelector<HTMLInputElement>('input[data-right-search]')!;
  expect(document.querySelectorAll('button[aria-label="收起工具面板"]')).toHaveLength(1);
  expect(document.querySelectorAll('[aria-label="取消常驻"], [aria-label="常驻边栏"]')).toHaveLength(0);
  await page.getByRole('button', { name: '收起工具面板', exact: true }).click();
  expect(panel('right').hidden).toBe(true);
  expect(panel('right').querySelector('[data-sidebar="right"]')).toBe(content);
  await page.getByRole('button', { name: '展开工具面板', exact: true }).click();
  expect(panel('right').querySelector('input[data-right-search]')).toBe(search);
  expect(search.value).toBe('sidebar-draft');
  await userEvent.keyboard('{Escape}');
  expect(panel('right').hidden).toBe(false);
  const leftContent = panel('left').querySelector('[data-session-sidebar-pinned]');
  const list = leftContent!.querySelector<HTMLElement>('.overflow-y-auto')!;
  const longList = document.createElement('div'); longList.style.cssText = 'height:2000px;flex-shrink:0';
  list.append(longList); list.scrollTop = 200;
  await page.getByRole('button', { name: '收起会话列表', exact: true }).click();
  expect(panel('left').hidden).toBe(true);
  expect(panel('left').querySelector('[data-session-sidebar-pinned]')).toBe(leftContent);
  await page.getByRole('button', { name: '展开会话列表', exact: true }).click();
  expect(panel('left').hidden).toBe(false);
  expect(list.scrollTop).toBe(200);
});

it('keeps desktop choices through responsive transitions and only one temporary phone drawer open', async () => {
  await mount(1440);
  await page.getByRole('button', { name: '展开工具面板', exact: true }).click();
  await page.getByRole('button', { name: '收起会话列表', exact: true }).click();
  await page.viewport(390, 844);
  await expect.poll(() => document.querySelector('[data-desktop-sidebar]')).toBeNull();
  expect(useSidebarStore.getState()).toMatchObject({ leftOpen: false, rightOpen: false, desktopLeftOpen: false, desktopRightOpen: true });
  await page.getByRole('button', { name: '展开会话列表', exact: true }).click();
  expect(useSidebarStore.getState()).toMatchObject({ leftOpen: true, rightOpen: false });
  flushSync(() => useSidebarStore.getState().openRight());
  expect(useSidebarStore.getState()).toMatchObject({ leftOpen: false, rightOpen: true });
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => useSidebarStore.getState().rightOpen).toBe(false);
  await page.viewport(1440, 900);
  await expect.poll(() => document.querySelector('[data-desktop-sidebar="right"]')).toBeTruthy();
  expect(panel('left').hidden).toBe(true);
  expect(panel('right').hidden).toBe(false);
  expect(useSidebarStore.getState()).toMatchObject({ leftOpen: false, rightOpen: false });
});

it('leaves at least 280px for the workspace when both panels open at the desktop breakpoint', async () => {
  await mount(1024);
  flushSync(() => { useSidebarStore.getState().setLeftSidebarWidth(500); useSidebarStore.getState().openRight(); });
  await expect.poll(() => panel('right').hidden).toBe(false);
  const left = panel('left').getBoundingClientRect();
  const right = panel('right').getBoundingClientRect();
  expect(right.left - left.right).toBeGreaterThanOrEqual(280);
  expect(right.right).toBeLessThanOrEqual(1024);
  expect(document.querySelectorAll('button[aria-label="收起会话列表"]')).toHaveLength(1);
  expect(document.querySelectorAll('button[aria-label="收起工具面板"]')).toHaveLength(1);
});
