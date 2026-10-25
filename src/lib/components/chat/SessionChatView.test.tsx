// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { clearChatSnapshots } from './chatSnapshot';
import { AppFeedbackHost } from '../ui/AppFeedback';
import { SECURE_READY_EVENT } from '../../federation/connectionRecovery';
import { readChatEditor, setChatEditorCaret } from './ChatRichEditor';
const markdownRender = vi.hoisted(() => vi.fn());
import type { ChatMessage } from './chatMessages';
import { SessionChatView } from './SessionChatView';
import { useTerminalStore } from '../../stores/useTerminalStore';
function liveOutput(id: string) { act(() => { const store = useTerminalStore.getState(); store.setTerminalSession(id, { sessionId: `backend-${id}`, cols: 80, rows: 24 }); store.setTerminalOutputActivity(id, true); }); }
vi.mock('../markdown/Markdown', () => ({ Markdown: ({ content }: { content: string }) => { markdownRender(content); return <p data-testid="chat-markdown">{content}</p>; } }));
afterEach(() => { cleanup(); useTerminalStore.getState().clearAllTerminalSessions(); clearChatSnapshots(); sessionStorage.clear(); markdownRender.mockClear(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function composer() { return screen.getByRole('textbox') as HTMLElement; }
function composerText() { return readChatEditor(composer()).text; }
function setComposer(value: string, caret = value.length) { const node = composer(); node.replaceChildren(document.createTextNode(value)); setChatEditorCaret(node, caret); fireEvent.input(node); }
function selectComposer(start: number, end: number) { const node = composer(), text = node.firstChild!; const range = document.createRange(); range.setStart(text, start); range.setEnd(text, end); const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range); }
function pagedHistory(url: unknown, all: ChatMessage[]) {
  const params = new URL(String(url), location.origin).searchParams;
  const before = params.get('before'), after = params.get('after');
  const at = all.findIndex(message => message.id === (before || after));
  const end = before ? at : after ? Math.min(all.length, at + 31) : all.length;
  const start = after ? at + 1 : Math.max(0, end - 30);
  return Response.json({ agentAvailable: true, messages: all.slice(start, end), updates: after ? all.slice(Math.max(0, at - 29), at + 1) : undefined, page: { hasOlder: start > 0, hasNewer: end < all.length, mode: before ? 'before' : after ? 'after' : 'latest' } });
}

it('shows blocked delivery with an actionable terminal entry and clears it after a real write', async () => {
  const terminal = vi.fn();
  const message: ChatMessage = { id: 'blocked', role: 'user', content: '检查构建结果', createdAt: 1, status: 'pending', delivery: { state: 'binding-required', canReconnect: true } };
  const requests = vi.fn(async (_url: unknown, _init?: RequestInit) => Response.json({ agentAvailable: true, messages: [message] }));
  vi.stubGlobal('fetch', requests);
  render(<SessionChatView sessionId="blocked-delivery" onTerminal={terminal} />);
  await screen.findByText('等待恢复');
  expect(screen.queryByText('已发送')).toBeNull();
  expect(screen.getByText('终端连接已变化，消息尚未投递。')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '查看终端' }));
  expect(terminal).toHaveBeenCalledOnce();
  expect(requests.mock.calls.every(call => !call[1]?.method)).toBe(true);
  message.status = 'delivered'; delete message.delivery;
  fireEvent(window, new Event('online'));
  await screen.findByText('已发送');
  expect(screen.queryByText('终端连接已变化，消息尚未投递。')).toBeNull();
});

it('presents its loading UI without waiting for a hidden terminal or stalled history request', () => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  const ready = vi.fn();
  const view = render(<SessionChatView sessionId="startup-history" onReadyChange={ready} onTerminal={() => {}} />);
  expect(screen.getByRole('textbox')).toBeTruthy();
  expect(ready).toHaveBeenLastCalledWith(true);
  view.unmount();
  expect(ready).toHaveBeenLastCalledWith(false);
});

it('loads and refreshes a visible unfocused pane but pauses when it is offscreen', async () => {
  let revision = 1;
  const requests = vi.fn(async () => Response.json({ agentAvailable: true,
    messages: [{ id: 'visible-reply', role: 'assistant', content: `visible history ${revision}`, createdAt: 1, status: 'stored' }] }));
  vi.stubGlobal('fetch', requests);
  const view = render(<SessionChatView sessionId="visible-unfocused" active={false} visible onTerminal={() => {}} />);
  await screen.findByText('visible history 1');
  expect(document.activeElement).not.toBe(composer());
  revision = 2;
  act(() => window.dispatchEvent(new Event('online')));
  await screen.findByText('visible history 2');
  view.rerender(<SessionChatView sessionId="visible-unfocused" active={false} visible={false} onTerminal={() => {}} />);
  const count = requests.mock.calls.length;
  act(() => window.dispatchEvent(new Event('online')));
  expect(requests).toHaveBeenCalledTimes(count);
  revision = 3;
  view.rerender(<SessionChatView sessionId="visible-unfocused" active={false} visible onTerminal={() => {}} />);
  await screen.findByText('visible history 3');
});

