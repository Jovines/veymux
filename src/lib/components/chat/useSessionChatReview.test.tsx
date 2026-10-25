// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { useSessionChatReview } from './useSessionChatReview';
import { useTerminalStore } from '../../stores/useTerminalStore';
const state = vi.hoisted(() => ({ acknowledge: vi.fn(), workspaceActive: true, desktop: false }));
vi.mock('../../terminal/api', () => ({ sendAgentReviewAck: state.acknowledge }));
vi.mock('../../services/workspaceHost', () => ({ isWorkspaceActive: () => state.workspaceActive, WORKSPACE_VISIBILITY_EVENT: 'termdock:workspace-visibility' }));
vi.mock('../../desktop/nativeBridge', () => ({ getTermdockDesktopBridge: () => state.desktop ? {} : null }));
function Chat({ active = true, ready = true, hidden = false }) {
  const ref = useRef<HTMLElement>(null);
  useSessionChatReview('chat-review', active && ready, ref);
  return <section ref={ref} hidden={hidden}>conversation</section>;
}
function completion() {
  const store = useTerminalStore.getState();
  store.setTerminalSession('chat-review', { sessionId: 'backend-chat', cols: 80, rows: 24 });
  store.setSessionTuiProgress('chat-review', { source: 'osc7501', state: 'done', progress: null, app: 'any-agent' });
  store.setSessionAgentStatus('chat-review', { agentStatus: 'done', reviewed: false });
}
const session = () => useTerminalStore.getState().sessions.get('chat-review')!;
afterEach(() => { cleanup(); useTerminalStore.getState().clearAllTerminalSessions(); state.acknowledge.mockClear(); state.workspaceActive = true; state.desktop = false; vi.restoreAllMocks(); });
it('clears both native and hook attention on entering a loaded chat, once', () => {
  completion(); render(<Chat />);
  expect(session()).toMatchObject({ agentNeedsReview: false, tuiProgress: { state: 'done', reviewed: true } });
  expect(state.acknowledge).toHaveBeenCalledExactlyOnceWith('backend-chat');
});
it('acknowledges later completion while visible and retains completion in an inactive chat', () => {
  const view = render(<Chat />);
  act(completion); expect(session().agentNeedsReview).toBe(false);
  view.rerender(<Chat active={false} />);
  act(completion); expect(session().agentNeedsReview).toBe(true);
  expect(session().tuiProgress?.reviewed).not.toBe(true);
  view.rerender(<Chat />); expect(session().agentNeedsReview).toBe(false);
});
it('waits for chat history instead of clearing attention behind a loading screen', () => {
  completion(); const view = render(<Chat ready={false} />);
  expect(state.acknowledge).not.toHaveBeenCalled();
  view.rerender(<Chat />); expect(state.acknowledge).toHaveBeenCalledOnce();
});
it('retains attention in a background document until it becomes visible', () => {
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  completion(); render(<Chat />); expect(state.acknowledge).not.toHaveBeenCalled();
  hidden.mockReturnValue(false); act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(session().agentNeedsReview).toBe(false);
});
it('retains attention in a retained service workspace until activation', () => {
  state.workspaceActive = false; completion(); render(<Chat />);
  expect(state.acknowledge).not.toHaveBeenCalled();
  state.workspaceActive = true; act(() => window.dispatchEvent(new Event('termdock:workspace-visibility')));
  expect(session().agentNeedsReview).toBe(false);
});
it('does not acknowledge hidden chat DOM or an unfocused desktop window', () => {
  completion(); const view = render(<Chat hidden />);
  expect(state.acknowledge).not.toHaveBeenCalled();
  state.desktop = true; const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  view.rerender(<Chat ready={false} />); view.rerender(<Chat />);
  expect(state.acknowledge).not.toHaveBeenCalled();
  focus.mockReturnValue(true); act(() => window.dispatchEvent(new Event('focus')));
  expect(state.acknowledge).toHaveBeenCalledOnce();
});
it('never dismisses a question or invents a working-to-done transition', () => {
  const store = useTerminalStore.getState();
  store.setTerminalSession('chat-review', { sessionId: 'backend-chat', cols: 80, rows: 24 });
  store.setSessionTuiProgress('chat-review', { source: 'osc7501', state: 'blocked', progress: null });
  store.setSessionAgentStatus('chat-review', { agentStatus: 'waiting', reviewed: true });
  render(<Chat />);
  expect(state.acknowledge).not.toHaveBeenCalled();
  expect(session()).toMatchObject({ agentStatus: 'waiting', tuiProgress: { state: 'blocked' } });
});
