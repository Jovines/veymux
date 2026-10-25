// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SessionModeSwitch } from './SessionModeSwitch';
import { SessionViewActions } from './SessionViewActions';
import { inheritedAgentViewMode } from './chatModeEntry';
import { initializeSessionViewMode, readSessionViewMode, useSessionViewMode } from './sessionViewMode';
import { resetCsrfTokenCache } from '../../terminal/api';
import { saveAgentCommand } from '../../terminal/launchCommands';
import { ShareAccessContext } from '../../federation/ShareAccessContext';
import { useTerminalStore } from '../../stores/useTerminalStore';

const connection = vi.hoisted(() => ({ client: { closed: false } }));
vi.mock('../../federation/browserIntegration', () => ({ currentSecureClient: () => connection.client, savedConnection: () => undefined }));
let allowed = false, mode: string | null = null, fail = false;
let config = { genericProgramNames: ['node'], wrapperScriptNames: ['npx'], shellNames: ['zsh'], agentCommands: { cc: 'claude' }, chatProgramNames: [] as string[] };
beforeEach(() => {
  allowed = false; mode = null; fail = false; config = { ...config, chatProgramNames: [] }; resetCsrfTokenCache();
  vi.stubGlobal('fetch', vi.fn(async (url, init?: RequestInit) => {
    if (fail) throw new TypeError('offline');
    if (String(url).includes('/view-mode')) {
      if (init?.body) mode = JSON.parse(String(init.body)).mode;
      return Response.json({ mode, chatEligibility: { allowed: allowed || config.chatProgramNames.includes('my-agent'), program: 'my-agent' } });
    }
    if (String(url).includes('csrf-token')) return Response.json({ csrfToken: 'csrf' });
    if (String(url).includes('program-detection')) {
      if (init?.body) config = JSON.parse(String(init.body));
      return Response.json(config);
    }
    throw new Error(`Unexpected URL ${url}`);
  }));
});
afterEach(() => { cleanup(); localStorage.clear(); useTerminalStore.getState().clearAllTerminalSessions(); vi.unstubAllGlobals(); });

it('points chat unread messages at both mode entries without clearing them on toggle', async () => {
  allowed = true; mode = 'terminal';
  const store = useTerminalStore.getState();
  store.setSessionChatIndex('unread-entry', { conversationId: 'conversation', messageIds: ['a', 'b'], viewedMessageIds: [] });
  render(<><SessionModeSwitch sessionId="unread-entry" share={false} /><SessionViewActions sessionId="unread-entry" onDone={() => {}} /></>);
  const toggle = await screen.findByRole('button', { name: '切换到对话，2 条未读消息' });
  expect(screen.getByRole('button', { name: '普通对话，2 条未读消息' })).toBeTruthy();
  fireEvent.click(toggle);
  await screen.findByRole('button', { name: '切换到终端' });
  expect(useTerminalStore.getState().sessions.get('unread-entry')?.chatAttention?.unreadIds).toEqual(['a', 'b']);
  act(() => store.setSessionChatIndex('unread-entry', { conversationId: 'conversation', messageIds: ['a', 'b'], viewedMessageIds: ['a'] }));
  expect(screen.getByRole('button', { name: '普通对话，1 条未读消息' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '切换到终端' }));
  await screen.findByRole('button', { name: '切换到对话，1 条未读消息' });
  act(() => store.setSessionChatIndex('unread-entry', { conversationId: 'conversation', messageIds: ['a', 'b'], viewedMessageIds: ['a', 'b'] }));
  expect(screen.getByRole('button', { name: '切换到对话' })).toBeTruthy();
  expect(document.querySelector('[data-chat-unread-count]')).toBeNull();
});

it('bounds the visible unread count and switches its source with the selected session', async () => {
  allowed = true; mode = 'terminal';
  useTerminalStore.getState().setSessionChatIndex('many-unread', { conversationId: 'many', messageIds: Array.from({ length: 120 }, (_, i) => `reply-${i}`), viewedMessageIds: [] });
  const view = render(<SessionModeSwitch sessionId="many-unread" compact share={false} />);
  await screen.findByRole('button', { name: '切换到对话，120 条未读消息' });
  expect(screen.getByText('99+')).toBeTruthy();
  view.rerender(<SessionModeSwitch sessionId="no-unread" compact share={false} />);
  await screen.findByRole('button', { name: '切换到对话' });
  expect(document.querySelector('[data-chat-unread-count]')).toBeNull();
});