it('dismisses the selection toolbar outside the conversation or after clearing, and supports spanning messages', async () => {
  const messages = ['第一条消息', '第二条消息'].map((content, index) => ({ id: `a${index}`, role: 'assistant', content, createdAt: index + 1, status: 'stored' }));
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ agentAvailable: true, messages })));
  render(<><SessionChatView sessionId="selection" onTerminal={() => {}} /><p>会话外的文字</p></>);
  // A real Selection must target the loaded renderer, not a Suspense fallback
  // text node that can be detached as the lazy Markdown module resolves.
  await waitFor(() => expect(screen.getAllByTestId('chat-markdown')).toHaveLength(2));
  const first = screen.getByText('第一条消息'), second = screen.getByText('第二条消息'), outside = screen.getByText('会话外的文字');
  const selection = window.getSelection()!;
  const select = (element: Element) => act(() => {
    const range = document.createRange(); range.selectNodeContents(element);
    selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange'));
  });
  const toolbar = () => screen.queryByRole('button', { name: '引用选中内容' });
  select(first); expect(toolbar()).toBeTruthy();
  act(() => { selection.collapseToEnd(); document.dispatchEvent(new Event('selectionchange')); });
  expect(toolbar()).toBeNull();
  select(first);
  act(() => { selection.removeAllRanges(); document.dispatchEvent(new Event('selectionchange')); });
  expect(toolbar()).toBeNull();
  select(first); select(outside); expect(toolbar()).toBeNull();
  select(first);
  act(() => {
    const range = document.createRange(); range.setStart(first.firstChild!, 0); range.setEnd(second.firstChild!, 2);
    selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange'));
  });
  expect(toolbar()).toBeTruthy();
  act(() => selection.removeAllRanges());
});
it('quotes partial consecutive replies and another speaker in order without message actions or unrelated text', async () => {
  const messages = [
    { id: 'first', role: 'assistant', content: '忽略前缀，第一段需要引用', createdAt: 1, status: 'stored' },
    { id: 'second', role: 'assistant', content: '中间完整回复', createdAt: 2, status: 'stored' },
    { id: 'third', role: 'user', content: '用户补充看这里，忽略尾部', createdAt: 3, status: 'stored' },
  ];
  const posts: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url, init?: RequestInit) => {
    if (init?.method === 'POST') { posts.push(JSON.parse(String(init.body)).content); return Response.json({ id: 'sent', createdAt: 4, status: 'pending' }); }
    return Response.json({ agentAvailable: true, agent: { displayName: 'Codex' }, messages });
  }));
  render(<SessionChatView sessionId="multiple-selected-quotes" onTerminal={() => {}} />);
  await screen.findByText('中间完整回复');
  setComposer('解释这几段');
  const first = screen.getByText(messages[0].content).firstChild!, last = screen.getByText(messages[2].content).firstChild!;
  act(() => {
    const range = document.createRange(); range.setStart(first, '忽略前缀，'.length); range.setEnd(last, '用户补充看这里'.length);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range); document.dispatchEvent(new Event('selectionchange'));
  });
  fireEvent.click(screen.getByRole('button', { name: '引用选中内容' }));
  expect(composerText()).toBe('解释这几段');
  const quote = document.querySelector('.session-chat-composer blockquote')!.textContent!;
  expect(quote).toContain('第一段需要引用'); expect(quote).toContain('中间完整回复'); expect(quote).toContain('用户补充看这里');
  expect(quote).toContain('Codex'); expect(quote).toContain('用户');
  expect(quote).not.toContain('忽略前缀'); expect(quote).not.toContain('忽略尾部'); expect(quote).not.toContain('已发送');
  expect(quote.indexOf('第一段需要引用')).toBeLessThan(quote.indexOf('中间完整回复'));
  expect(quote.indexOf('中间完整回复')).toBeLessThan(quote.indexOf('用户补充看这里'));
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toContain('> 对话摘录'); expect(posts[0]).toContain('解释这几段');
});
it('keeps an explicitly added quote in the composer after its text selection is cleared', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ agentAvailable: true, messages: [{ id: 'a', role: 'assistant', content: '需要引用的原话', createdAt: 1, status: 'stored' }] })));
  render(<SessionChatView sessionId="selected-quote" onTerminal={() => {}} />);
  const text = await screen.findByTestId('chat-markdown');
  setComposer('请解释这一句');
  act(() => {
    const range = document.createRange(); range.selectNodeContents(text);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range); document.dispatchEvent(new Event('selectionchange'));
  });
  const quote = screen.getByRole('button', { name: '引用选中内容' });
  fireEvent.pointerDown(quote); fireEvent.click(quote);
  act(() => document.dispatchEvent(new Event('selectionchange')));
  expect(screen.queryByRole('button', { name: '引用选中内容' })).toBeNull();
  expect(screen.getByRole('button', { name: '移除消息引用' })).toBeTruthy();
  expect(composerText()).toBe('请解释这一句');
});
it('retains a failed message across remounts and restores it for editing', async () => {
  const posts: { content: string; requestId: string }[] = [];
  const fetch = vi.fn(async (_url, init?: RequestInit) => {
    if (init?.method === 'POST') { const body = JSON.parse(String(init.body)); posts.push(body); if (posts.length === 1) throw new Error('网络中断'); return Response.json({ id: 'sent', createdAt: Date.now(), status: 'pending' }); }
    return Response.json({ agentAvailable: true, messages: [] });
  });
  vi.stubGlobal('fetch', fetch);
  const { unmount } = render(<SessionChatView sessionId="one" onTerminal={() => {}} />);
  await waitFor(() => expect(screen.queryByText('正在读取对话…')).toBeNull());
  setComposer('请解释结果'); fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
  await screen.findByRole('button', { name: '重试发送' });
  expect(composerText()).toBe('');
  expect(screen.getByText('请解释结果')).toBeTruthy();
  expect(JSON.parse(sessionStorage.getItem(`termdock:chat:${location.origin}:one:pending`) || 'null')?.content).toBe('请解释结果');
  unmount();
  render(<SessionChatView sessionId="one" onTerminal={() => {}} />);
  await screen.findByRole('button', { name: '重试发送' });
  expect(screen.getByText('请解释结果')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '修改草稿' }));
  expect(composerText()).toBe('请解释结果');
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
  await waitFor(() => expect(posts).toHaveLength(2));
});
it('retries the retained message without clearing a new draft', async () => {
  const posts: { content: string; requestId: string }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts.push(JSON.parse(String(init.body)));
      if (posts.length === 1) throw new Error('网络中断');
      return Response.json({ id: 'sent', status: 'pending' });
    }
    return Response.json({ agentAvailable: true, messages: [] });
  }));
  render(<SessionChatView sessionId="retry" onTerminal={() => {}} />);
  await screen.findByText('想一起完成什么？');
  setComposer('请解释结果');
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
  await screen.findByRole('button', { name: '重试发送' });
  setComposer('下一条补充');
  fireEvent.click(screen.getByRole('button', { name: '重试发送' }));
  await waitFor(() => expect(posts).toHaveLength(2)); expect(posts[0].requestId).toBe(posts[1].requestId);
  await waitFor(() => expect(screen.queryByText('发送中…')).toBeNull());
  expect(composerText()).toBe('下一条补充');
});
it('clears the composer and quote immediately while preserving an identical next draft after acknowledgement', async () => {
  let acknowledge!: (response: Response) => void;
  const posts: { content: string; requestId: string }[] = [];
  const messages = [{ id: 'a', role: 'assistant', content: '需要解释的原话', createdAt: 1, status: 'stored' }];
  vi.stubGlobal('fetch', vi.fn(async (_url, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts.push(JSON.parse(String(init.body)));
      return new Promise<Response>(resolve => { acknowledge = resolve; });
    }
    return Response.json({ agentAvailable: true, agent: { displayName: 'Codex' }, messages });
  }));
  render(<SessionChatView sessionId="delayed" onTerminal={() => {}} />);
  await screen.findByText('需要解释的原话');
  const input = composer();
  setComposer('请解释');
  fireEvent.click(screen.getByRole('button', { name: '引用消息' }));
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(composerText()).toBe('');
  expect(screen.queryByRole('button', { name: '移除消息引用' })).toBeNull();
  expect(screen.getAllByText('发送中…').some(node => node.closest('[data-chat-turn="user"]'))).toBe(true);
  expect(posts[0].content).toContain('需要解释的原话');
  setComposer('请解释');
  fireEvent.click(screen.getByRole('button', { name: '引用消息' }));
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(posts).toHaveLength(1);
  await act(async () => acknowledge(Response.json({ id: 'sent', status: 'pending' })));
  expect(composerText()).toBe('请解释');
  expect(screen.getByRole('button', { name: '移除消息引用' })).toBeTruthy();
});
it('routes references into the active chat draft and acknowledges without sending terminal input', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ agentAvailable: true, messages: [] })));
  render(<SessionChatView sessionId="one" onTerminal={() => {}} />); await screen.findByText('想一起完成什么？');
  const ack = vi.fn(), terminal = vi.fn(); window.addEventListener('termdock-insert-reference-ack', ack); window.addEventListener('termdock-insert-reference', terminal);
  fireEvent(window, new CustomEvent('termdock-insert-reference', { detail: { text: '/tmp/shared/spec.md', sessionId: 'one', nonce: 'ref' } }));
  expect(composerText()).toBe('/tmp/shared/spec.md'); expect(ack.mock.calls[0][0].detail).toEqual({ nonce: 'ref', ok: true }); expect(terminal).not.toHaveBeenCalled();
  window.removeEventListener('termdock-insert-reference-ack', ack); window.removeEventListener('termdock-insert-reference', terminal);
});
it('keeps read-only recipients from sending or accepting references', async () => {
  const fetch = vi.fn(async () => Response.json({ agentAvailable: true, messages: [] })); vi.stubGlobal('fetch', fetch);
  render(<SessionChatView sessionId="readonly" canWrite={false} onTerminal={() => {}} />); await screen.findByText('想一起完成什么？');
  expect((screen.getByRole('textbox') as HTMLElement).getAttribute('aria-readonly')).toBe('true'); expect((screen.getByRole('button', { name: '发送消息' }) as HTMLButtonElement).disabled).toBe(true);
});

