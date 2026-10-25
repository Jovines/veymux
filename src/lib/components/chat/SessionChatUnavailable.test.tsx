// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SessionChatView } from './SessionChatView';
import { clearChatSnapshots } from './chatSnapshot';
import { composeChatDraft } from './chatComposerContent';
import { readChatEditor } from './ChatRichEditor';

afterEach(() => { cleanup(); clearChatSnapshots(); sessionStorage.clear(); vi.unstubAllGlobals(); });

it('replaces unavailable chat controls with one actionable status and preserves the draft through recovery', async () => {
  let available = true;
  const terminal = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ agentAvailable: available, messages: [] })));
  const key = `termdock:chat:${location.origin}:unavailable-draft`;
  const files = [{ path: '/tmp/one.png', name: '截图.png', type: 'image/png', reference: '图片1' }];
  sessionStorage.setItem(`${key}:draft`, '请看【图片1】这里');
  sessionStorage.setItem(`${key}:extras`, composeChatDraft('请看【图片1】这里', files, []));
  render(<SessionChatView sessionId="unavailable-draft" onTerminal={terminal} />);
  await screen.findByText('想一起完成什么？');
  const editor = screen.getByRole('textbox');
  available = false;
  act(() => window.dispatchEvent(new Event('online')));
  await screen.findByRole('heading', { name: '当前对话暂不可用' });
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('button', { name: '发送消息' })).toBeNull();
  expect(screen.queryByRole('button', { name: '添加文件' })).toBeNull();
  expect(screen.queryByRole('button', { name: '提及协作成员' })).toBeNull();
  expect(screen.queryByText('想一起完成什么？')).toBeNull();
  expect(editor.getAttribute('contenteditable')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: '打开终端' }));
  expect(terminal).toHaveBeenCalledOnce();
  available = true;
  act(() => window.dispatchEvent(new Event('online')));
  await screen.findByText('想一起完成什么？');
  expect(screen.getByRole('textbox')).toBe(editor);
  expect(readChatEditor(editor).text).toBe('请看【图片1】这里');
  expect(screen.getByRole('button', { name: '移除附件 截图.png' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '当前对话暂不可用' })).toBeNull();
});

it('keeps conversation history and delivery recovery visible when chat becomes unavailable', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ agentAvailable: false, messages: [
    { id: 'retained-message', role: 'user', content: '保留这条消息', createdAt: 1, status: 'pending', delivery: { state: 'binding-required', canReconnect: true } },
  ] })));
  render(<SessionChatView sessionId="unavailable-history" onTerminal={() => {}} />);
  await screen.findByText('保留这条消息');
  expect(screen.getByRole('heading', { name: '当前对话暂不可用' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '重新连接' })).toBeTruthy();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('button', { name: '引用消息' })).toBeNull();
});
