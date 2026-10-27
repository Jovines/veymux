import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import '../../../index.css';
import TodoWorkspace from './TodoWorkspace';
import { useTodoWorkspace } from '../../todos/workspace';
import type { TodoItem, TodoSnapshot } from '../../todos/api';

const api = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn() }));
vi.mock('../../todos/api', async original => ({ ...await original<typeof import('../../todos/api')>(), listTodos: api.list, updateTodo: api.update }));
vi.mock('../../terminal/api', async original => ({ ...await original<typeof import('../../terminal/api')>(), getAgentLaunchers: async () => [], getSettings: async () => ({ newSessionAgentSlug: null }) }));
vi.mock('../../federation/browserIntegration', async original => ({ ...await original<typeof import('../../federation/browserIntegration')>(), savedConnection: () => null }));
let root: Root;
afterEach(() => { flushSync(() => root?.unmount()); document.body.innerHTML = ''; useTodoWorkspace.setState({ views: {}, snapshots: {}, options: {} }); vi.clearAllMocks(); });

it.each([320, 390, 1280])('edits and regroups a todo while preserving status tabs and fitting at %i px', async width => {
  await page.viewport(width, 844);
  const todo: TodoItem = { id: 'short', title: '待合入 alpha 并通知', description: '两个缺陷已解决', category: 'short', source: '每日 TODO', sourceUrl: '', externalId: 'issue', collectorId: 'collector-a', status: 'open', createdAt: 1, updatedAt: 1, revision: 1 };
  const data: TodoSnapshot = { todos: [todo, { ...todo, id: 'legacy', title: '旧待办', category: undefined, collectorId: 'collector-b' }], collectors: [], runs: [], defaults: { agentSlug: '', command: '', cwd: '', prompt: '' } };
  data.collectors = ['collector-a', 'collector-b'].map(id => ({ id, name: id === 'collector-a' ? '项目事项 A' : '项目事项 B', config: data.defaults, enabled: true, schedule: null, nextRunAt: null, createdAt: 1, updatedAt: 1, revision: 1 }));
  api.list.mockImplementation(async () => structuredClone(data));
  api.update.mockImplementation(async (item: TodoItem, changes: Partial<TodoItem>) => {
    const updated = { ...item, ...changes, revision: item.revision + 1 };
    data.todos = data.todos.map(todo => todo.id === item.id ? updated : todo); return { todo: updated };
  });
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  flushSync(() => root.render(<TodoWorkspace leftSidebarVisible={false} onOpenSidebar={() => {}} />));
  const open = page.getByRole('region', { name: '待完成列表', exact: true });
  await expect.element(open.getByRole('region', { name: '短期待办', exact: true }).getByRole('button', { name: todo.title, exact: true })).toBeVisible();
  await expect.element(open.getByRole('region', { name: '未分类待办', exact: true }).getByRole('button', { name: '旧待办', exact: true })).toBeInTheDocument();
  await expect.element(open.getByRole('region', { name: '长期待办', exact: true }).getByText('暂无', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: `编辑 ${todo.title}`, exact: true }).click();
  await page.getByRole('combobox', { name: '分类', exact: true }).selectOptions('delegated');
  await page.getByRole('textbox', { name: '背景和处理要求', exact: true }).fill('待合入并通知相关人');
  const save = page.getByRole('button', { name: '保存修改', exact: true }).element().getBoundingClientRect();
  expect(save.bottom).toBeLessThanOrEqual(844); expect(save.height).toBeGreaterThanOrEqual(44);
  expect(document.documentElement.scrollWidth).toBe(width);
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect.element(open.getByRole('region', { name: '待跟进待办', exact: true }).getByRole('button', { name: todo.title, exact: true })).toBeVisible();
  expect(data.todos).toHaveLength(2); expect(data.todos[0]).toMatchObject({ id: 'short', category: 'delegated', revision: 2, status: 'open' });
  if (width < 900) {
    await page.getByRole('tab', { name: /^已完成/ }).click();
    await expect.element(page.getByRole('region', { name: '已完成列表', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: /^待完成/ }).click();
  }
  await page.getByRole('button', { name: '待办菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '搜索和筛选', exact: true }).click();
  await page.getByRole('combobox', { name: '按来源筛选', exact: true }).selectOptions('collector:collector-a');
  await expect.element(page.getByRole('button', { name: '旧待办', exact: true })).not.toBeInTheDocument();
  await expect.element(open.getByText('项目事项 A', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await expect.element(page.getByRole('button', { name: '旧待办', exact: true })).toBeInTheDocument();
  expect(document.documentElement.scrollWidth).toBe(width);
  await page.screenshot({ path: `/tmp/termdock-todo-category-${width}.png` });
});