it('observes terminal output independently of progress and final replies', async () => {
  let messages = [{ id: 'u', role: 'user', content: '帮我整理', createdAt: 1, status: 'delivered' }];
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ agentAvailable: true, agent: { slug: 'codex', displayName: 'Codex' }, messages })));
  const { container } = render(<SessionChatView sessionId="waiting" onTerminal={() => {}} />);
  await screen.findByText('帮我整理');
  expect(screen.queryByText('处理中…')).toBeNull();
  expect(container.querySelector('[data-chat-reply-phase="idle"]')).toBeTruthy();
  liveOutput('waiting');
  await screen.findByText('处理中…');
  expect(screen.getByRole('status', { name: 'Codex处理中' })).toBeTruthy();
  messages = [...messages, { id: 'a1', role: 'assistant', content: '先整理资料', createdAt: 2, status: 'stored', replyTo: 'u', responseKind: 'progress' } as typeof messages[number]];
  fireEvent(window, new Event('online')); await screen.findByText('先整理资料'); expect(screen.getByText('处理中…')).toBeTruthy();
  messages = [...messages, { id: 'a2', role: 'assistant', content: '这是结果', createdAt: 3, status: 'stored', replyTo: 'u', responseKind: 'result' } as typeof messages[number]];
  fireEvent(window, new Event('online')); await screen.findByText('这是结果');
  expect(screen.getByText('处理中…')).toBeTruthy();
  act(() => useTerminalStore.getState().clearTerminalOutputActivity('waiting'));
  expect(screen.queryByText('处理中…')).toBeNull();
  expect(container.querySelectorAll('[data-chat-turn="assistant"]')).toHaveLength(1);
  const bodies = container.querySelectorAll('[data-chat-turn="assistant"] [data-chat-message]');
  expect(bodies).toHaveLength(2);
  expect(container.querySelector('[data-chat-continuation]')).toBeNull();
  expect(bodies[0].querySelector('time')?.getAttribute('datetime')).toBe(new Date(2).toISOString());
  expect(bodies[1].querySelector('time')?.getAttribute('datetime')).toBe(new Date(3).toISOString());
  expect(screen.getAllByRole('button', { name: '复制回复' })).toHaveLength(2);
  for (const body of bodies) expect(body.querySelector('[data-chat-message-actions] button[aria-label="引用消息"]')).toBeTruthy();
});

