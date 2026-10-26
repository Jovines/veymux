// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatComposerActions } from './ChatComposerActions';
import { SessionCapabilitiesContext } from '../../federation/ShareAccessContext';
import { sharedSessionCapabilities } from '../../federation/sessionCapabilities';
import { useTerminalStore } from '../../stores/useTerminalStore';
import { useFeedbackStore } from '../ui/AppFeedback';
import { TODO_GUIDANCE } from '../../todos/guidance';
const actions = vi.hoisted(() => ({ insert: vi.fn(), copy: vi.fn() }));
vi.mock('../../terminal/insertSessionDraft', () => ({ insertSessionDraft: actions.insert }));
vi.mock('../../terminal/clipboardText', () => ({ writeTerminalClipboardText: actions.copy }));
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  actions.insert.mockReset().mockResolvedValue('inserted'); actions.copy.mockReset().mockResolvedValue(true);
  useTerminalStore.getState().setTerminalSession('target', { sessionId: 'backend', mode: 'shell', cols: 80, rows: 24, cwd: '/workspace/project' });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); useTerminalStore.getState().clearAllTerminalSessions(); });
function mount(active = true, canWrite = true) { return render(<section data-session-chat><input aria-label="chat" /><ChatComposerActions sessionId="target" active={active} canWrite={canWrite} /></section>); }
it('keeps display clearing independently available in a read-only share and restores from the same menu', () => {
  const clear = vi.fn(), restore = vi.fn();
  render(<SessionCapabilitiesContext.Provider value={sharedSessionCapabilities({ canViewChat: true, canWrite: false, canClearChat: true })}><section data-session-chat><ChatComposerActions sessionId="target" active canWrite={false} onClearDisplay={clear} onRestoreDisplay={restore} /></section></SessionCapabilitiesContext.Provider>);
  fireEvent.click(screen.getByRole('button', { name: '更多会话操作' }));
  expect(screen.queryByRole('menuitem', { name: '分享这个会话' })).toBeNull();
  fireEvent.click(screen.getByRole('menuitem', { name: '清空显示' })); expect(clear).toHaveBeenCalledOnce();
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '更多会话操作' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '恢复旧记录' })); expect(restore).toHaveBeenCalledOnce();
  expect(actions.insert).not.toHaveBeenCalled(); expect(actions.copy).not.toHaveBeenCalled();
});
it('uses the shared prompt insertion for the exact Session, closes the menu and never submits', async () => {
  mount();
  const editor = screen.getByLabelText('chat'); editor.focus();
  const trigger = screen.getByRole('button', { name: '更多会话操作' });
  fireEvent.pointerDown(trigger); fireEvent.click(trigger, { detail: 1 });
  expect(document.activeElement).toBe(editor);
  fireEvent.click(screen.getByRole('menuitem', { name: '插入待办提示' }));
  await waitFor(() => expect(actions.insert).toHaveBeenCalledExactlyOnceWith('target', ` ${TODO_GUIDANCE} `));
  expect(screen.queryByRole('menu')).toBeNull(); expect(actions.copy).not.toHaveBeenCalled();
});
it('copies the observed directory through the shared clipboard helper and reports failure', async () => {
  mount(); fireEvent.click(screen.getByRole('button', { name: '更多会话操作' }), { detail: 1 });
  fireEvent.click(screen.getByRole('menuitem', { name: '复制当前目录' }));
  await waitFor(() => expect(actions.copy).toHaveBeenCalledWith('/workspace/project', expect.any(Function)));
  await waitFor(() => expect(useFeedbackStore.getState().items.some(item => item.message === '当前目录已复制')).toBe(true));
  actions.insert.mockResolvedValue('failed');
  fireEvent.click(screen.getByRole('button', { name: '更多会话操作' }), { detail: 1 });
  fireEvent.click(screen.getByRole('menuitem', { name: '插入待办提示' }));
  await waitFor(() => expect(useFeedbackStore.getState().items.some(item => item.tone === 'error' && item.message.includes('未插入'))).toBe(true));
});
it('shares only the current chat Session with the existing share action', () => {
  const share = vi.fn(); window.addEventListener('termdock:open-services', share);
  try {
    mount(); fireEvent.click(screen.getByRole('button', { name: '更多会话操作' }), { detail: 1 });
    fireEvent.click(screen.getByRole('menuitem', { name: '分享这个会话' }));
    expect((share.mock.calls[0][0] as CustomEvent).detail).toEqual({ inviteSessionId: 'target', viewMode: 'chat' });
    expect(screen.queryByRole('menu')).toBeNull();
  } finally { window.removeEventListener('termdock:open-services', share); }
});
it.each([false, true])('does not inherit owner actions from shared input permission (writable %s)', writable => {
  render(<SessionCapabilitiesContext.Provider value={sharedSessionCapabilities({ canWrite: writable })}><ChatComposerActions sessionId="target" active canWrite={writable} /></SessionCapabilitiesContext.Provider>);
  expect(screen.queryByRole('button', { name: '更多会话操作' })).toBeNull();
});
it('hides draft insertion when input is readonly and rejects inactive actions', () => {
  const view = mount(true, false); fireEvent.click(screen.getByRole('button', { name: '更多会话操作' }), { detail: 1 });
  expect(screen.queryByRole('menuitem', { name: '插入待办提示' })).toBeNull();
  expect(screen.getByRole('menuitem', { name: '分享这个会话' })).toBeTruthy();
  view.rerender(<ChatComposerActions sessionId="target" active={false} canWrite />);
  expect(screen.queryByRole('menu')).toBeNull(); expect(screen.getByRole('button', { name: '更多会话操作' }).hasAttribute('disabled')).toBe(true);
});
it('supports keyboard navigation and dismisses on Escape and outside interaction', () => {
  mount(); const trigger = screen.getByRole('button', { name: '更多会话操作' }); trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '插入待办提示' }));
  fireEvent.keyDown(document.activeElement!, { key: 'End' });
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '分享这个会话' }));
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull(); expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger, { detail: 1 }); fireEvent.pointerDown(screen.getByLabelText('chat'));
  expect(screen.queryByRole('menu')).toBeNull();
});
it('allows local media preferences for a writable share without inheriting owner or collaboration actions', () => {
  const open = vi.fn();
  render(<section data-session-chat><SessionCapabilitiesContext.Provider value={sharedSessionCapabilities({ canWrite: true })}><ChatComposerActions sessionId="target" active canWrite onMediaSettings={open} /></SessionCapabilitiesContext.Provider></section>);
  fireEvent.click(screen.getByRole('button', { name: '更多会话操作' }));
  expect(screen.getAllByRole('menuitem')).toHaveLength(1);
  fireEvent.click(screen.getByRole('menuitem', { name: '媒体压缩设置' }));
  expect(open).toHaveBeenCalledOnce(); expect(actions.insert).not.toHaveBeenCalled();
});
it('keeps compression settings unavailable while a file is being processed', () => {
  const open = vi.fn();
  render(<section data-session-chat><ChatComposerActions sessionId="target" active canWrite onMediaSettings={open} mediaBusy /></section>);
  fireEvent.click(screen.getByRole('button', { name: '更多会话操作' }));
  const option = screen.getByRole('menuitem', { name: '媒体压缩设置' });
  expect(option.hasAttribute('disabled')).toBe(true); fireEvent.click(option); expect(open).not.toHaveBeenCalled();
});
