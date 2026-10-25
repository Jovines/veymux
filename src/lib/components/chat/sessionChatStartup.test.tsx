// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SessionChatView } from './SessionChatView';
import { SessionChatStartupStatus } from './SessionChatStartupStatus';
import { beginSessionChatStartup, failSessionChatStartup, finishSessionChatStartup } from './sessionChatStartup';
import { readChatEditor } from './ChatRichEditor';
import { useTerminalStore } from '../../stores/useTerminalStore';
import { clearChatSnapshots } from './chatSnapshot';
const ids: string[] = [];
afterEach(() => { cleanup(); ids.splice(0).forEach(finishSessionChatStartup); useTerminalStore.getState().clearAllTerminalSessions(); clearChatSnapshots(); sessionStorage.clear(); vi.unstubAllGlobals(); });

it('keeps the same welcome and editor through stalled history, missing identity, terminal startup output, and readiness', async () => {
  const id = 'stable-chat-launch'; ids.push(id);
  beginSessionChatStartup(id, { slug: 'codex', displayName: 'Codex' });
  let complete!: (response: Response) => void, available = false, first = true;
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (first) { first = false; return new Promise<Response>(resolve => { complete = resolve; }); }
    return Response.json({ agentAvailable: available, agent: available ? { slug: 'codex', displayName: 'Codex' } : null, messages: [] });
  }));
  const view = render(<SessionChatView sessionId={id} onTerminal={() => {}} />);
  const welcome = screen.getByText('想一起完成什么？'), editor = screen.getByRole('textbox', { name: '给Codex的消息' });
  expect(view.container.querySelector('[data-chat-loading]')).toBeNull();
  expect(screen.getByText(/正在启动 Codex/)).toBeTruthy();
  editor.replaceChildren(document.createTextNode('先写下需求')); fireEvent.input(editor);
  expect(screen.getByRole('button', { name: '发送消息' })).toHaveProperty('disabled', true);
  await act(async () => complete(Response.json({ agentAvailable: false, messages: [] })));
  act(() => { const store = useTerminalStore.getState(); store.setTerminalSession(id, { sessionId: 'startup-backend', cols: 80, rows: 24 }); store.setTerminalOutputActivity(id, true); });
  expect(screen.queryByText('当前对话暂不可用。')).toBeNull();
  expect(view.container.querySelector('[data-chat-reply-feedback]')).toBeNull();
  expect(screen.getByRole('textbox')).toBe(editor);
  available = true; act(() => window.dispatchEvent(new Event('online')));
  await waitFor(() => expect(screen.getByRole('button', { name: '发送消息' })).toHaveProperty('disabled', false));
  expect(screen.getByText('想一起完成什么？')).toBe(welcome);
  expect(screen.getByRole('textbox', { name: '给Codex的消息' })).toBe(editor);
  expect(readChatEditor(editor).text).toBe('先写下需求');
  expect(view.container.querySelector('[data-chat-startup]')).toBeNull();
  expect(view.container.querySelector('[data-chat-reply-feedback]')).toBeNull();
});
it('keeps an actionable failure in the launch area without discarding the draft', async () => {
  const id = 'failed-chat-launch'; ids.push(id); beginSessionChatStartup(id, { displayName: 'Codex' });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ agentAvailable: false, messages: [] })));
  const terminal = vi.fn(); render(<SessionChatView sessionId={id} onTerminal={terminal} />);
  const editor = screen.getByRole('textbox'); editor.replaceChildren(document.createTextNode('保留草稿')); fireEvent.input(editor);
  act(() => failSessionChatStartup(id));
  await screen.findByText('启动命令未能发送，请打开终端检查后重试。');
  fireEvent.click(screen.getByRole('button', { name: '查看终端' })); expect(terminal).toHaveBeenCalledOnce();
  expect(readChatEditor(editor).text).toBe('保留草稿'); expect(screen.queryByText('当前对话暂不可用。')).toBeNull();
});
it('explains a slow launch without declaring the Agent available', () => {
  render(<SessionChatStartupStatus launch={{ agent: { displayName: 'Codex' }, startedAt: Date.now() - 20_000 }} interrupted={false} onTerminal={() => {}} />);
  expect(screen.getByText(/Codex 尚未就绪/)).toBeTruthy();
  expect(screen.getByRole('button', { name: '查看终端' })).toBeTruthy();
});