it('keeps the unknown program in terminal, cancels without mutations, then saves inline and enters chat', async () => {
  render(<SessionModeSwitch sessionId="unknown-agent" />);
  fireEvent.click(screen.getByRole('button', { name: '切换到对话' }));
  await screen.findByRole('dialog', { name: '配置 Agent 程序识别' });
  expect(screen.getByRole('textbox', { name: '程序名' })).toHaveProperty('value', 'my-agent');
  expect(mode).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(config.chatProgramNames).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: '切换到对话' }));
  await screen.findByRole('dialog');
  fireEvent.change(screen.getByRole('textbox', { name: '程序名' }), { target: { value: 'node' } });
  fireEvent.click(screen.getByRole('button', { name: '保存并进入对话' }));
  await screen.findByText(/不要填写路径/);
  expect(config.chatProgramNames).toEqual([]);
  fireEvent.change(screen.getByRole('textbox', { name: '程序名' }), { target: { value: 'my-agent' } });
  await waitFor(() => expect(screen.getByRole('button', { name: '保存并进入对话' })).toHaveProperty('disabled', false));
  fireEvent.click(screen.getByRole('button', { name: '保存并进入对话' }));
  await screen.findByRole('button', { name: '切换到终端' });
  expect(config.agentCommands).toEqual({ cc: 'claude' }); expect(config.chatProgramNames).toEqual(['my-agent']);
  await waitFor(() => expect(mode).toBe('chat'));
});
it('checks the menu entry and closes the menu only after successful recognition', async () => {
  const done = vi.fn(); render(<SessionViewActions sessionId="menu-check" onDone={done} />);
  fireEvent.click(screen.getByRole('button', { name: '普通对话' })); await screen.findByRole('dialog');
  expect(done).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  allowed = true; fireEvent.click(screen.getByRole('button', { name: '普通对话' }));
  await waitFor(() => expect(done).toHaveBeenCalledOnce());
});
it('does not expose service configuration to a shared session', async () => {
  render(<ShareAccessContext.Provider value={{}}><SessionModeSwitch sessionId="shared-check" /></ShareAccessContext.Provider>);
  fireEvent.click(screen.getByRole('button', { name: '切换到对话' })); await screen.findByRole('dialog');
  expect(screen.queryByRole('textbox')).toBeNull(); expect(screen.queryByRole('button', { name: '保存并进入对话' })).toBeNull();
});
it('recognizes an explicitly configured Agent wrapper when entering from an existing terminal', async () => {
  saveAgentCommand('codex', 'codex', { name: 'My agent', command: 'my-agent --fast' });
  render(<SessionModeSwitch sessionId="configured-existing" />);
  fireEvent.click(screen.getByRole('button', { name: '切换到对话' }));
  await screen.findByRole('button', { name: '切换到终端' });
  expect(screen.queryByRole('dialog')).toBeNull(); expect(config.chatProgramNames).toEqual(['my-agent']);
});
it('keeps the terminal on connection failure and never writes the mode', async () => {
  fail = true; render(<SessionModeSwitch sessionId="offline-check" />);
  fireEvent.click(screen.getByRole('button', { name: '切换到对话' })); await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: '切换到对话' })).toBeTruthy(); expect(mode).toBeNull();
});
it('discards a recognition response after the session changes', async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn((url) => String(url).includes('chatEligibility') ? new Promise<Response>(resolve => { finish = resolve; }) : Promise.resolve(Response.json({ mode: null }))));
  const view = render(<SessionModeSwitch sessionId="previous-check" />);
  fireEvent.click(screen.getByRole('button', { name: '切换到对话' }));
  view.rerender(<SessionModeSwitch sessionId="next-check" />);
  await act(async () => finish(Response.json({ chatEligibility: { allowed: true } })));
  expect(readSessionViewMode('next-check')).toBe('terminal');
});
it('inherits only Agent launches, and reads the inherited mode on the first workspace render', async () => {
  allowed = true;
  expect(await inheritedAgentViewMode('source', 'chat', 'codex')).toBe('chat');
  expect(await inheritedAgentViewMode('source', 'terminal', 'codex')).toBe('terminal');
  expect(await inheritedAgentViewMode('source', 'chat')).toBe('terminal');
  allowed = false;
  expect(await inheritedAgentViewMode('source', 'chat', 'vim')).toBe('terminal');
  saveAgentCommand('codex', 'codex', { name: 'My wrapper', command: 'my-agent --model fast' });
  expect(await inheritedAgentViewMode('source', 'chat', 'my-agent --model fast')).toBe('chat');
  expect(config.chatProgramNames).toEqual(['my-agent']);
  act(() => initializeSessionViewMode('inherited-check', 'chat'));
  const first = renderHook(() => useSessionViewMode('inherited-check'));
  expect(first.result.current[0]).toBe('chat');
  await waitFor(() => expect(mode).toBe('chat'));
});

it('shares the visible split from the primary navigation without broadening its Session scope', () => {
  const receive = vi.fn(); window.addEventListener('termdock:open-services', receive);
  try {
    render(<SessionModeSwitch sessionId="first" shareSessionIds={['first', 'second']} />);
    fireEvent.click(screen.getByRole('button', { name: '分享此分屏' }));
    expect((receive.mock.calls[0][0] as CustomEvent).detail).toEqual({ inviteSessionIds: ['first', 'second'], viewMode: 'terminal', viewLayout: 'split' });
  } finally { window.removeEventListener('termdock:open-services', receive); }
});
it('does not expose the primary share shortcut to an explicitly shared Session', () => {
  render(<ShareAccessContext.Provider value={{}}><SessionModeSwitch sessionId="guest-share" /></ShareAccessContext.Provider>);
  expect(screen.queryByRole('button', { name: '分享这个会话' })).toBeNull();
});
