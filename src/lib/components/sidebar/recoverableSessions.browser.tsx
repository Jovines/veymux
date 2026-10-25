import { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import '../../../index.css';
import { I18nProvider } from '../../i18n';
import { LeftSidebar } from './LeftSidebar';
import type { NewSessionRequestOptions } from '../../terminal/newSessionRequest';

let root: Root | undefined;
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); localStorage.setItem('termdock:locale', 'en');
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ locale: 'en', groups: [], agents: [], sessions: [], tasks: [] })));
});
afterEach(() => { root?.unmount(); document.body.replaceChildren(); vi.unstubAllGlobals(); });

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