it('sends with Enter, keeps Shift+Enter for newlines, and never sends IME confirmation', async () => {
  const post = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (_url, init?: RequestInit) => { if (init?.method === 'POST') { post(JSON.parse(String(init.body))); return Response.json({ id: 'sent', status: 'pending' }); } return Response.json({ agentAvailable: true, messages: [] }); }));
  render(<SessionChatView sessionId="keyboard" onTerminal={() => {}} />); await screen.findByText('想一起完成什么？');
  const input = composer(); setComposer('中文消息');
  expect(fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })).toBe(true);
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true }); fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 }); expect(post).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter' }); await waitFor(() => expect(post).toHaveBeenCalledOnce()); expect(post.mock.calls[0][0].content).toBe('中文消息');
});
it('quotes a message without sending it, preserves the draft, and persists the quote in the submitted text', async () => {
  const posts: { content: string }[] = [];
  const messages = [{ id: 'a', role: 'assistant', content: '这里是需要解释的原话', createdAt: 1, status: 'stored' }];
  vi.stubGlobal('fetch', vi.fn(async (_url, init?: RequestInit) => { if (init?.method === 'POST') { posts.push(JSON.parse(String(init.body))); return Response.json({ id: 'u', status: 'pending' }); } return Response.json({ agentAvailable: true, agent: { displayName: 'Codex' }, messages }); }));
  render(<SessionChatView sessionId="quote" onTerminal={() => {}} />); await screen.findByText('这里是需要解释的原话'); expect(screen.getByText('Codex')).toBeTruthy();
  setComposer('请解释这句话'); fireEvent.click(screen.getByRole('button', { name: '引用消息' }));
  expect(composerText()).toBe('请解释这句话'); expect(posts).toHaveLength(0);
  expect(screen.getByRole('button', { name: '移除消息引用' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '发送消息' })); await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0].content).toContain('> Codex'); expect(posts[0].content).toContain('> 这里是需要解释的原话'); expect(posts[0].content).toContain('请解释这句话');
});
it('replaces the current draft selection when inserting an existing file reference', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ agentAvailable: true, messages: [] })));
  render(<SessionChatView sessionId="caret" onTerminal={() => {}} />); await screen.findByText('想一起完成什么？');
  setComposer('前文替换后文'); selectComposer(2, 4);
  fireEvent(window, new CustomEvent('termdock-insert-reference', { detail: { text: '/tmp/spec.md ', sessionId: 'caret', nonce: 'ref', focus: false } }));
  expect(composerText()).toBe('前文/tmp/spec.md 后文');
});

it('does not render history again while typing a draft', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ agentAvailable: true, messages: [{ id: 'reply', role: 'assistant', content: '已完成的回复', createdAt: 1, status: 'stored' }] })));
  render(<SessionChatView sessionId="memo-history" onTerminal={() => {}} />);
  await screen.findByTestId('chat-markdown');
  const renders = markdownRender.mock.calls.length;
  setComposer('新的草稿');
  setComposer('新的草稿继续输入');
  expect(markdownRender).toHaveBeenCalledTimes(renders);
});

it('requests only the recent page, prefetches older messages on scroll, and preserves the reading anchor', async () => {
  const messages: ChatMessage[] = Array.from({ length: 130 }, (_, index) => ({ id: `history-${index}`, sequence: index + 1, role: 'user', content: `历史消息 ${index}`, createdAt: index + 1, status: 'stored' }));
  const fetch = vi.fn(async (url: unknown) => pagedHistory(url, messages)); vi.stubGlobal('fetch', fetch);
  const { container } = render(<SessionChatView sessionId="long-history" onTerminal={() => {}} />);
  await screen.findByText('历史消息 129');
  expect(container.querySelectorAll('[data-chat-message]')).toHaveLength(30);
  expect(screen.queryByText('历史消息 99')).toBeNull();
  expect(new URL(String(fetch.mock.calls[0][0]), location.origin).searchParams.get('limit')).toBe('30');
  const scroller = container.querySelector('.session-chat > div') as HTMLElement;
  Object.defineProperty(scroller, 'clientHeight', { value: 500 });
  Object.defineProperty(scroller, 'scrollHeight', { get: () => container.querySelectorAll('[data-chat-message]').length * 100 });
  // Model real layout: the anchor moves with inserted rows and live scrolling.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this === scroller) return { top: 0, bottom: 500, height: 500 } as DOMRect;
    const row = this.closest('[data-chat-viewport-row]');
    const rows = [...container.querySelectorAll('[data-chat-viewport-row]')];
    const top = rows.indexOf(row!) * 100 - scroller.scrollTop;
    return { top, bottom: top + 100, height: 100 } as DOMRect;
  });
  scroller.scrollTop = 200; fireEvent.scroll(scroller);
  await screen.findByText('历史消息 70');
  expect(container.querySelectorAll('[data-chat-message]')).toHaveLength(60);
  expect(scroller.scrollTop).toBe(3200);
  scroller.scrollTop = 100; fireEvent.scroll(scroller);
  await screen.findByText('历史消息 40');
  expect(container.querySelectorAll('[data-chat-message]')).toHaveLength(90);
  expect(scroller.scrollTop).toBe(3100);
  expect(screen.queryByRole('button', { name: /查看更早的消息/ })).toBeNull();
});

it('restores a recently unmounted conversation and reading position while revalidation is stalled', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ agentAvailable: true, messages: [{ id: 'kept', role: 'assistant', content: '返回时保留这段对话', createdAt: 1, status: 'stored' }] })));
  const first = render(<SessionChatView sessionId="restore-history" onTerminal={() => {}} />);
  await screen.findByTestId('chat-markdown');
  const scroller = first.container.querySelector('.session-chat > div') as HTMLElement;
  Object.defineProperty(scroller, 'clientHeight', { value: 500 });
  Object.defineProperty(scroller, 'scrollHeight', { value: 2000 });
  scroller.scrollTop = 320; fireEvent.scroll(scroller); first.unmount();
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  const second = render(<SessionChatView sessionId="restore-history" onTerminal={() => {}} />);
  expect(screen.getByText('返回时保留这段对话')).toBeTruthy();
  expect(screen.queryByText('正在读取对话…')).toBeNull();
  expect((second.container.querySelector('.session-chat > div') as HTMLElement).scrollTop).toBe(320);
});

it('does not show the welcome state when the first history request fails', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(Response.json({ messages: [], agentAvailable: true }));
  vi.stubGlobal('fetch', fetch);
  render(<><AppFeedbackHost /><SessionChatView sessionId="failed-history" onTerminal={() => {}} /></>);
  await act(async () => {});
  expect(screen.queryByText('想一起完成什么？')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(2500));
  expect(screen.getByText('正在恢复对话同步…')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '重新连接' })).toBeNull();
  await act(async () => { window.dispatchEvent(new Event(SECURE_READY_EVENT)); });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(screen.queryByText('正在恢复对话同步…')).toBeNull();
  expect(screen.getByText('想一起完成什么？')).toBeTruthy();
});

