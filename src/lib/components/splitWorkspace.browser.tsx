import { useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import '../../index.css';

const api = vi.hoisted(() => ({ getSessionInventory: vi.fn(), openSessionInventoryEntry: vi.fn(), removeSessionInventoryEntry: vi.fn(),
  closeTerminal: vi.fn(), killTmuxSession: vi.fn(), sendTerminalInput: vi.fn(), updateSessionInventoryEntry: vi.fn(), reorderSessionInventoryEntries: vi.fn() }));
vi.mock('../terminal', async original => ({ ...await original<typeof import('../terminal')>(), ...api }));
vi.mock('../terminal/api', async original => ({ ...await original<typeof import('../terminal/api')>(), ...api,
  getSettings: vi.fn().mockResolvedValue({}), updateSettings: vi.fn().mockResolvedValue({}), suspendTerminalConnectionReconnects: vi.fn() }));
vi.mock('../utils/clientStateSync', () => ({ subscribeClientState: () => () => {} }));
vi.mock('./views/TerminalView', () => ({ TerminalView: (props: any) => {
  useEffect(() => { props.onStreamReadyChange(props.sessionId, true); props.onViewportReadyChange(props.sessionId, true); props.onContentReadyChange(props.sessionId, true); }, [props.sessionId]);
  return <textarea aria-label={`Terminal ${props.sessionId}`} />;
} }));
import { MultiTerminalView } from './MultiTerminalView';
import { I18nProvider } from '../i18n';
import { useSidebarStore } from '../stores/useSidebarStore';
import { useTerminalStore } from '../stores/useTerminalStore';
import { useCollaborationPanelDock } from '../stores/useCollaborationPanelDock';
import { clearChatSnapshots } from './chat/chatSnapshot';

let root: Root | undefined;
afterEach(() => { root?.unmount(); root = undefined; document.body.replaceChildren(); clearChatSnapshots(); vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear(); });

it('loads both visible chats without focusing the second, puts shared sidebar toggles in each compact title, and defers the hidden chat', async () => {
  await page.viewport(1440, 900);
  localStorage.clear(); sessionStorage.clear(); localStorage.setItem('termdock:locale', 'zh');
  const ids = ['split-visible-a', 'split-visible-b', 'split-hidden-c'];
  const sessions = ids.map((sessionId, i) => ({ frontendSessionId: sessionId, sessionId, name: sessionId, customName: true,
    backendSessionId: `backend-${sessionId}`, mode: 'shell', tmuxSessionName: null, createdAt: i + 1, lastActivity: i + 1, connected: false, live: false, restorable: true }));
  api.getSessionInventory.mockResolvedValue({ clientSessions: sessions, tmuxSessions: [], tmuxStatus: { available: false, version: null, reason: null }, updatedAt: 1 });
  localStorage.setItem('termdock-sessions-cache', JSON.stringify(sessions));
  localStorage.setItem('termdock-active-session', ids[0]);
  localStorage.setItem('termdock:split-workspaces:v2', JSON.stringify([{ id: 'visible-split', sessionIds: ids.slice(0, 2), layout: 'horizontal' }]));
  for (const id of ids) localStorage.setItem(`termdock:session-view:${location.origin}:${id}`, 'chat');
  const reads = new Map<string, number>(); let revision = 1;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/view-mode')) return Response.json({ mode: 'chat', updatedAt: 1, chatEligibility: { allowed: true, program: 'codex' } });
    const match = /\/api\/terminal\/([^/]+)\/chat\?/.exec(url);
    if (match) {
      const id = match[1]; reads.set(id, (reads.get(id) ?? 0) + 1);
      return Response.json({ agentAvailable: true, agent: { slug: 'codex', displayName: 'Codex' }, messages: [{ id: `reply-${id}`, role: 'assistant', content: `loaded ${id} revision ${revision}`, createdAt: 1, status: 'stored' }], page: { hasOlder: false, hasNewer: false, mode: 'latest' } });
    }
    return Response.json({ entries: [], groups: [], tasks: [], messages: [] });
  }));
  useSidebarStore.setState({ leftOpen: false, rightOpen: false, desktopRightOpen: false });
  useTerminalStore.setState({ sessions: new Map(), activeSessionId: null });
  useCollaborationPanelDock.setState({ activePaneId: null, docks: {}, hosts: {} });
  function Fixture() {
    const [left, setLeft] = useState(true), [right, setRight] = useState(false), [active, setActive] = useState('');
    return <div className="flex h-dvh">
      {left && <aside className="w-40 shrink-0"><button onClick={() => setLeft(false)}>收起测试侧栏</button></aside>}
      <main data-test-split-main className="min-w-0 flex-1"><MultiTerminalView desktopFloatingTitle desktopLeftSidebarPinned={left}
        leftSidebarOpen={left} rightSidebarOpen={right} onToggleLeftSidebar={() => setLeft(!left)} onToggleRightSidebar={() => setRight(!right)}
        onSessionDataUpdate={data => setActive(data.activeSessionId ?? '')} /></main>
      {right && <aside data-common-tools className="w-56 shrink-0">工具属于 {active}</aside>}
    </div>;
  }
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  flushSync(() => root!.render(<I18nProvider><Fixture /></I18nProvider>));
  await expect.poll(() => document.body.textContent, { timeout: 10000 }).toContain('loaded split-visible-a revision 1');
  await expect.poll(() => document.body.textContent, { timeout: 10000 }).toContain('loaded split-visible-b revision 1');
  expect(document.querySelector('[data-session-workspace="split-visible-b"]')?.getAttribute('data-session-active')).toBe('false');
  expect(reads.has(ids[2])).toBe(false);
  expect(document.querySelector('[data-split-window-header]')).toBeNull();
  const title = document.querySelector('[data-layout-pane="split-visible-a"] [data-pane-titlebar]')!;
  expect(title.getBoundingClientRect().height).toBe(24);
  expect(Math.abs(title.getBoundingClientRect().top - document.querySelector('[data-test-split-main]')!.getBoundingClientRect().top)).toBeLessThan(1);
  const editor = document.querySelector('[data-session-workspace="split-visible-b"] [contenteditable]');
  const second = page.getByRole('button', { name: '展开工具面板', exact: true }).nth(1);
  await second.click();
  await expect.poll(() => document.querySelector('[data-common-tools]')?.textContent).toContain(ids[1]);
  expect(document.querySelectorAll('[data-common-tools]')).toHaveLength(1);
  expect(document.querySelectorAll('[data-pane-titlebar] [aria-expanded="true"]')).toHaveLength(2);
  await page.getByRole('button', { name: '收起工具面板', exact: true }).nth(0).click();
  expect(document.querySelector('[data-common-tools]')).toBeNull();
  expect(document.querySelector('[data-session-workspace="split-visible-b"] [contenteditable]')).toBe(editor);
  revision = 2; window.dispatchEvent(new Event('online'));
  await expect.poll(() => document.body.textContent).toContain('loaded split-visible-b revision 2');
  await page.getByRole('button', { name: '收起测试侧栏', exact: true }).click();
  await page.getByRole('button', { name: '展开会话列表', exact: true }).click();
  expect(document.querySelector('[data-split-window-header]')).toBeNull();
  flushSync(() => window.dispatchEvent(new CustomEvent('switch-terminal-session', { detail: ids[2] })));
  await expect.poll(() => document.body.textContent).toContain('loaded split-hidden-c revision 2');
});
