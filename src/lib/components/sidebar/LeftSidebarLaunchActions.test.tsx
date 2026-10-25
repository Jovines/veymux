// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import { LeftSidebar } from './LeftSidebar';
import { AppFeedbackHost } from '../ui/AppFeedback';

const codex = {
  slug: 'codex',
  displayName: 'Codex',
  command: 'codex',
  accentColor: 'var(--primary)',
  icon: null,
  isPlugin: false,
};

vi.mock('../../hooks/useNewSessionAgentPreference', () => ({
  useNewSessionAgentPreference: () => ({
    preference: codex,
    agents: [codex],
    detecting: false,
    refresh: vi.fn(),
    selectAgent: vi.fn(),
  }),
}));

vi.mock('../../terminal/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../terminal/api')>()),
  listAgentResumeHistory: vi.fn().mockResolvedValue([]),
  listCollaborationTasks: vi.fn().mockResolvedValue({ tasks: [] }),
}));

const originalGetAnimations = Object.getOwnPropertyDescriptor(Element.prototype, 'getAnimations');
afterEach(() => {
  cleanup();
  if (originalGetAnimations) Object.defineProperty(Element.prototype, 'getAnimations', originalGetAnimations);
  else Reflect.deleteProperty(Element.prototype, 'getAnimations');
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('LeftSidebar launch actions', () => {
  it.each(['New Codex', 'New terminal'])('shows waiting on the requested launcher (%s), then clears it on failure and retry', async (name) => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ locale: 'en' }) })));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onNewSession = vi.fn();
    render(<I18nProvider><AppFeedbackHost /><LeftSidebar isOpen pinned drawerWidthPx={320} sessions={[]}
      activeSessionId={null} sessionStates={new Map()} onNewSession={onNewSession}
      onClose={vi.fn()} onCloseSession={vi.fn()} onSplitSession={vi.fn()} onCloseSplit={vi.fn()}
      onRemoveFromSplit={vi.fn()} splitWorkspaces={[]} onSetSplitLayout={vi.fn()}
      onReorderSplitWorkspace={vi.fn()} onRenameSplitWorkspace={vi.fn()} onCombineSplitSessions={vi.fn()}
      onReorderSessions={vi.fn()} onOpenSettings={vi.fn()} /></I18nProvider>);
    const button = screen.getByRole('button', { name });
    const other = screen.getByRole('button', { name: name === 'New Codex' ? 'New terminal' : 'New Codex' });
    await user.click(button);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(other.getAttribute('aria-busy')).toBe('false');
    expect(button.querySelector('.td-loading-spinner')).toBeTruthy();
    expect(other.querySelector('.td-loading-spinner')).toBeNull();
    expect(button.textContent).toContain(name === 'New Codex' ? 'Codex' : 'Terminal');
    expect(screen.queryByText('Still waiting for the service…')).toBeNull();
    await user.click(button);
    expect(onNewSession).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(8000));
    expect(screen.getByText('Still waiting for the service…')).toBeTruthy();
    expect(screen.getByText('8s')).toBeTruthy();
    expect(screen.getByText('You can keep using your current session.')).toBeTruthy();
    act(() => onNewSession.mock.calls[0][0].onResult({ ok: false, error: 'connection' }));
    expect(screen.queryByText('Still waiting for the service…')).toBeNull();
    expect(button.getAttribute('aria-busy')).toBe('false');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onNewSession).toHaveBeenCalledTimes(2);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByText('Still waiting for the service…')).toBeNull();
    act(() => onNewSession.mock.calls[1][0].onResult({ ok: true, sessionId: 'new' }));
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(button.getAttribute('aria-busy')).toBe('false');
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.queryByText('Still waiting for the service…')).toBeNull();
  });

  it('keeps Terminal and the default Agent one tap away while reserving disclosure for options', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ locale: 'en' }),
    })));
    const user = userEvent.setup();
    const onNewSession = vi.fn((options) => options?.onResult?.({ ok: true, sessionId: 'new' }));

    render(
      <I18nProvider>
        <LeftSidebar
          isOpen
          pinned
          drawerWidthPx={320}
          sessions={[]}
          activeSessionId={null}
          sessionStates={new Map()}
          onNewSession={onNewSession}
          onClose={vi.fn()}
          onCloseSession={vi.fn()}
          onSplitSession={vi.fn()}
          onCloseSplit={vi.fn()}
          onRemoveFromSplit={vi.fn()}
          splitWorkspaces={[]}
          onSetSplitLayout={vi.fn()}
          onReorderSplitWorkspace={vi.fn()}
          onRenameSplitWorkspace={vi.fn()}
          onCombineSplitSessions={vi.fn()}
          onReorderSessions={vi.fn()}
          onOpenSettings={vi.fn()}
        />
      </I18nProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'New terminal' }));
    expect(onNewSession).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'shell' }));

    await user.click(screen.getByRole('button', { name: 'New Codex' }));
    expect(onNewSession).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'shell', command: 'codex' }));

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('region', { name: 'Start a session' })).toBeTruthy();
    expect(onNewSession).toHaveBeenCalledTimes(2);
  });

  it('keeps a failed launch draft, prevents duplicates and closes only after successful retry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ locale: 'en' }) })));
    const user = userEvent.setup();
    const onNewSession = vi.fn();
    render(<I18nProvider><AppFeedbackHost /><LeftSidebar isOpen pinned drawerWidthPx={320} sessions={[]}
      activeSessionId={null} sessionStates={new Map()} onNewSession={onNewSession}
      onClose={vi.fn()} onCloseSession={vi.fn()} onSplitSession={vi.fn()} onCloseSplit={vi.fn()}
      onRemoveFromSplit={vi.fn()} splitWorkspaces={[]} onSetSplitLayout={vi.fn()}
      onReorderSplitWorkspace={vi.fn()} onRenameSplitWorkspace={vi.fn()} onCombineSplitSessions={vi.fn()}
      onReorderSessions={vi.fn()} onOpenSettings={vi.fn()} /></I18nProvider>);
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('radio', { name: 'Add custom command…' }));
    await user.type(screen.getByRole('textbox', { name: 'Startup command' }), 'printf preserved');
    await user.click(screen.getByRole('button', { name: /^Start / }));
    expect(onNewSession).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: /^Start / }).hasAttribute('disabled')).toBe(true);
    await user.click(screen.getByRole('button', { name: /^Start / }));
    expect(onNewSession).toHaveBeenCalledOnce();
    act(() => onNewSession.mock.calls[0][0].onResult({ ok: false, error: 'directoryUnavailable' }));
    expect(screen.getByRole('alert').textContent).toContain('working directory');
    expect((screen.getByRole('textbox', { name: 'Startup command' }) as HTMLInputElement).value).toBe('printf preserved');
    await user.click(screen.getByRole('button', { name: /^Start / }));
    act(() => onNewSession.mock.calls[1][0].onResult({ ok: true, sessionId: 'new' }));
    expect(screen.queryByRole('region', { name: 'Start a session' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'New terminal' }));
    act(() => onNewSession.mock.calls[2][0].onResult({ ok: false, error: 'connection' }));
    expect((await screen.findByRole('alert')).textContent).toContain('connect');
    expect(screen.getByRole('button', { name: 'New terminal' }).hasAttribute('disabled')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('button', { name: /^Start / }));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'More actions' }).hasAttribute('disabled')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.queryByRole('region', { name: 'Start a session' })).toBeNull();
    act(() => onNewSession.mock.calls[3][0].onResult({ ok: false, error: 'directoryUnavailable' }));
    expect((await screen.findByRole('alert')).textContent).toContain('working directory');
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the mobile sidebar open for recovery, supports retry after failure and refreshes on success', async () => {
    Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, value: () => [] });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ locale: 'en' }),
    })));
    const user = userEvent.setup();
    const onNewSession = vi.fn();
    const onClose = vi.fn();
    const onRefresh = vi.fn();

    render(
      <I18nProvider>
        <LeftSidebar
          isOpen
          pinned={false}
          drawerWidthPx={320}
          sessions={[]}
          activeSessionId={null}
          sessionStates={new Map()}
          recoverableTmuxSessions={[{
            name: 'wt-codex',
            windows: 1,
            attached: 0,
            friendlyName: 'Fix session recovery',
            program: 'codex',
            cwd: '/work/web-terminal',
          }]}
          onNewSession={onNewSession}
          onClose={onClose}
          onRefreshRecoverableTmuxSessions={onRefresh}
          onCloseSession={vi.fn()}
          onSplitSession={vi.fn()}
          onCloseSplit={vi.fn()}
          onRemoveFromSplit={vi.fn()}
          splitWorkspaces={[]}
          onSetSplitLayout={vi.fn()}
          onReorderSplitWorkspace={vi.fn()}
          onRenameSplitWorkspace={vi.fn()}
          onCombineSplitSessions={vi.fn()}
          onReorderSessions={vi.fn()}
          onOpenSettings={vi.fn()}
        />
      </I18nProvider>,
    );

    const recovery = screen.getByRole('button', { name: 'Recoverable sessions' });
    expect(recovery.closest('[data-session-sidebar-header]')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Restore Fix session recovery' })).toBeNull();
    await user.click(recovery);
    expect(screen.getByRole('dialog', { name: 'Recoverable sessions' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Restore Fix session recovery' }));
    expect(onNewSession).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'tmux',
      tmuxSessionName: 'wt-codex',
      cwd: '/work/web-terminal',
    }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Recoverable sessions' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Restore Fix session recovery' }).hasAttribute('disabled')).toBe(true);
    act(() => onNewSession.mock.calls[0][0].onResult({ ok: false, error: 'connection' }));
    await user.click(screen.getByRole('button', { name: 'Restore Fix session recovery' }));
    expect(onNewSession).toHaveBeenCalledTimes(2);
    act(() => onNewSession.mock.calls[1][0].onResult({ ok: true, sessionId: 'restored' }));
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });
});
