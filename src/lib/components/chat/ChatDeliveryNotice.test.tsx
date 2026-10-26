// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatDeliveryNotice } from './ChatDeliveryNotice';
import type { ChatMessage } from './chatMessages';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const message: ChatMessage = { id: 'pending', role: 'user', content: '检查构建', status: 'pending', createdAt: 1, delivery: { state: 'binding-required', canReconnect: true } };
it('explains failed input detection and offers owner recovery after checking and clearing the terminal', async () => {
  const request = vi.fn(async () => Response.json({ ok: true })); vi.stubGlobal('fetch', request);
  render(<ChatDeliveryNotice message={{ ...message, delivery: { state: 'outcome-unknown', inputCheckFailed: true, attemptCount: 2 } }} sessionId="original" canWrite onTerminal={() => {}} onRecovered={() => {}} />);
  expect(screen.getByText('发送待确认')).toBeTruthy();
  expect(screen.queryByText(/终端输入检测未通过/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '详情' }));
  expect(screen.getByText(/终端输入检测未通过/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: '重新连接' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await act(async () => {});
  expect(request).toHaveBeenCalledWith('/api/terminal/original/chat/pending/delivery', expect.objectContaining({ body: JSON.stringify({ action: 'retry', attempt: 2 }) }));
});
it('offers immediate retry for an input check that ended safely before writing the message', async () => {
  const request = vi.fn(async () => Response.json({ ok: true })); vi.stubGlobal('fetch', request);
  render(<ChatDeliveryNotice message={{ ...message, delivery: { state: 'retrying', inputCheckFailed: true, attemptCount: 6 } }} sessionId="original" canWrite onTerminal={() => {}} onRecovered={() => {}} />);
  expect(screen.getByText('暂未发送')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重试' })); await act(async () => {});
  expect(request).toHaveBeenCalledWith('/api/terminal/original/chat/pending/delivery', expect.objectContaining({ body: JSON.stringify({ action: 'retry', attempt: 6 }) }));
});
it('retries an initial route failure and refreshes a stale decision without sending another request', async () => {
  const request = vi.fn(async () => Response.json({}, { status: 409 })), recovered = vi.fn(); vi.stubGlobal('fetch', request);
  render(<ChatDeliveryNotice message={{ ...message, delivery: { state: 'retrying', canRetry: true, attemptCount: 0 } }} sessionId="original" canWrite onTerminal={() => {}} onRecovered={recovered} />);
  fireEvent.click(screen.getByRole('button', { name: '重试' })); await act(async () => {});
  expect(request).toHaveBeenCalledExactlyOnceWith('/api/terminal/original/chat/pending/delivery', expect.objectContaining({ body: JSON.stringify({ action: 'retry', attempt: 0 }) }));
  expect(recovered).toHaveBeenCalledOnce();expect(screen.getByRole('alert').textContent).toContain('状态已变化');
});
it('restores manual retry for an earlier non-chat message blocking this chat, and clears the notice after recovery', async () => {
  const request = vi.fn(async () => Response.json({ ok: true })), recovered = vi.fn(); vi.stubGlobal('fetch', request);
  const queued: ChatMessage = { ...message, delivery: { state: 'retrying', inputCheckFailed: true,
    blockedBy: { messageId: 'blocking-reply', attemptCount: 2 } } };
  const view = render(<ChatDeliveryNotice message={queued} sessionId="original" canWrite onTerminal={() => {}} onRecovered={recovered} />);
  expect(screen.queryByText(/前一条投递未确认/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await act(async () => {});
  expect(request).toHaveBeenCalledExactlyOnceWith('/api/terminal/original/chat/pending/delivery', expect.objectContaining({ method: 'POST',
    body: JSON.stringify({ action: 'retry', attempt: 2, blockingMessageId: 'blocking-reply' }) }));
  expect(recovered).toHaveBeenCalledOnce();
  view.rerender(<ChatDeliveryNotice message={{ ...queued, status: 'delivered', delivery: undefined }} sessionId="original" canWrite onTerminal={() => {}} onRecovered={recovered} />);
  expect(view.container.querySelector('[data-chat-delivery-notice]')).toBeNull();
});
it('recovers within the page, retains failed messages and never asks the user to run a command', async () => {
  const recovered = vi.fn(), terminal = vi.fn();
  const request = vi.fn().mockResolvedValueOnce(Response.json({}, { status: 409 })).mockResolvedValueOnce(Response.json({ ok: true }));
  vi.stubGlobal('fetch', request);
  render(<ChatDeliveryNotice message={message} sessionId="original" canWrite onTerminal={terminal} onRecovered={recovered} />);
  expect(screen.queryByText(/复制命令|td collab|运行以下命令/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新连接' }));
  await screen.findByRole('alert'); expect(recovered).not.toHaveBeenCalled(); expect(message.status).toBe('pending');
  fireEvent.click(screen.getByRole('button', { name: '重新连接' }));
  await act(async () => {}); expect(recovered).toHaveBeenCalledOnce();
  expect(request).toHaveBeenLastCalledWith('/api/terminal/original/chat/recover', expect.objectContaining({ method: 'POST', body: '{}' }));
  expect(request.mock.calls.every(([url]) => String(url).endsWith('/chat/recover'))).toBe(true);
});
it('does not recover a read-only share or an uncertain earlier write', () => {
  const recovered = vi.fn();
  const view = render(<ChatDeliveryNotice message={message} sessionId="original" canWrite={false} onTerminal={() => {}} onRecovered={recovered} />);
  expect(screen.queryByRole('button', { name: '重新连接' })).toBeNull();
  view.rerender(<ChatDeliveryNotice message={{ ...message, delivery: { state: 'outcome-unknown' } }} sessionId="original" canWrite onTerminal={() => {}} onRecovered={recovered} />);
  expect(screen.queryByRole('button', { name: '重新连接' })).toBeNull();
  expect(screen.getByText(/已暂停自动重试/)).toBeTruthy();
});
it('discards a delayed recovery response after switching sessions', async () => {
  let respond!: (response: Response) => void;
  const request = vi.fn(() => new Promise<Response>(resolve => { respond = resolve; })), recovered = vi.fn();
  vi.stubGlobal('fetch', request);
  const view = render(<ChatDeliveryNotice message={message} sessionId="original" canWrite onTerminal={() => {}} onRecovered={recovered} />);
  fireEvent.click(screen.getByRole('button', { name: '重新连接' }));
  view.rerender(<ChatDeliveryNotice message={message} sessionId="another" canWrite onTerminal={() => {}} onRecovered={recovered} />);
  await act(async () => { respond(Response.json({ ok: true })); });
  expect(recovered).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: '重新连接' })).toHaveProperty('disabled', false);
});
it('resolves uncertainty only after an explicit in-page decision tied to the observed attempt', async () => {
  const request = vi.fn(async () => Response.json({ ok: true })), recovered = vi.fn(); vi.stubGlobal('fetch', request);
  render(<ChatDeliveryNotice message={{ ...message, delivery: { state: 'outcome-unknown', attemptCount: 3 } }} sessionId="original" canWrite onTerminal={() => {}} onRecovered={recovered} />);
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '确认未发送，重新投递' }));
  await act(async () => {});
  expect(request).toHaveBeenCalledExactlyOnceWith('/api/terminal/original/chat/pending/delivery', expect.objectContaining({ method: 'POST', body: JSON.stringify({ action: 'retry', attempt: 3 }) }));
  expect(recovered).toHaveBeenCalledOnce();
});
