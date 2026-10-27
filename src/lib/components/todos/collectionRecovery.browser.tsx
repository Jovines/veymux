import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import '../../../index.css';
import TodoWorkspace from './TodoWorkspace';
import { useTodoWorkspace } from '../../todos/workspace';
import type { TodoRun, TodoSnapshot } from '../../todos/api';

const api = vi.hoisted(() => ({ list: vi.fn(), retry: vi.fn(), cancel: vi.fn() }));
vi.mock('../../todos/api', async original => ({ ...await original<typeof import('../../todos/api')>(), listTodos: api.list, retryTodoCollection: api.retry, cancelTodoCollection: api.cancel }));
vi.mock('../../terminal/api', async original => ({ ...await original<typeof import('../../terminal/api')>(), getAgentLaunchers: async () => [], getSettings: async () => ({ newSessionAgentSlug: null }) }));
vi.mock('../../federation/browserIntegration', async original => ({ ...await original<typeof import('../../federation/browserIntegration')>(), savedConnection: () => null }));
let root: Root;
afterEach(() => { flushSync(() => root?.unmount()); document.body.innerHTML = ''; useTodoWorkspace.setState({ views: {}, snapshots: {}, options: {} }); vi.resetAllMocks(); });

it.each([320, 390, 1280])('recovers an interrupted collection explicitly and keeps controls reachable at %i px', async width => {
  await page.viewport(width, 844);
  const config = { agentSlug: 'codex', command: 'codex', cwd: '/project', prompt: '只收集' };
  const old: TodoRun = { id: 'old', kind: 'collect', todoId: null, collectorId: 'collector', name: '每日收集', config, status: 'failed', sessionId: 'closed-session', createdAt: 1, updatedAt: 2, result: '', error: '服务重启，本轮结果待核对', collection: { state: 'interrupted', revision: 4 } };
  const data: TodoSnapshot = { todos: [], collectors: [{ id: 'collector', name: '每日收集', config, enabled: true, schedule: null, nextRunAt: null, createdAt: 1, updatedAt: 1, revision: 1 }], runs: [old], defaults: config };
  api.list.mockImplementation(async () => structuredClone(data));
  api.retry.mockRejectedValueOnce(new Error('请先核对并关闭原收集终端'));
  api.retry.mockImplementationOnce(async (run: TodoRun) => {
    const next: TodoRun = { ...run, id: 'new', error: '', status: 'delivered', sessionId: null, collection: { state: 'active', revision: 1, previousRunId: run.id } };
    data.runs[0] = { ...old, collection: { state: 'cancelled', revision: 5, retryRunId: next.id } }; data.runs.push(next); return { run: next };
  });
  api.cancel.mockImplementation(async (run: TodoRun) => {
    const next: TodoRun = { ...run, status: 'failed', collection: { ...run.collection!, state: 'cancelled', revision: run.collection!.revision + 1 } };
    data.runs = data.runs.map(item => item.id === run.id ? next : item); return { run: next };
  });
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  flushSync(() => root.render(<TodoWorkspace leftSidebarVisible={false} onOpenSidebar={() => {}} />));
  await expect.element(page.getByRole('button', { name: '管理收集方向', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '管理收集方向', exact: true }).click();
  await expect.element(page.getByRole('button', { name: '等待本轮结果', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '重试收集', exact: true }).click();
  await expect.element(page.getByRole('alert')).toHaveTextContent('请先核对并关闭原收集终端');
  await page.getByRole('button', { name: '重试收集', exact: true }).click();
  await expect.element(page.getByRole('button', { name: '重试收集', exact: true })).not.toBeInTheDocument();
  expect(api.retry.mock.calls[0][1]).toBe(api.retry.mock.calls[1][1]);
  const cancel = page.getByRole('button', { name: '结束此轮', exact: true });
  const box = cancel.element().getBoundingClientRect(); expect(box.height).toBeGreaterThanOrEqual(44); expect(box.right).toBeLessThanOrEqual(width);
  await cancel.click();
  await expect.element(page.getByRole('button', { name: '再次收集', exact: true })).toBeEnabled();
  expect(data.runs).toHaveLength(2); expect(data.runs[1].collection?.state).toBe('cancelled');
  expect(document.documentElement.scrollWidth).toBe(width);
  await page.screenshot({ path: `/tmp/termdock-collection-recovery-${width}.png` });
});
