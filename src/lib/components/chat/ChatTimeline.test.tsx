// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ChatTimeline, ChatUserContent, ChatUserMessage } from './ChatTimeline';
import { composeChatDraft } from './chatComposerContent';
import type { ChatMessage } from './chatMessages';
vi.mock('./ChatMarkdown', () => ({ ChatMarkdown: ({ content }: { content: string }) => <p>{content}<a href="#details">资料链接</a></p> }));
vi.mock('./chatRenderers', () => ({ getChatRichContent: () => null }));
afterEach(() => { cleanup(); window.getSelection()?.removeAllRanges(); vi.unstubAllGlobals(); });
const messages: ChatMessage[] = [
  { id: 'u1', role: 'user', content: '整理资料', createdAt: 1, status: 'delivered' },
  { id: 'a1', role: 'assistant', content: '第一条进展', createdAt: 2, status: 'stored' },
  { id: 'a2', role: 'assistant', content: '第二条进展', createdAt: 3, status: 'stored' },
];
function setup(canWrite = true) {
  const onReference = vi.fn(), onCopy = vi.fn();
  const view = render(<><ChatTimeline messages={messages} agentName="Codex" sessionId="test" uiWritable={canWrite} canWrite={canWrite} copied="" onCopy={onCopy} onReference={onReference} onAction={async () => true} /><button>会话外操作</button></>);
  const message = (id: string) => view.container.querySelector<HTMLElement>(`[data-chat-message="${id}"]`)!;
  return { ...view, message, onCopy, onReference };
}
function tap(element: Element) {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  fireEvent.pointerDown(element); fireEvent.click(element, { detail: 1 });
}
it('keeps consecutive replies individually timed, copyable and quotable under one author', () => {
  const { message, onReference, onCopy } = setup();
  expect(screen.getAllByText('Codex')).toHaveLength(1);
  for (const reply of messages.slice(1)) {
    const body = message(reply.id);
    expect(body.querySelector('time')?.dateTime).toBe(new Date(reply.createdAt).toISOString());
    fireEvent.click(within(body).getByRole('button', { name: '引用消息' }));
    expect(onReference).toHaveBeenLastCalledWith(reply);
    fireEvent.click(within(body).getByRole('button', { name: '复制回复' }));
    expect(onCopy).toHaveBeenLastCalledWith(reply.content, reply.id);
  }
});
it('reveals only the tapped message and dismisses on a second tap, outside interaction or Escape', () => {
  const { message } = setup();
  tap(within(message('a1')).getByText('第一条进展'));
  expect(message('a1').hasAttribute('data-actions-open')).toBe(true);
  tap(within(message('a2')).getByText('第二条进展'));
  expect(message('a1').hasAttribute('data-actions-open')).toBe(false);
  expect(message('a2').hasAttribute('data-actions-open')).toBe(true);
  tap(within(message('a2')).getByText('第二条进展'));
  expect(message('a2').hasAttribute('data-actions-open')).toBe(false);
  tap(within(message('u1')).getByText('整理资料'));
  fireEvent.pointerDown(screen.getByText('会话外操作'));
  expect(message('u1').hasAttribute('data-actions-open')).toBe(false);
  tap(within(message('a1')).getByText('第一条进展'));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(message('a1').hasAttribute('data-actions-open')).toBe(false);
});
it('leaves selected text and embedded controls to their existing interactions', () => {
  const { message, onReference } = setup();
  const body = message('a1');
  tap(within(body).getByRole('link'));
  expect(body.hasAttribute('data-actions-open')).toBe(false);
  const range = document.createRange(); range.selectNodeContents(within(body).getByText('第一条进展'));
  window.getSelection()!.addRange(range);
  tap(within(body).getByText('第一条进展'));
  expect(body.hasAttribute('data-actions-open')).toBe(false);
  window.getSelection()!.removeAllRanges();
  tap(within(body).getByText('第一条进展'));
  fireEvent.click(within(body).getByRole('button', { name: '引用消息' }));
  expect(onReference).toHaveBeenCalledWith(messages[1]);
  expect(body.hasAttribute('data-actions-open')).toBe(false);
});
it('retains copying for read-only recipients and keeps pending retry actions directly available', () => {
  const { message } = setup(false);
  expect(screen.queryByRole('button', { name: '引用消息' })).toBeNull();
  tap(within(message('a1')).getByText('第一条进展'));
  expect(within(message('a1')).getByRole('button', { name: '复制回复' })).toBeTruthy();
  render(<ChatUserMessage content="待发送消息" createdAt={4} status="待重试"><button>重试发送</button></ChatUserMessage>);
  expect(screen.getByRole('button', { name: '重试发送' }).closest('.chat-message-tools')).toBeNull();
});

