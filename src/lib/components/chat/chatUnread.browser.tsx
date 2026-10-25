import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { createRoot, type Root } from 'react-dom/client';
import { SessionChatView } from './SessionChatView';
import { AgentSessionDot } from '../AgentIndicators';
import { clearChatViewingUpdates } from './chatViewedMessages';
import { useTerminalStore } from '../../stores/useTerminalStore';
import { clearChatSnapshots } from './chatSnapshot';
import type { ChatMessage } from './chatMessages';
import '../../../index.css';
let root: Root | undefined;
function AttentionIndicator() { const attention = useTerminalStore(state => state.sessions.get(id)?.chatAttention); return <span data-test-unread-dot className="relative block h-5 w-5"><AgentSessionDot status={null} chatAttention={attention} /></span>; }
const id = 'unread-browser';
const attention = () => useTerminalStore.getState().sessions.get(id)!.chatAttention!;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
afterEach(() => { root?.unmount(); root = undefined; useTerminalStore.getState().clearAllTerminalSessions(); clearChatSnapshots(); clearChatViewingUpdates(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); localStorage.clear(); sessionStorage.clear(); });
const reply = (n: number, long = false): ChatMessage => ({ id: `reply-${n}`, role: 'assistant', content: `第 ${n} 项检查结果。${long ? '这段说明用于核对长对话的滚动位置和消息查看状态。'.repeat(18) : '已完成检查，请查看结果。'}`, createdAt: n + 1, sequence: n + 1, status: 'stored' });
async function mount(width: number, messages: ChatMessage[], viewed: string[] = [], active = true) {
  await page.viewport(width, 844);
  const store = useTerminalStore.getState(); store.setSessionChatMode(id, true);
  const serverSeen = new Set(viewed);
  const index = () => ({ conversationId: 'conversation', messageIds: messages.filter(message => message.role === 'assistant').map(message => message.id), viewedMessageIds: [...serverSeen] });
  store.setSessionChatIndex(id, index());
  const requests: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input), location.origin); requests.push(url.search);
    if (url.pathname.endsWith('/chat/viewed')) { for (const id of JSON.parse(String(init?.body)).messageIds) serverSeen.add(id); return Response.json({ chatIndex: index() }); }
    const before = url.searchParams.get('before'), after = url.searchParams.get('after'), around = url.searchParams.get('around');
    const anchor = messages.findIndex(message => message.id === (before || after || around));
    const start = around ? Math.max(0, anchor - 1) : after ? anchor + 1 : before ? Math.max(0, anchor - 30) : Math.max(0, messages.length - 30);
    const end = before ? anchor : Math.min(messages.length, start + 30);
    return Response.json({ chatIndex: index(), agentAvailable: true, agent: { displayName: 'Codex' }, messages: messages.slice(start, end), updates: after ? messages.slice(Math.max(0, anchor - 29), anchor + 1) : undefined, page: { hasOlder: start > 0, hasNewer: end < messages.length, mode: around ? 'around' : after ? 'after' : before ? 'before' : 'latest' } });
  }));
  const host = document.createElement('main'); host.style.cssText = 'height:100vh;display:flex;flex-direction:column'; document.body.append(host); root = createRoot(host);
  const render = (visible: boolean) => root!.render(<><AttentionIndicator /><SessionChatView sessionId={id} active={visible} visible={visible} onTerminal={() => {}} /></>);
  render(active);
  return { render, requests, serverViewed: () => [...serverSeen], viewElsewhere: (ids: string[]) => { for (const messageId of ids) serverSeen.add(messageId); store.setSessionChatIndex(id, index()); }, add: (message: ChatMessage) => { messages.push(message); store.setSessionChatIndex(id, index()); window.dispatchEvent(new Event('online')); } };
}
it.each([1280, 390])('highlights actual unseen replies, acknowledges exposure and preserves it after remount at width %i', async width => {
  const messages = [reply(1), reply(2)];
  const f = await mount(width, messages);
  await expect.element(page.getByText(messages[0].content)).toBeVisible();
  await expect.poll(() => document.querySelectorAll('[data-chat-unread]').length).toBeGreaterThan(0);
  await expect.poll(() => attention().unreadIds.length).toBe(0);
  expect(document.querySelector('[data-chat-highlight]')).not.toBeNull();
  await page.screenshot({ path: `/tmp/termdock-chat-unread-after-${width}.png` });
  root!.unmount(); root = undefined;
  useTerminalStore.getState().clearAllTerminalSessions(); clearChatSnapshots();
  document.body.replaceChildren();
  await mount(width, messages, f.serverViewed());
  await expect.element(page.getByText(messages[1].content)).toBeVisible();
  expect(attention().unreadIds).toEqual([]);
  expect(document.querySelector('[data-chat-unread]')).toBeNull();
  expect(document.querySelector('[data-chat-highlight]')).toBeNull();
});
it('keeps background replies unread until the chat becomes visible', async () => {
  const f = await mount(390, [reply(1), reply(2)], [], false);
  await pause(750); expect(attention().unreadIds).toEqual(['reply-1', 'reply-2']);
  f.render(true);
  await expect.poll(() => attention().unreadIds.length).toBe(0);
});
it.each([1280, 390])('does not clear overscanned replies or pull a reader away from old messages at width %i', async width => {
  const messages = Array.from({ length: 12 }, (_, i) => reply(i + 1, true));
  const f = await mount(width, messages, messages.map(message => message.id));
  await expect.element(page.getByText(messages[11].content)).toBeVisible();
  const scroll = document.querySelector<HTMLElement>('.session-chat-scroll')!;
  scroll.scrollTop = 0; scroll.dispatchEvent(new Event('scroll')); await pause(150);
  f.add(reply(13, true));
  await expect.element(page.getByRole('button', { name: '1 条未读消息' })).toBeVisible();
  await pause(850);
  expect(attention().unreadIds).toEqual(['reply-13']); expect(scroll.scrollTop).toBeLessThan(50);
  const pill = document.querySelector('[data-chat-new-message-prompt] button')!.getBoundingClientRect();
  const preview = document.querySelector('[data-chat-terminal-access]')!.getBoundingClientRect();
  expect(pill.left).toBeGreaterThanOrEqual(preview.right);
  const unreadButton = document.querySelector<HTMLElement>('[data-chat-new-message-prompt] button')!;
  const previewButton = document.querySelector<HTMLElement>('[data-chat-terminal-access] [data-terminal-peek-trigger]') ?? document.querySelector<HTMLElement>('[data-chat-terminal-access] > div')!;
  const surface = getComputedStyle(document.querySelector('[data-chat-composer]')!).backgroundColor;
  expect(getComputedStyle(unreadButton).backgroundColor).toBe(surface);
  expect(getComputedStyle(previewButton).backgroundColor).toBe(surface);
  expect(getComputedStyle(unreadButton).borderRadius).toBe(getComputedStyle(previewButton).borderRadius);
  expect(Math.abs(unreadButton.getBoundingClientRect().height - previewButton.getBoundingClientRect().height)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `/tmp/termdock-worksite-layer-${width}.png` });
  await page.getByRole('button', { name: '1 条未读消息' }).click();
  await expect.element(page.getByText(messages[12].content)).toBeVisible();
  await expect.poll(() => attention().unreadIds).toEqual([]);
});
it('opens the first unseen reply beyond the latest page and leaves offscreen replies unread', async () => {
  const messages = Array.from({ length: 65 }, (_, i) => reply(i + 1, true));
  const f = await mount(1280, messages, messages.slice(0, 3).map(message => message.id));
  await expect.poll(() => f.requests.some(query => query.includes('around=reply-4'))).toBe(true);
  await expect.element(page.getByText(messages[3].content)).toBeVisible();
  await expect.poll(() => attention().unreadIds.includes('reply-4')).toBe(false);
  expect(attention().unreadIds).toContain('reply-20');
  expect(attention().unreadIds).toContain('reply-65');
});
it('cancels exposure when the document is hidden and resumes on visibility', async () => {
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  await mount(1280, [reply(1)]);
  await pause(850); expect(attention().unreadIds).toEqual(['reply-1']);
  hidden.mockReturnValue(false); document.dispatchEvent(new Event('visibilitychange'));
  await expect.poll(() => attention().unreadIds).toEqual([]);
});