it('keeps a failed send actionable when background history refresh succeeds', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(async (_url, init?: RequestInit) => {
    if (init?.method === 'POST') throw new TypeError('Failed to fetch');
    return Response.json({ agentAvailable: true, messages: [] });
  });
  vi.stubGlobal('fetch', fetch);
  render(<><AppFeedbackHost /><SessionChatView sessionId="send-sync-failure" onTerminal={() => {}} /></>);
  await act(async () => {});
  setComposer('需要重试的消息');
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
  await act(async () => {});
  expect(screen.getByRole('alert').textContent).toContain('发送失败');
  await act(async () => { window.dispatchEvent(new Event(SECURE_READY_EVENT)); });
  expect(screen.getByRole('alert').textContent).toContain('发送失败');
  expect(screen.getByRole('button', { name: '重试发送' })).toBeTruthy();
  expect(screen.getByText('需要重试的消息')).toBeTruthy();
});

it('ignores a response from the previous session and keeps drafts separate', async () => {
  let resolveOld!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('old-session') ? new Promise<Response>(resolve => { resolveOld = resolve; }) : Promise.resolve(Response.json({ agentAvailable: true, messages: [] }))));
  const view = render(<SessionChatView sessionId="old-session" onTerminal={() => {}} />);
  setComposer('原会话的草稿');
  view.rerender(<SessionChatView sessionId="new-session" onTerminal={() => {}} />);
  await screen.findByText('想一起完成什么？');
  await act(async () => resolveOld(Response.json({ agentAvailable: true, messages: [{ id: 'old', role: 'user', content: '过期响应', status: 'stored', createdAt: 1 }] })));
  expect(screen.queryByText('过期响应')).toBeNull();
  expect(composerText()).toBe('');
});

it('keeps the first visible row when new replies arrive during history reading', async () => {
  let messages: ChatMessage[] = Array.from({ length: 80 }, (_, index) => ({ id: `live-${index}`, role: 'user', content: `持续对话 ${index}`, createdAt: index + 1, status: 'stored' }));
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => pagedHistory(url, messages)));
  const { container } = render(<SessionChatView sessionId="live-reading" onTerminal={() => {}} />);
  await screen.findByText('持续对话 79');
  const scroller = container.querySelector('.session-chat > div') as HTMLElement;
  Object.defineProperty(scroller, 'clientHeight', { value: 500 });
  Object.defineProperty(scroller, 'scrollHeight', { value: 5000 });
  scroller.scrollTop = 900; fireEvent.scroll(scroller);
  messages = [...messages, { id: 'next', role: 'assistant', content: '新到达的回复', createdAt: 100, status: 'stored' }];
  fireEvent(window, new Event('online')); await screen.findByText('新到达的回复');
  expect(container.querySelector('[data-chat-message]')?.getAttribute('data-chat-message')).toBe('live-50');
  expect(scroller.scrollTop).toBe(900);
});

it('backs off failed polling and stops all background requests when inactive', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(async () => { throw new Error('offline'); }); vi.stubGlobal('fetch', fetch);
  const view = render(<SessionChatView sessionId="backoff" onTerminal={() => {}} />);
  await act(async () => {}); expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(4999); }); expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); }); expect(fetch).toHaveBeenCalledTimes(2);
  view.rerender(<SessionChatView sessionId="backoff" active={false} onTerminal={() => {}} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); }); expect(fetch).toHaveBeenCalledTimes(2);
});

it('acknowledges an earlier pending request and retains reply feedback when only later progress fits in the page', async () => {
  const requestId = 'pending-outside-current-page';
  sessionStorage.setItem(`termdock:chat:${location.origin}:paged-pending:pending`, JSON.stringify({ content: '已经送达的原请求', requestId, createdAt: 1 }));
  const messages = Array.from({ length: 30 }, (_, index) => ({ id: `progress-${index}`, role: 'assistant', content: `正在处理第 ${index} 步`, createdAt: index + 2, status: 'stored', responseKind: 'progress' }));
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ agentAvailable: true, messages, confirmedRequestId: requestId, replyPending: true, page: { mode: 'latest', hasOlder: true, hasNewer: false } })));
  render(<SessionChatView sessionId="paged-pending" onTerminal={() => {}} />);
  await screen.findByText('正在处理第 29 步');
  expect(screen.queryByText('处理中…')).toBeNull();
  expect(screen.queryByText('已经送达的原请求')).toBeNull();
  expect(screen.queryByRole('button', { name: '重试发送' })).toBeNull();
});

