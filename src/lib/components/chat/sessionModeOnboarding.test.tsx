// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TerminalModeHint } from './TerminalModeHint';
import { SessionModeWelcomeHint } from './SessionModeWelcomeHint';
import { ShareAccessContext } from '../../federation/ShareAccessContext';
import { useTerminalStore } from '../../stores/useTerminalStore';
import { getChatEligibility } from './chatModeEntry';
import { TERMINAL_MODE_HINT_KEY } from './sessionModeOnboarding';

vi.mock('./chatModeEntry', () => ({ getChatEligibility: vi.fn() }));
vi.mock('../../utils/touchTerminalLayout', () => ({ usesTouchTerminalLayout: () => false }));
vi.mock('../../hooks/useViewportKeyboardState', () => ({ useViewportKeyboardState: () => ({ isOpen: false }) }));
const eligibility = vi.mocked(getChatEligibility);
let anchors: HTMLDivElement;
function connected(id: string) { useTerminalStore.getState().setTerminalSession(id, { sessionId: `backend-${id}`, cols: 80, rows: 24 }); }
beforeEach(() => {
  localStorage.clear(); connected('one'); eligibility.mockReset(); eligibility.mockResolvedValue({ allowed: true, program: 'codex' });
  anchors = document.createElement('div');
  for (const id of ['one', 'two']) { const button = document.createElement('button'); button.dataset.sessionModeSwitch = id; button.textContent = '对话'; anchors.append(button); }
  document.body.append(anchors);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute('data-session-mode-switch')) return new DOMRect(900, 16, 64, 32);
    if (this.hasAttribute('data-terminal-mode-hint-bounds')) return new DOMRect(12, 12, 1000, 700);
    return new DOMRect(0, 0, 288, 80);
  });
});
afterEach(() => { cleanup(); anchors.remove(); useTerminalStore.getState().clearAllTerminalSessions(); localStorage.clear(); vi.restoreAllMocks(); });

it('shows only after readiness and verified eligibility, without changing terminal input focus', async () => {
  const view = render(<><textarea aria-label="terminal input" /><TerminalModeHint sessionId="one" active ready={false} /></>);
  const input = screen.getByRole('textbox'); input.focus();
  expect(eligibility).not.toHaveBeenCalled();
  view.rerender(<><textarea aria-label="terminal input" /><TerminalModeHint sessionId="one" active ready /></>);
  await screen.findByLabelText('会话模式说明');
  expect(document.activeElement).toBe(input);
  expect(JSON.parse(localStorage.getItem(TERMINAL_MODE_HINT_KEY)!)).toMatchObject({ version: 1 });
  fireEvent.input(input, { target: { value: 'keep typing' } });
  expect(screen.queryByLabelText('会话模式说明')).toBeNull();
  expect(document.activeElement).toBe(input);
  expect(JSON.parse(localStorage.getItem(TERMINAL_MODE_HINT_KEY)!)).toMatchObject({ resolution: 'interrupted' });
});

it('does not insert a late hint after typing starts during an eligibility request', async () => {
  let release!: (value: { allowed: boolean; program: string }) => void;
  eligibility.mockReturnValue(new Promise(resolve => { release = resolve; }));
  render(<><textarea /><TerminalModeHint sessionId="one" active ready /></>);
  fireEvent.compositionStart(screen.getByRole('textbox'));
  await act(async () => { release({ allowed: true, program: 'codex' }); });
  expect(screen.queryByLabelText('会话模式说明')).toBeNull();
  expect(localStorage.getItem(TERMINAL_MODE_HINT_KEY)).toBeNull();
});

it('remembers dismissal across sessions without suppressing the chat empty-state action', async () => {
  const view = render(<TerminalModeHint sessionId="one" active ready />);
  await screen.findByLabelText('会话模式说明');
  fireEvent.click(screen.getByRole('button', { name: '关闭会话模式说明' }));
  view.unmount(); connected('two');
  const terminal = vi.fn();
  render(<><TerminalModeHint sessionId="two" active ready /><SessionModeWelcomeHint onTerminal={terminal} /></>);
  expect(screen.queryByLabelText('会话模式说明')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '切换到终端' }));
  expect(terminal).toHaveBeenCalledOnce();
  expect(eligibility).toHaveBeenCalledOnce();
});