it('keeps existing reply nodes mounted when earlier or later messages join the same assistant turn', () => {
  const props = { agentName: 'Codex', sessionId: 'stable-group', uiWritable: true, canWrite: true, copied: '', onCopy: vi.fn(), onReference: vi.fn(), onAction: async () => true };
  const view = render(<ChatTimeline {...props} messages={messages.slice(1)} />);
  const first = screen.getByText('第一条进展');
  const earlier: ChatMessage = { id: 'a0', role: 'assistant', content: '更早的进展', createdAt: 0, status: 'stored' };
  view.rerender(<ChatTimeline {...props} messages={[earlier, ...messages.slice(1)]} />);
  expect(screen.getByText('第一条进展')).toBe(first);
  view.rerender(<ChatTimeline {...props} messages={[earlier, ...messages.slice(1), { ...earlier, id: 'a3', content: '新的进展', createdAt: 4 }]} />);
  expect(screen.getByText('第一条进展')).toBe(first);
});

it('keeps attachments and mentions inline in prose without duplicate cards or raw reference markers', () => {
  const file = { path: '/tmp/one.png', name: '截图.png', reference: '图片1' };
  const member = { sessionId: 'worker', groupId: 'team', groupName: '协作', name: '助手' };
  const view = render(<ChatUserContent content={composeChatDraft('比较【图片1】与【图片1】\n请@「助手 · 协作」说明【图片9】', [file], [member])} />);
  expect(screen.queryByRole('list', { name: '消息附件' })).toBeNull();
  expect(screen.getAllByRole('group', { name: '附件 图片1 · 截图.png' })).toHaveLength(2);
  expect(screen.getByRole('group', { name: '提及 @助手' })).toBeTruthy();
  expect(view.container.textContent).toBe('比较图片1与图片1\n请@助手说明【图片9】');
});
it('retains cards for older attachments without inline references and attachment-only messages', () => {
  const files = [{ path: '/tmp/old.png', name: '旧图.png' }, { path: '/tmp/new.png', name: '新图.png', reference: '图片2' }];
  const view = render(<ChatUserContent content={composeChatDraft('看【图片2】', files, [])} />);
  expect(within(screen.getByRole('list', { name: '消息附件' })).getByText('旧图.png')).toBeTruthy();
  expect(within(screen.getByRole('list', { name: '消息附件' })).queryByText('新图.png')).toBeNull();
  view.rerender(<ChatUserContent content={composeChatDraft('', files, [])} />);
  expect(within(screen.getByRole('list', { name: '消息附件' })).getByText('新图.png')).toBeTruthy();
});