it('immediately appends an Agent reply placeholder after sending and merges it into actual replies', async () => {
  let acknowledge!: (response: Response) => void;
  let messages: ChatMessage[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url, init?: RequestInit) => {
    if (init?.method === 'POST') return new Promise<Response>(resolve => { acknowledge = resolve; });
    return Response.json({ agentAvailable: true, agent: { slug: 'codex', displayName: 'Codex' }, messages, replyPending: messages.length > 0 });
  }));
  const view = render(<SessionChatView sessionId="instant-author" onTerminal={() => {}} />);
  await screen.findByText('想一起完成什么？');
  setComposer('检查结果'); fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
  const dock = view.container.querySelector('[data-chat-terminal-dock]')!;
  const feedback = screen.getByRole('status', { name: 'Codex处理中' });
  expect(dock.contains(feedback)).toBe(true);
  const reply = view.container.querySelector('[data-chat-reply-feedback]')!;
  expect(reply.querySelector('[data-chat-agent-header]')?.textContent).toContain('Codex');
  expect(reply.querySelector('[style*=mask]')).toBeTruthy();
  expect(reply.previousElementSibling?.getAttribute('data-chat-turn')).toBe('user');
  expect(reply.querySelector('[data-chat-agent-awaiting]')).toBeTruthy();
  expect(reply.querySelector('.td-loading-spinner')).toBeNull();
  expect(feedback.textContent).toContain('处理中…');
  messages = [{ id: 'sent', role: 'user', content: '检查结果', createdAt: 1, status: 'delivered' }];
  await act(async () => acknowledge(Response.json({ id: 'sent', status: 'delivered' })));
  expect(screen.queryByRole('status', { name: 'Codex处理中' })).toBeNull();
  expect(view.container.querySelector('[data-chat-terminal-access]')?.textContent).toBe('详情');
  liveOutput('instant-author');
  await screen.findByRole('status', { name: 'Codex处理中' });
  expect(screen.getAllByText('Codex')).toHaveLength(1);
  messages.push({ id: 'progress', role: 'assistant', content: '正在核对结果', createdAt: 2, status: 'stored', replyTo: 'sent', responseKind: 'progress' });
  fireEvent(window, new Event('online')); await screen.findByText('正在核对结果');
  expect(screen.getAllByText('Codex')).toHaveLength(1);
  expect(view.container.querySelectorAll('[data-chat-turn="assistant"]')).toHaveLength(1);
  expect(screen.getByRole('status', { name: 'Codex处理中' }).textContent).toContain('处理中…');
  expect(view.container.querySelector('[data-chat-agent-header]')?.contains(screen.getByRole('status', { name: 'Codex处理中' }))).toBe(false);
});
it('keeps waving for the current question when an older answer arrives late, then stops on its first reply', async () => {
  const messages: ChatMessage[] = [
    { id: 'older', role: 'user', content: '上一轮', createdAt: 1, status: 'delivered' },
    { id: 'older-result', role: 'assistant', content: '之前的答案', createdAt: 2, status: 'stored', replyTo: 'older' },
    { id: 'current', role: 'user', content: '当前问题', createdAt: 3, status: 'delivered' },
  ];
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ agentAvailable: true, agent: { displayName: 'Codex' }, messages, replyPending: true })));
  const view = render(<SessionChatView sessionId="late-reply-wave" onTerminal={() => {}} />);
  await screen.findByText('当前问题');
  expect(view.container.querySelectorAll('[data-chat-agent-awaiting]')).toHaveLength(1);
  messages.push({ id: 'late-old', role: 'assistant', content: '上一轮的补充', createdAt: 4, status: 'stored', replyTo: 'older' });
  fireEvent(window, new Event('online')); await screen.findByText('上一轮的补充');
  expect(view.container.querySelectorAll('[data-chat-agent-awaiting]')).toHaveLength(1);
  messages.push({ id: 'current-ack', role: 'assistant', content: '开始处理当前问题', createdAt: 5, status: 'stored', replyTo: 'current', responseKind: 'ack' });
  fireEvent(window, new Event('online')); await screen.findByText('开始处理当前问题');
  expect(view.container.querySelector('[data-chat-agent-awaiting]')).toBeNull();
  expect(view.container.querySelector('[data-chat-reply-feedback]')).toBeNull();
  expect(screen.queryByRole('status', { name: 'Codex处理中' })).toBeNull();
  expect(view.container.querySelector('[data-chat-terminal-access]')?.textContent).toBe('详情');
});

it('removes optimistic agent feedback when sending fails', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url, init?: RequestInit) => {
    if (init?.method === 'POST') throw new Error('offline');
    return Response.json({ agentAvailable: true, agent: { slug: 'codex', displayName: 'Codex' }, messages: [] });
  }));
  const view = render(<SessionChatView sessionId="failed-author" onTerminal={() => {}} />);
  await screen.findByText('想一起完成什么？');
  setComposer('检查结果'); fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
  expect(screen.getByRole('status', { name: 'Codex处理中' }).closest('[data-chat-terminal-dock]')).toBeTruthy();
  await screen.findByRole('button', { name: '重试发送' });
  expect(view.container.querySelector('[data-chat-reply-feedback]')).toBeNull();
});

it('keeps an empty unavailable chat free of processing activity', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ agentAvailable: false, messages: [], replyPending: false })));
  render(<SessionChatView sessionId="unknown-agent" onTerminal={() => {}} />);
  const notice = (await screen.findByText('当前对话暂不可用')).parentElement!;
  expect(screen.queryByText('处理中…')).toBeNull();
  liveOutput('unknown-agent'); expect(notice.textContent).not.toContain('处理中…');
  act(() => useTerminalStore.getState().clearTerminalSession('unknown-agent'));
  expect(notice.textContent).not.toContain('处理中…');
});
it.each(['output', 'working', 'native', 'idle'])('keeps empty chat details through %s activity and drafting, then processes the first sent message', async signal => {
  const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  const sessionId = `empty-chat-${signal}`, messages: ChatMessage[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init?: RequestInit) => {
    if (init?.method === 'POST' && String(url).endsWith('/chat')) {
      messages.push({ id: 'first-request', role: 'user', content: '第一条消息', createdAt: 1, status: 'delivered' });
      return Response.json({ id: 'first-request', status: 'delivered' });
    }
    return Response.json({ agentAvailable: true, agent: { slug: 'custom-plugin', displayName: 'Agent' }, messages });
  }));
  const view = render(<SessionChatView sessionId={sessionId} onTerminal={() => {}} />);
  await screen.findByText('想一起完成什么？');
  act(() => {
    const store = useTerminalStore.getState();
    store.setTerminalSession(sessionId, { sessionId: `backend-${signal}`, cols: 80, rows: 24 });
    if (signal === 'output') store.setTerminalOutputActivity(sessionId, true);
    if (signal === 'working') store.setSessionAgentStatus(sessionId, { agentStatus: 'working' });
    if (signal === 'native') store.setSessionTuiProgress(sessionId, { source: 'osc7501', state: 'indeterminate', progress: null });
  });
  const details = view.container.querySelector('[data-chat-terminal-access]')!;
  expect(details.textContent).toBe('详情');
  expect(details.querySelector('.td-loading-spinner')).toBeNull();
  setComposer('第一条消息');
  expect(details.textContent).toBe('详情');
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/input-check'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
  expect(screen.getByRole('status', { name: 'Agent处理中' })).toBe(details);
  await screen.findByText('第一条消息');
  await waitFor(() => expect(messages).toHaveLength(1));
  expect(details.textContent).toBe(signal === 'idle' ? '详情' : '处理中…');
  focus.mockRestore();
});
it('does not let a failed chat submission hide actual terminal output', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url, init?: RequestInit) => {
    if (init?.method === 'POST') throw new Error('offline');
    return Response.json({ agentAvailable: true, agent: { displayName: 'Other agent' }, messages: [] });
  }));
  render(<SessionChatView sessionId="active-send-failure" onTerminal={() => {}} />);
  await screen.findByText('想一起完成什么？'); liveOutput('active-send-failure');
  setComposer('消息'); fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
  await screen.findByRole('button', { name: '重试发送' });
  expect(screen.getByText('处理中…')).toBeTruthy();
});