it('claims only one hint when two active hosts share the same client', async () => {
  connected('two');
  render(<><TerminalModeHint sessionId="one" active ready /><TerminalModeHint sessionId="two" active ready /></>);
  await screen.findByLabelText('会话模式说明');
  expect(screen.getAllByLabelText('会话模式说明')).toHaveLength(1);
});

it('rejects stale eligibility after changing sessions and does not consume the next safe entry', async () => {
  let release!: (value: { allowed: boolean; program: string }) => void;
  eligibility.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  const view = render(<TerminalModeHint sessionId="one" active ready />);
  connected('two'); eligibility.mockResolvedValue({ allowed: false, program: 'zsh' });
  view.rerender(<TerminalModeHint sessionId="two" active ready />);
  await act(async () => { release({ allowed: true, program: 'codex' }); });
  expect(screen.queryByLabelText('会话模式说明')).toBeNull();
  expect(localStorage.getItem(TERMINAL_MODE_HINT_KEY)).toBeNull();
});

it('does not query eligibility or show owner guidance for inactive, disconnected or ungranted shared sessions', () => {
  render(<><TerminalModeHint sessionId="one" active={false} ready /><TerminalModeHint sessionId="missing" active ready /><ShareAccessContext.Provider value={{}}><TerminalModeHint sessionId="one" active ready /><SessionModeWelcomeHint onTerminal={vi.fn()} /></ShareAccessContext.Provider></>);
  expect(eligibility).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('会话模式说明')).toBeNull();
  expect(screen.queryByRole('button', { name: '切换到终端' })).toBeNull();
});

it('does not consume or show a floating hint when its navigation entry is absent', () => {
  anchors.replaceChildren();
  render(<TerminalModeHint sessionId="one" active ready />);
  expect(eligibility).not.toHaveBeenCalled();
  expect(localStorage.getItem(TERMINAL_MODE_HINT_KEY)).toBeNull();
  expect(screen.queryByLabelText('会话模式说明')).toBeNull();
});

it('closes with Escape from the bubble and restores only its own keyboard focus to the entry', async () => {
  render(<TerminalModeHint sessionId="one" active ready />);
  const close = await screen.findByRole('button', { name: '关闭会话模式说明' });
  close.focus(); fireEvent.keyDown(close, { key: 'Escape' });
  expect(screen.queryByLabelText('会话模式说明')).toBeNull();
  expect(document.activeElement).toBe(anchors.firstElementChild);
});

it.each(['shell', 'offline'])('does not show or consume guidance for %s', async kind => {
  if (kind === 'shell') eligibility.mockResolvedValue({ allowed: false, program: 'zsh' });
  else eligibility.mockRejectedValue(new TypeError('offline'));
  render(<TerminalModeHint sessionId="one" active ready />);
  await waitFor(() => expect(eligibility).toHaveBeenCalledOnce());
  await act(async () => {});
  expect(screen.queryByLabelText('会话模式说明')).toBeNull();
  expect(localStorage.getItem(TERMINAL_MODE_HINT_KEY)).toBeNull();
});

it('closes on another tab exposure and does not reappear after reconnecting', async () => {
  render(<TerminalModeHint sessionId="one" active ready />);
  await screen.findByLabelText('会话模式说明');
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: TERMINAL_MODE_HINT_KEY })));
  expect(screen.queryByLabelText('会话模式说明')).toBeNull();
  act(() => { useTerminalStore.getState().setConnecting('one', true); });
  act(() => { useTerminalStore.getState().setConnecting('one', false); });
  expect(screen.queryByLabelText('会话模式说明')).toBeNull();
});

it('deduplicates in memory when reads work but persistent writes are blocked', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
  const view = render(<TerminalModeHint sessionId="one" active ready />);
  await screen.findByLabelText('会话模式说明');
  fireEvent.click(screen.getByRole('button', { name: '关闭会话模式说明' }));
  view.unmount(); connected('two'); render(<TerminalModeHint sessionId="two" active ready />);
  expect(screen.queryByLabelText('会话模式说明')).toBeNull();
});
