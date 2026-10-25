// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import { RecoverableSessions } from './RecoverableSessions';

const sessions = Array.from({ length: 5 }, (_, index) => ({
  name: `wt-${index}`, friendlyName: `Session ${index}`, windows: 1, attached: 0,
}));

beforeEach(() => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ locale: 'en' }) })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function view(onClose = vi.fn(async () => {}), onRestore = vi.fn()) {
  return <I18nProvider><RecoverableSessions sessions={sessions} loading={false}
    attachingName={null} onClose={onClose} onRestore={onRestore} /></I18nProvider>;
}

describe('Recoverable sessions controls', () => {
  it('makes every session actionable and requires confirmation before ending it', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn(async () => {});
    const onRestore = vi.fn();
    render(view(onClose, onRestore));
    await user.click(screen.getByRole('button', { name: 'Recoverable sessions' }));
    await user.click(screen.getByRole('button', { name: 'Close Session 4' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(onRestore).not.toHaveBeenCalled();
    expect(screen.getByText(/This stops all processes/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'End session' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Close Session 4' }));
    await user.click(screen.getByRole('button', { name: 'End session' }));
    expect(onClose).toHaveBeenCalledExactlyOnceWith('wt-4');
    expect(screen.queryByRole('button', { name: 'End session' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Restore Session 0' }));
    expect(onRestore).toHaveBeenCalledExactlyOnceWith(sessions[0]);
  });

  it('keeps failed sessions available for retry and prevents duplicate end requests', async () => {
    const user = userEvent.setup();
    let rejectClose!: (error: Error) => void;
    const onClose = vi.fn().mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectClose = reject; }))
      .mockResolvedValue(undefined);
    render(view(onClose));
    await user.click(screen.getByRole('button', { name: 'Recoverable sessions' }));
    await user.click(screen.getByRole('button', { name: 'Close Session 0' }));
    await user.click(screen.getByRole('button', { name: 'End session' }));
    expect(screen.getByRole('button', { name: 'Loading…' }).hasAttribute('disabled')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Loading…' }));
    expect(onClose).toHaveBeenCalledOnce();
    await act(async () => rejectClose(new Error('Connection interrupted')));
    expect(screen.getByRole('alert').textContent).toBe('Connection interrupted');
    expect(screen.getByRole('button', { name: 'Restore Session 0' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'End session' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('starts closed on every mount, dismisses without ending sessions, and restores trigger focus on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn(async () => {});
    const rendered = render(view(onClose));
    const trigger = screen.getByRole('button', { name: 'Recoverable sessions' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Recoverable sessions' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Close Session 0' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    // Removing the focused confirmation button leaves focus on body in browsers.
    (document.activeElement as HTMLElement)?.blur();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await user.click(trigger);
    expect(screen.queryByRole('button', { name: 'End session' })).toBeNull();
    await user.click(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
    rendered.unmount();
    render(view(onClose));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps the list open through pending restores and candidate removal for consecutive restores', async () => {
    const user = userEvent.setup();
    const onRestore = vi.fn();
    const rendered = render(view(undefined, onRestore));
    await user.click(screen.getByRole('button', { name: 'Recoverable sessions' }));
    await user.click(screen.getByRole('button', { name: 'Restore Session 0' }));
    expect(onRestore).toHaveBeenCalledExactlyOnceWith(sessions[0]);
    expect(screen.getByRole('dialog')).toBeTruthy();
    rendered.rerender(<I18nProvider><RecoverableSessions sessions={sessions} loading={false} attachingName="wt-0" onRestore={onRestore} /></I18nProvider>);
    expect(screen.getByRole('button', { name: 'Restore Session 1' }).hasAttribute('disabled')).toBe(true);
    rendered.rerender(<I18nProvider><RecoverableSessions sessions={sessions.slice(1)} loading={false} attachingName={null} onRestore={onRestore} /></I18nProvider>);
    await user.click(screen.getByRole('button', { name: 'Restore Session 1' }));
    expect(onRestore).toHaveBeenLastCalledWith(sessions[1]);
    expect(screen.getByRole('dialog')).toBeTruthy();
    rendered.rerender(<I18nProvider><RecoverableSessions sessions={[]} loading={false} attachingName={null} onRestore={onRestore} /></I18nProvider>);
    expect(screen.queryByRole('button', { name: 'Recoverable sessions' })).toBeNull();
  });

  it('shows the shared projection for sessions in the same directory rather than stale tmux labels', async () => {
    const user = userEvent.setup();
    const onRestore = vi.fn();
    const candidates = sessions.slice(0, 2).map((session, index) => ({ ...session,
      friendlyName: 'Old title', label: 'codex · web-terminal', cwd: '/work/web-terminal',
      displayName: index === 0 ? '优化对话模式HTML体验' : '修复 PWA 侧栏', displaySubtitle: 'web-terminal' }));
    render(<I18nProvider><RecoverableSessions sessions={candidates} loading={false} attachingName={null} onRestore={onRestore} /></I18nProvider>);
    await user.click(screen.getByRole('button', { name: 'Recoverable sessions' }));
    expect(screen.queryByText('codex · web-terminal')).toBeNull();
    expect(screen.getAllByText('web-terminal')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Restore 优化对话模式HTML体验' }));
    expect(onRestore).toHaveBeenCalledWith(candidates[0]);
    expect(screen.getByRole('button', { name: 'Restore 修复 PWA 侧栏' })).toBeTruthy();
  });
});