it.each([true, false])('never treats replyPending=%s as working evidence', async replyPending => {
  const sessionId = `working-proof-${replyPending}`;
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ agentAvailable: true, agent: { displayName: 'Agent' }, replyPending,
    messages: [{ id: 'proof-u', role: 'user', content: '仅有消息记录', createdAt: 1, status: 'delivered' }] })));
  const view = render(<SessionChatView sessionId={sessionId} onTerminal={() => {}} />);
  await screen.findByText('仅有消息记录');
  expect(screen.queryByRole('status', { name: 'Agent处理中' })).toBeNull();
  act(() => {
    useTerminalStore.getState().setTerminalSession(sessionId, { sessionId: `backend-${sessionId}`, cols: 80, rows: 24 });
    useTerminalStore.getState().setSessionAgentStatus(sessionId, { agentStatus: 'working' });
  });
  expect(screen.getByRole('status', { name: 'Agent处理中' })).toBeTruthy();
  act(() => useTerminalStore.getState().setSessionAgentStatus(sessionId, { agentStatus: 'idle' }));
  expect(view.container.querySelector('[data-chat-reply-status]')).toBeNull();
  expect(view.container.querySelector('[data-chat-terminal-access]')?.textContent).toBe('详情');
});

it('keeps one terminal entry above the composer through silence, activity and replies', async () => {
  const messages: ChatMessage[] = [{ id: 'u-stable', role: 'user', content: '跑完整验证再回复', createdAt: 1, status: 'delivered' }];
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ agentAvailable: true, agent: { displayName: 'Codex' }, messages, replyPending: true })));
  const view = render(<SessionChatView sessionId="stable-reply" onTerminal={() => {}} />);
  await screen.findByText('跑完整验证再回复');
  const entry = view.container.querySelector('[data-chat-terminal-access]')!;
  const dock = entry.parentElement;
  expect(entry.textContent).toBe('详情');
  expect(screen.queryByRole('status', { name: 'Codex处理中' })).toBeNull();
  expect(entry.closest('.session-chat-composer')).not.toBeNull();
  expect(entry.getAttribute('data-chat-reply-phase')).toBe('idle');
  liveOutput('stable-reply'); expect(screen.getByRole('status', { name: 'Codex处理中' })).toBe(entry);
  expect(entry.textContent).toBe('处理中…');
  act(() => useTerminalStore.getState().setTerminalOutputActivity('stable-reply', false));
  expect(view.container.querySelector('[data-chat-terminal-access]')).toBe(entry);
  expect(entry.textContent).toBe('详情');
  messages.push({ id: 'a-stable', role: 'assistant', content: '验证仍在继续', createdAt: 2, status: 'stored', responseKind: 'progress' });
  fireEvent(window, new Event('online')); await screen.findByText('验证仍在继续');
  expect(entry.textContent).toBe('详情');
  act(() => useTerminalStore.getState().setSessionAgentStatus('stable-reply', { type: 'agent-status', agentStatus: 'working' } as never));
  expect(screen.getByRole('status', { name: 'Codex处理中' })).toBe(entry);
  expect(entry.parentElement).toBe(dock);
  expect(entry.closest('[data-chat-message-actions]')).toBeNull();
  expect(view.container.querySelectorAll('[data-chat-terminal-access]')).toHaveLength(1);
});

it('keeps processing from the native terminal status when Codex animations produce no bytes', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ agentAvailable: true, agent: { displayName: 'Codex' }, messages: [{ id: 'native-u', role: 'user', content: '保持运行', createdAt: 1, status: 'delivered' }] })));
  const view = render(<SessionChatView sessionId="native-silent" onTerminal={() => {}} />);
  await screen.findByText('保持运行'); liveOutput('native-silent');
  act(() => {
    useTerminalStore.getState().setTerminalOutputActivity('native-silent', false);
    useTerminalStore.getState().setSessionTuiProgress('native-silent', { source: 'osc7501', state: 'indeterminate', progress: null, message: 'Working', app: 'codex' });
  });
  expect(screen.getByRole('status', { name: 'Codex处理中' })).toBeTruthy();
  expect(screen.getByRole('status', { name: 'Codex处理中' }).querySelector('.td-loading-spinner')).toBeTruthy();
  act(() => useTerminalStore.getState().setSessionTuiProgress('native-silent', null));
  expect(view.container.querySelector('[data-chat-reply-status]')).toBeNull();
  expect(view.container.querySelector('[data-chat-terminal-access]')?.textContent).toBe('详情');
});

it.each(['claude', 'gemini', 'custom-plugin'])('uses %s plugin working phases throughout silent terminal output', async slug => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ agentAvailable: true, agent: { slug, displayName: 'Plugin Agent' }, messages: [{ id: 'plugin-request', role: 'user', content: '继续处理', createdAt: 1, status: 'delivered' }] })));
  render(<SessionChatView sessionId={`plugin-${slug}`} onTerminal={() => {}} />);
  await screen.findByText('继续处理');
  act(() => {
    const store = useTerminalStore.getState();
    store.setTerminalSession(`plugin-${slug}`, { sessionId: `backend-${slug}`, cols: 80, rows: 24 });
    store.setSessionTuiProgress(`plugin-${slug}`, { source: 'osc7501', state: 'done', progress: null, reviewed: true });
    store.setSessionAgentStatus(`plugin-${slug}`, { agentStatus: 'working', agentStatusDetail: { id: 'thinking', label: '思考中', tone: 'info' }, agentActivity: 3, reviewed: true });
  });
  expect(screen.getByRole('status', { name: 'Plugin Agent处理中' })).toBeTruthy();
  act(() => useTerminalStore.getState().setSessionAgentStatus(`plugin-${slug}`, { agentStatus: 'waiting', agentActivity: 3, reviewed: true }));
  expect(screen.queryByRole('status', { name: 'Plugin Agent处理中' })).toBeNull();
});