it('places the reply placeholder after a new question and reuses the author when actual content arrives', () => {
  const props = { agentName: 'Codex', agentSlug: 'codex', sessionId: 'reply-placeholder', uiWritable: true, canWrite: true, copied: '', onCopy: vi.fn(), onReference: vi.fn(), onAction: async () => true };
  const pending = <div data-pending-question>下一轮问题</div>;
  const view = render(<ChatTimeline {...props} messages={messages} pendingMessage={pending} replyFeedback={<span role="status">发送中</span>} />);
  const feedback = view.container.querySelector('[data-chat-reply-feedback]')!;
  expect(feedback.previousElementSibling?.hasAttribute('data-pending-question')).toBe(true);
  expect(feedback.querySelector('[data-chat-agent-header]')).toBeTruthy();
  const next = [...messages, { ...messages[0], id: 'new-user', role: 'user' as const }, { ...messages[1], id: 'new-reply', role: 'assistant' as const }];
  view.rerender(<ChatTimeline {...props} messages={next} />);
  expect(view.container.querySelectorAll('[data-chat-agent-header]')).toHaveLength(2);
  expect(view.container.querySelector('[data-chat-agent-awaiting]')).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
  view.rerender(<ChatTimeline {...props} messages={next} />);
  expect(view.container.querySelector('[data-chat-reply-feedback]')).toBeNull();
});

it('moves the status to the newest reply footer while preserving existing reply actions', () => {
  const props = { agentName: 'Codex', sessionId: 'footer-status', uiWritable: true, canWrite: true, copied: '', onCopy: vi.fn(), onReference: vi.fn(), onAction: async () => true };
  const view = render(<ChatTimeline {...props} messages={messages} replyStatus={<button>处理中</button>} />);
  const footer = (id: string) => view.container.querySelector(`[data-chat-message="${id}"] [data-chat-message-actions]`)!;
  const original = footer('a2'), tools = original.querySelector('.chat-message-tools');
  expect(original.firstElementChild?.contains(screen.getByRole('button', { name: '处理中' }))).toBe(true);
  expect(footer('a1').contains(screen.getByRole('button', { name: '处理中' }))).toBe(false);
  view.rerender(<ChatTimeline {...props} messages={messages} />);
  expect(footer('a2')).toBe(original); expect(original.querySelector('.chat-message-tools')).toBe(tools);
  expect(screen.queryByRole('button', { name: '处理中' })).toBeNull();
  const next = [...messages, { ...messages[2], id: 'a3', content: '最新进展' }];
  view.rerender(<ChatTimeline {...props} messages={next} replyStatus={<button>处理中</button>} />);
  expect(footer('a2')).toBe(original);
  expect(footer('a3').firstElementChild?.contains(screen.getByRole('button', { name: '处理中' }))).toBe(true);
  expect(original.contains(screen.getByRole('button', { name: '处理中' }))).toBe(false);
});

it('identifies the exact question for out-of-order replies without repeating the same context on every update', () => {
  const props = { agentName: 'Codex', sessionId: 'reply-target', uiWritable: true, canWrite: true, copied: '', onCopy: vi.fn(), onReference: vi.fn(), onAction: async () => true };
  const older = { ...messages[0], id: 'old-question', content: '未读消息会抖动' };
  const latest = { ...messages[0], id: 'latest-question', content: '采用 A' };
  const list: ChatMessage[] = [older, latest,
    { ...messages[1], id: 'new-reply', replyTo: latest.id },
    { ...messages[1], id: 'old-reply', replyTo: older.id },
    { ...messages[1], id: 'old-followup', replyTo: older.id },
    { ...messages[1], id: 'unassociated' },
  ];
  const view = render(<ChatTimeline {...props} messages={list} />);
  const context = (id: string) => view.container.querySelector(`[data-chat-message="${id}"] [data-chat-reply-context]`);
  expect(context('new-reply')?.getAttribute('data-chat-reply-context')).toBe(latest.id);
  expect(context('old-reply')?.textContent).toContain('未读消息会抖动');
  expect(context('old-followup')).toBeNull(); expect(context('unassociated')).toBeNull();
  view.rerender(<ChatTimeline {...props} messages={[{ ...list[3], replyContext: { id: older.id, text: '未读消息会抖动', createdAt: 1 } }]} />);
  expect(context('old-reply')?.textContent).toContain('未读消息会抖动');
  view.rerender(<ChatTimeline {...props} messages={[{ ...list[3], replyContext: { id: 'unrelated', text: '不可展示的错误关联', createdAt: 1 } }]} />);
  expect(context('old-reply')).toBeNull();
});
