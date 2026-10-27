import { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import '../../../index.css';
import { I18nProvider } from '../../i18n';
import { LeftSidebar } from './LeftSidebar';
import { AgentOperationsPanel } from './AgentOperationsPanel';
import type { NewSessionRequestOptions } from '../../terminal/newSessionRequest';

let root: Root | undefined;
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); localStorage.setItem('veymux:locale', 'en');
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ locale: 'en', groups: [], agents: [], sessions: [], tasks: [] })));
});
afterEach(() => { root?.unmount(); document.body.replaceChildren(); vi.unstubAllGlobals(); });

it.each([1440, 390])('keeps the automation backend selection visible and saves it at %s px', async width => {
  await page.viewport(width, 844);
  const saved: NewSessionRequestOptions[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/agent-launchers')) return Response.json({ agents: [{ slug: 'codex', displayName: 'Codex', command: 'codex', accentColor: 'var(--primary)', icon: null }] });
    if (url.endsWith('/operations/automations')) {
      if (init?.method === 'POST') { saved.push(JSON.parse(String(init.body))); return Response.json({ automation: {} }); }
      return Response.json({ automations: [], runs: [] });
    }
    if (url.includes('/csrf-token')) return Response.json({ csrfToken: 'test-token' });
    return Response.json({ locale: 'en', groups: [], agents: [], sessions: [], tasks: [] });
  }));
  const host = document.createElement('div'); host.id = 'root'; document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(<AgentOperationsPanel activeSessionId={null} defaultSessionMode="tmux" onClose={vi.fn()} onNewSession={vi.fn()} />));
  await page.getByRole('button', { name: '自动任务', exact: true }).click();
  await page.getByRole('button', { name: '创建第一个任务', exact: true }).click();
  await page.getByLabelText('任务内容', { exact: true }).fill('检查项目');
  await page.getByRole('button', { name: '更多设置', exact: true }).click();
  const select = page.getByRole('combobox', { name: /终端类型/ });
  await expect.element(select).toHaveValue('tmux');
  await select.selectOptions('shell');
  await page.getByRole('button', { name: '创建任务', exact: true }).click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0].mode).toBe('shell');
});

it.each([1440, 390])('restores search history without overriding the selected terminal backend at %s px', async width => {
  await page.viewport(width, 844);
  const result = { sessionId: 'native:original', title: '原来的项目名称', cwd: '/work/project', agentSlug: 'codex',
    agentNativeSessionId: 'native-original', updatedAt: Date.now(), snippet: '', matchCount: 1,
    source: 'codex', nativeKey: 'native-key', live: false, resumeHistoryId: null, terminalSessionId: null };
  const requests: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input); requests.push(url);
    if (url.includes('/session-search/prepare')) return Response.json({ cwd: result.cwd, command: 'codex resume native-original' });
    if (url.includes('/session-search?')) return Response.json({ results: [result], total: 1 });
    if (url.includes('/csrf-token')) return Response.json({ csrfToken: 'test-token' });
    return Response.json({ locale: 'en', groups: [], agents: [], sessions: [], tasks: [] });
  }));
  const onClose = vi.fn(), onNewSession = vi.fn<(options: NewSessionRequestOptions) => void>();
  const host = document.createElement('div'); host.id = 'root'; document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(<AgentOperationsPanel activeSessionId={null} defaultSessionMode="tmux" onClose={onClose} onNewSession={onNewSession} />));
  await page.getByRole('button', { name: '历史搜索', exact: true }).click();
  await page.getByRole('button', { name: /原来的项目名称/ }).click();
  await expect.poll(() => onNewSession.mock.calls.length).toBe(1);
  const launch = onNewSession.mock.calls[0][0];
  expect(launch.mode).toBeUndefined();
  expect(launch).toMatchObject({ cwd: result.cwd, command: 'codex resume native-original' });
  expect(onClose).not.toHaveBeenCalled();
  flushSync(() => launch.onResult?.({ ok: false, error: 'connection' }));
  await expect.element(page.getByText('无法创建恢复会话，请检查目录和连接后重试')).toBeVisible();
  await page.getByRole('button', { name: /原来的项目名称/ }).click();
  await expect.poll(() => onNewSession.mock.calls.length).toBe(2);
  flushSync(() => onNewSession.mock.calls[1][0].onResult?.({ ok: true, sessionId: 'restored' }));
  await expect.poll(() => onClose.mock.calls.length).toBe(1);
  expect(requests).toContain('/api/terminal/session-inventory/sessions/restored');
});

it.each([1440, 390, 320])('keeps consecutive restores reachable at %s px with distinct shared titles', async width => {
  await page.viewport(width, 844);
  const candidates = ['优化对话模式HTML体验', '修复 PWA 侧栏'].map((displayName, index) => ({ name: `wt-recovery-${index}`,
    displayName, displaySubtitle: 'web-terminal', label: 'codex · web-terminal', windows: 1, attached: 0, cwd: '/work/web-terminal' }));
  const closed = vi.fn(), refresh = vi.fn();
  let pending: NewSessionRequestOptions | undefined;
  let complete: () => void = () => {};
  const restore = vi.fn((options?: NewSessionRequestOptions) => { pending = options; });
  function Harness() {
    const [sessions, setSessions] = useState(candidates);
    complete = () => {
      setSessions(current => current.filter(session => session.name !== pending?.tmuxSessionName));
      pending?.onResult?.({ ok: true, sessionId: 'restored' });
    };
    return <I18nProvider><LeftSidebar isOpen pinned={width > 1024} drawerWidthPx={Math.min(320, width - 24)}
      sessions={[]} activeSessionId={null} sessionStates={new Map()} recoverableTmuxSessions={sessions}
      onNewSession={restore} onClose={closed} onRefreshRecoverableTmuxSessions={refresh}
      onCloseSession={vi.fn()} onSplitSession={vi.fn()} onCloseSplit={vi.fn()} onRemoveFromSplit={vi.fn()}
      splitWorkspaces={[]} onSetSplitLayout={vi.fn()} onReorderSplitWorkspace={vi.fn()} onRenameSplitWorkspace={vi.fn()}
      onCombineSplitSessions={vi.fn()} onReorderSessions={vi.fn()} onOpenSettings={vi.fn()} /></I18nProvider>;
  }
  const host = document.createElement('div'); host.id = 'root'; document.body.append(host);
  root = createRoot(host); flushSync(() => root!.render(<Harness />));
  await page.getByRole('button', { name: 'Recoverable sessions', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Recoverable sessions', exact: true });
  await expect.element(dialog).toBeVisible();
  const bounds = document.querySelector('[role="dialog"]')!.getBoundingClientRect();
  expect(bounds.left).toBeGreaterThanOrEqual(0); expect(bounds.right).toBeLessThanOrEqual(width);
  await page.getByRole('button', { name: 'Restore 优化对话模式HTML体验', exact: true }).click();
  expect(pending?.tmuxSessionName).toBe(candidates[0].name);
  await expect.element(dialog).toBeVisible();
  await expect.element(page.getByRole('button', { name: 'Restore 修复 PWA 侧栏', exact: true })).toBeDisabled();
  flushSync(complete);
  await expect.element(dialog).toBeVisible();
  await page.getByRole('button', { name: 'Restore 修复 PWA 侧栏', exact: true }).click();
  expect(pending?.tmuxSessionName).toBe(candidates[1].name);
  expect(restore).toHaveBeenCalledTimes(2); expect(closed).not.toHaveBeenCalled();
  flushSync(complete);
  await expect.element(dialog).not.toBeInTheDocument();
  expect(refresh).toHaveBeenCalledTimes(2);
});