it('allows a new native working report after the previous plugin turn was acknowledged', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ agentAvailable: true, agent: { displayName: 'Plugin Agent' }, messages: [{ id: 'native-request', role: 'user', content: '下一轮处理', createdAt: 1, status: 'delivered' }] })));
  render(<SessionChatView sessionId="plugin-native-next" onTerminal={() => {}} />);
  await screen.findByText('下一轮处理');
  act(() => {
    const store = useTerminalStore.getState();
    store.setTerminalSession('plugin-native-next', { sessionId: 'backend-next', cols: 80, rows: 24 });
    store.setSessionAgentStatus('plugin-native-next', { agentStatus: 'done', reviewed: true });
    store.setSessionTuiProgress('plugin-native-next', { source: 'osc7501', state: 'indeterminate', progress: null });
  });
  expect(screen.getByRole('status', { name: 'Plugin Agent处理中' })).toBeTruthy();
});

it.each(['claude', 'codex', 'custom-plugin'])('gives an explicit %s input request priority over pending replies and terminal output', async slug => {
  const sessionId = `input-${slug}`;
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ agentAvailable: true, agent: { slug, displayName: 'Agent' },
    messages: [{ id: 'u-input', role: 'user', content: '请继续', createdAt: 1, status: 'delivered' }], replyPending: true })));
  const view = render(<SessionChatView sessionId={sessionId} onTerminal={() => {}} />);
  await screen.findByText('请继续');
  liveOutput(sessionId);
  act(() => useTerminalStore.getState().setSessionAgentStatus(sessionId, { agentStatus: 'waiting' }));
  const status = screen.getByRole('status', { name: 'Agent等你处理' });
  expect(status.textContent).toBe('等你处理');
  expect(status.querySelector('.td-loading-spinner')).toBeNull();
  expect(status.getAttribute('title')).toBe('查看终端中的详细输出');
  expect(view.container.querySelector('[data-chat-reply-feedback]')).toBeNull();
  act(() => useTerminalStore.getState().setSessionAgentStatus(sessionId, { agentStatus: 'working' }));
  expect(screen.getByRole('status', { name: 'Agent处理中' })).toBe(status);
});

it.each([['question', '待回答'], ['permission', '待确认'], ['auth', '需要登录'], [undefined, '等你处理']] as const)(
  'uses only an explicit terminal block kind %s to show %s', async (kind, label) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ agentAvailable: true, agent: { displayName: 'Agent' }, messages: [{ id: 'typed-request', role: 'user', content: '等待问题', createdAt: 1, status: 'delivered' }], replyPending: false })));
    render(<SessionChatView sessionId="typed-input" onTerminal={() => {}} />);
    await screen.findByText('等待问题');
    act(() => {
      useTerminalStore.getState().setTerminalSession('typed-input', { sessionId: 'typed-backend', cols: 80, rows: 24 });
      useTerminalStore.getState().setSessionTuiProgress('typed-input', { source: 'osc7501', state: 'blocked', progress: null, kind });
    });
    const status = screen.getByRole('status', { name: `Agent${label}` });
    expect(status.querySelector('.td-loading-spinner')).toBeNull();
    act(() => useTerminalStore.getState().setSessionTuiProgress('typed-input', null));
    expect(screen.queryByRole('status', { name: `Agent${label}` })).toBeNull();
  });

it('does not keep a pending chat spinner after an explicit Agent completion without a chat result', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ agentAvailable: true, agent: { displayName: 'Agent' },
    messages: [{ id: 'u-done', role: 'user', content: '检查结束状态', createdAt: 1, status: 'delivered' }], replyPending: true })));
  const view = render(<SessionChatView sessionId="observed-completion" onTerminal={() => {}} />);
  await screen.findByText('检查结束状态');
  expect(screen.queryByRole('status', { name: 'Agent处理中' })).toBeNull();
  liveOutput('observed-completion');
  expect(screen.getByRole('status', { name: 'Agent处理中' })).toBeTruthy();
  act(() => {
    useTerminalStore.getState().setTerminalSession('observed-completion', { sessionId: 'done-backend', cols: 80, rows: 24 });
    useTerminalStore.getState().setSessionAgentStatus('observed-completion', { agentStatus: 'done', reviewed: true });
  });
  expect(view.container.querySelector('[data-chat-reply-status]')).toBeNull();
  expect(view.container.querySelector('[data-chat-terminal-access]')?.textContent).toBe('详情');
});

it('shows the quiet terminal switch only in the real empty state and retains it while drafting', async () => {
  let messages: ChatMessage[] = [], release!: (response: Response) => void;
  let first = true;
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (first) { first = false; return new Promise<Response>(resolve => { release = resolve; }); }
    return Response.json({ agentAvailable: true, messages });
  }));
  const terminal = vi.fn();
  render(<SessionChatView sessionId="mode-welcome-empty" onTerminal={terminal} />);
  expect(document.querySelector('[data-session-mode-welcome]')).toBeNull();
  await act(async () => { release(Response.json({ agentAvailable: true, messages: [] })); });
  await screen.findByRole('button', { name: '切换到终端' });
  setComposer('保留这个草稿');
  expect(document.querySelector('[data-session-mode-welcome]')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '切换到终端' }));
  expect(terminal).toHaveBeenCalledOnce(); expect(composerText()).toBe('保留这个草稿');
  messages = [{ id: 'incoming', role: 'assistant', content: '已有对话内容', createdAt: 1, status: 'stored' }];
  act(() => window.dispatchEvent(new Event('online')));
  await screen.findByText('已有对话内容');
  expect(document.querySelector('[data-session-mode-welcome]')).toBeNull();
});