it('clears the existing yellow dot from a remote acknowledgement without opening the chat and marks a later reply again', async () => {
  const f = await mount(390, [reply(1), reply(2)], [], false);
  await expect.element(page.getByTitle('2 unread messages')).toBeVisible();
  f.viewElsewhere(['reply-1']);
  await expect.element(page.getByTitle('1 unread messages')).toBeVisible();
  f.viewElsewhere(['reply-2']);
  await expect.poll(() => document.querySelector('[data-test-unread-dot]')?.childElementCount).toBe(0);
  f.add(reply(3));
  await expect.element(page.getByTitle('1 unread messages')).toBeVisible();
  expect(attention().unreadIds).toEqual(['reply-3']);
});

it.each([1280, 390])('groups multiple new replies with a quiet rail and stable actions at width %i', async width => {
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  await mount(width, Array.from({ length: 5 }, (_, index) => reply(index + 1)));
  await expect.poll(() => document.querySelectorAll('[data-chat-unread]').length).toBe(5);
  const rows = [...document.querySelectorAll<HTMLElement>('[data-chat-unread]')];
  const before = rows.map(row => row.getBoundingClientRect().height);
  for (const row of rows) {
    expect(getComputedStyle(row).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(getComputedStyle(row).boxShadow).toBe('none');
    expect(getComputedStyle(row, '::before').width).toBe('2px');
    expect(getComputedStyle(row, '::before').pointerEvents).toBe('none');
    expect(row.querySelector('[data-chat-message-actions]')?.firstElementChild?.hasAttribute('data-chat-reply-leading')).toBe(true);
  }
  const labels = [...document.querySelectorAll('[data-chat-unread-label]')];
  expect(labels.filter(label => getComputedStyle(label).visibility === 'visible')).toHaveLength(1);
  await page.screenshot({ path: `/tmp/termdock-chat-unread-rail-${width}.png` });
  hidden.mockReturnValue(false); document.dispatchEvent(new Event('visibilitychange'));
  await expect.poll(() => attention().unreadIds.length).toBe(0);
  expect(rows.map(row => row.getBoundingClientRect().height)).toEqual(before);
  await expect.poll(() => document.querySelectorAll('.chat-message-attention').length, { timeout: 4000 }).toBe(0);
});

it.each([1280, 390])('keeps the composer still and avoids flashing a prompt for an already visible reply at width %i', async width => {
  await mount(width, [reply(1)]);
  await expect.element(page.getByText(reply(1).content)).toBeVisible();
  const composer = document.querySelector<HTMLElement>('.session-chat-composer')!;
  const scroll = document.querySelector<HTMLElement>('.session-chat-scroll')!;
  const before = { composer: composer.getBoundingClientRect().toJSON(), scroll: scroll.getBoundingClientRect().toJSON() };
  const samples: { composer: unknown; scroll: unknown; promptVisible: boolean }[] = [];
  const until = performance.now() + 1200;
  while (performance.now() < until) {
    const prompt = document.querySelector('[data-chat-new-message-prompt]');
    samples.push({ composer: composer.getBoundingClientRect().toJSON(), scroll: scroll.getBoundingClientRect().toJSON(), promptVisible: !!prompt && getComputedStyle(prompt).visibility === 'visible' });
    await new Promise(resolve => requestAnimationFrame(resolve));
  }
  expect(attention().unreadIds).toEqual([]);
  expect(samples.every(sample => !sample.promptVisible)).toBe(true);
  expect(samples.every(sample => JSON.stringify(sample.composer) === JSON.stringify(before.composer) && JSON.stringify(sample.scroll) === JSON.stringify(before.scroll))).toBe(true);
});

it.each([1280, 390, 320])('shows a restrained question label for replies to different requests at width %i', async width => {
  const first: ChatMessage = { id: 'question-jitter', role: 'user', content: '未读按钮消失时，界面会抖动', sequence: 1, createdAt: 1000, status: 'delivered' };
  const second: ChatMessage = { id: 'question-design', role: 'user', content: '采用终端预览方案 A：轻量窗口。', sequence: 2, createdAt: 2000, status: 'delivered' };
  const latest = { ...reply(1), content: '收到，采用 A。保持现有消息布局，只调整浮窗控件。', sequence: 3, replyTo: second.id };
  const older = { ...reply(2), content: '未读提示已改为浮动展示，消失时不会顶动输入框。', sequence: 4, replyTo: first.id };
  const continued = { ...reply(3), content: '桌面和手机上的验证已经通过。', sequence: 5, replyTo: first.id };
  await mount(width, [first, second, latest, older, continued], [latest.id, older.id, continued.id]);
  await expect.element(page.getByText(older.content)).toBeVisible();
  const labels = [...document.querySelectorAll<HTMLElement>('[data-chat-reply-context]')];
  expect(labels).toHaveLength(2);
  expect(labels[0].textContent).toContain(second.content);
  expect(labels[1].textContent).toContain(first.content);
  for (const label of labels) {
    expect(label.getBoundingClientRect().height).toBe(20);
    expect(getComputedStyle(label).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(label.getBoundingClientRect().right).toBeLessThanOrEqual(innerWidth);
  }
  await page.screenshot({ path: `/tmp/termdock-reply-context-${width}.png` });
});
