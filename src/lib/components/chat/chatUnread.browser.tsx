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
async function mount(width: number, messages: ChatMessage[], viewed: string[] = [], active = true, { aroundDelay = 0, aroundFailures = 0 } = {}) {
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
    if (around && aroundDelay) await pause(aroundDelay);
    if (around && aroundFailures-- > 0) return Response.json({}, { status: 503 });
    return Response.json({ chatIndex: index(), agentAvailable: true, agent: { displayName: 'Codex' }, messages: messages.slice(start, end), updates: after ? messages.slice(Math.max(0, anchor - 29), anchor + 1) : undefined, page: { hasOlder: start > 0, hasNewer: end < messages.length, mode: around ? 'around' : after ? 'after' : before ? 'before' : 'latest' } });
  }));
  const host = document.createElement('main'); host.style.cssText = 'height:100vh;display:flex;flex-direction:column'; document.body.append(host); root = createRoot(host);
  const render = (visible: boolean) => root!.render(<><AttentionIndicator /><SessionChatView sessionId={id} active={visible} visible={visible} onTerminal={() => {}} /></>);
  render(active);
  const addMany = (items: ChatMessage[]) => { messages.push(...items); store.setSessionChatIndex(id, index()); window.dispatchEvent(new Event('online')); };
  return { render, requests, serverViewed: () => [...serverSeen], viewElsewhere: (ids: string[]) => { for (const messageId of ids) serverSeen.add(messageId); store.setSessionChatIndex(id, index()); }, add: (message: ChatMessage) => addMany([message]), addMany };
}
it.each([1280, 390])('highlights actual unseen replies, acknowledges exposure and preserves it after remount at width %i', async width => {
  const messages = [reply(1), reply(2)];
  const f = await mount(width, messages);
  await expect.element(page.getByText(messages[0].content)).toBeVisible();
  await expect.poll(() => document.querySelectorAll('[data-chat-unread]').length).toBeGreaterThan(0);
  await expect.poll(() => attention().unreadIds.length).toBe(0);
  expect(document.querySelector('[data-chat-highlight]')).not.toBeNull();
  await page.screenshot({ path: `/tmp/veymux-chat-unread-after-${width}.png` });
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
  await page.screenshot({ path: `/tmp/veymux-worksite-layer-${width}.png` });
  await page.getByRole('button', { name: '1 条未读消息' }).click();
  await expect.element(page.getByText(messages[12].content)).toBeVisible();
  await expect.poll(() => attention().unreadIds).toEqual([]);
});
it.each([1280, 390])('opens the first unseen reply beyond the latest page and leaves offscreen replies unread at width %i', async width => {
  const messages = Array.from({ length: 65 }, (_, i) => reply(i + 1, true));
  const f = await mount(width, messages, messages.slice(0, 3).map(message => message.id));
  await expect.poll(() => f.requests.some(query => query.includes('around=reply-4'))).toBe(true);
  await expect.element(page.getByText(messages[3].content)).toBeVisible();
  await page.screenshot({ path: `/tmp/veymux-first-unread-${width}.png` });
  const viewport = document.querySelector('.session-chat-scroll')!.getBoundingClientRect();
  const row = document.querySelector('[data-chat-viewport-row="reply-4"]')!.getBoundingClientRect();
  expect(Math.abs(row.top - viewport.top - 12)).toBeLessThanOrEqual(1);
  await expect.poll(() => attention().unreadIds.includes('reply-4'), { timeout: 3000 }).toBe(false);
  expect(attention().unreadIds).toContain('reply-20');
  expect(attention().unreadIds).toContain('reply-65');
});

it.each([1280, 390])('keeps a delayed unread destination ahead of live refresh and never acknowledges the temporary latest page at width %i', async width => {
  const messages = Array.from({ length: 65 }, (_, i) => reply(i + 1, true));
  const f = await mount(width, messages, messages.slice(0, 3).map(message => message.id), true, { aroundDelay: 2900 });
  await expect.poll(() => f.requests.some(query => query.includes('around=reply-4'))).toBe(true);
  await pause(800);
  expect(f.serverViewed()).toHaveLength(3);
  f.add(reply(66, true));
  await expect.poll(() => {
    const row = document.querySelector('[data-chat-viewport-row="reply-4"]');
    const scroll = document.querySelector('.session-chat-scroll');
    return row && scroll ? Math.abs(row.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 12) : Infinity;
  }, { timeout: 5000 }).toBeLessThanOrEqual(1);
  await pause(2800);
  const row = document.querySelector('[data-chat-viewport-row="reply-4"]')!;
  expect(Math.abs(row.getBoundingClientRect().top - document.querySelector('.session-chat-scroll')!.getBoundingClientRect().top - 12)).toBeLessThanOrEqual(1);
  expect(attention().unreadIds).toContain('reply-65');
  expect(attention().unreadIds).toContain('reply-66');
});

it.each([1280, 390])('preserves the last loaded history page while fetching the following page at width %i', async width => {
  const messages = Array.from({ length: 100 }, (_, i) => reply(i + 1, true));
  await mount(width, messages, messages.slice(0, 3).map(message => message.id));
  await expect.poll(() => document.querySelector('[data-chat-viewport-row="reply-32"]')).not.toBeNull();
  const scroll = document.querySelector<HTMLElement>('.session-chat-scroll')!;
  scroll.scrollTop = scroll.scrollHeight; scroll.dispatchEvent(new Event('scroll')); await pause(50);
  const pin = document.querySelector('[data-chat-viewport-row="reply-32"] p')!;
  const top = pin.getBoundingClientRect().top;
  window.dispatchEvent(new Event('online'));
  await expect.poll(() => document.querySelector('[data-chat-viewport-row="reply-62"]')).not.toBeNull();
  await pause(150);
  expect(Math.abs(pin.getBoundingClientRect().top - top)).toBeLessThanOrEqual(1);
  expect(attention().unreadIds).toContain('reply-62');
});

it.each([1280, 390])('retries the first unread destination after a failed request recovers at width %i', async width => {
  const messages = Array.from({ length: 65 }, (_, i) => reply(i + 1, true));
  const f = await mount(width, messages, messages.slice(0, 3).map(message => message.id), true, { aroundFailures: 1 });
  await expect.poll(() => f.requests.filter(query => query.includes('around=reply-4')).length).toBe(1);
  await pause(150);
  expect(f.serverViewed()).toHaveLength(3);
  window.dispatchEvent(new Event('online'));
  await expect.poll(() => f.requests.filter(query => query.includes('around=reply-4')).length, { timeout: 4000 }).toBe(2);
  await expect.poll(() => {
    const row = document.querySelector('[data-chat-viewport-row="reply-4"]');
    return row ? Math.abs(row.getBoundingClientRect().top - document.querySelector('.session-chat-scroll')!.getBoundingClientRect().top - 12) : Infinity;
  }).toBeLessThanOrEqual(1);
  await expect.poll(() => attention().unreadIds.includes('reply-4'), { timeout: 3000 }).toBe(false);
});

it.each([1280, 390])('opens unread replies when a notification targets the already visible conversation at width %i', async width => {
  const messages = Array.from({ length: 12 }, (_, i) => reply(i + 1, true));
  const f = await mount(width, messages, messages.map(message => message.id));
  await expect.element(page.getByText(messages.at(-1)!.content)).toBeVisible();
  const scroll = document.querySelector<HTMLElement>('.session-chat-scroll')!;
  scroll.scrollTop = 0; scroll.dispatchEvent(new Event('scroll')); await pause(80);
  f.add(reply(13, true));
  await expect.poll(() => document.querySelector('[data-chat-viewport-row="reply-13"]')).not.toBeNull();
  window.dispatchEvent(new CustomEvent('switch-terminal-session', { detail: id }));
  await expect.poll(() => {
    const row = document.querySelector('[data-chat-viewport-row="reply-13"]')!.getBoundingClientRect();
    const viewport = scroll.getBoundingClientRect();
    return row.top >= viewport.top && row.top < viewport.bottom;
  }).toBe(true);
  await expect.poll(() => attention().unreadIds, { timeout: 3000 }).toEqual([]);
});

it.each([1280, 390])('starts a batch of live replies at the first new reply and preserves it when another arrives at width %i', async width => {
  const messages = Array.from({ length: 8 }, (_, i) => reply(i + 1));
  const f = await mount(width, messages, messages.map(message => message.id));
  await expect.element(page.getByText(messages.at(-1)!.content)).toBeVisible();
  f.addMany(Array.from({ length: 4 }, (_, i) => reply(i + 9, true)));
  await expect.poll(() => document.querySelector('[data-chat-viewport-row="reply-12"]')).not.toBeNull();
  const scroll = document.querySelector<HTMLElement>('.session-chat-scroll')!;
  const first = document.querySelector<HTMLElement>('[data-chat-viewport-row="reply-9"]')!;
  await pause(750);
  const top = first.getBoundingClientRect().top;
  expect(Math.abs(top - scroll.getBoundingClientRect().top - 12)).toBeLessThanOrEqual(1);
  f.add(reply(13, true));
  await expect.poll(() => document.querySelector('[data-chat-viewport-row="reply-13"]')).not.toBeNull();
  expect(Math.abs(first.getBoundingClientRect().top - top)).toBeLessThanOrEqual(1);
  expect(attention().unreadIds).toContain('reply-13');
});

it.each([1280, 390])('follows short live replies without asking to view the message already on screen at width %i', async width => {
  const messages = Array.from({ length: 8 }, (_, i) => reply(i + 1));
  const f = await mount(width, messages, messages.map(message => message.id));
  await expect.element(page.getByText(messages.at(-1)!.content)).toBeVisible();
  f.add(reply(9));
  await expect.element(page.getByText(messages.at(-1)!.content)).toBeVisible();
  await expect.poll(() => attention().unreadIds).toEqual([]);
  await pause(1000);
  expect(document.querySelector('[data-chat-new-message-prompt]')).toBeNull();
  const scroll = document.querySelector<HTMLElement>('.session-chat-scroll')!;
  expect(scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop).toBeLessThanOrEqual(1);
});

it.each([1280, 390])('keeps following after opening a short unread conversation at width %i', async width => {
  const f = await mount(width, [reply(1), reply(2)]);
  await expect.poll(() => attention().unreadIds, { timeout: 3000 }).toEqual([]);
  f.add({ ...reply(3, true), content: '新回复从开头开始。\n\n' + '这一段内容需要多屏阅读。\n\n'.repeat(50) });
  await expect.poll(() => document.querySelector('[data-chat-viewport-row="reply-3"]')).not.toBeNull();
  await pause(750);
  const scroll = document.querySelector('.session-chat-scroll')!.getBoundingClientRect();
  const row = document.querySelector('[data-chat-viewport-row="reply-3"]')!.getBoundingClientRect();
  expect(Math.abs(row.top - scroll.top - 12)).toBeLessThanOrEqual(1);
});

it.each([1280, 390])('shows the beginning of a long live reply instead of skipping to its ending at width %i', async width => {
  const messages = Array.from({ length: 8 }, (_, i) => reply(i + 1));
  const f = await mount(width, messages, messages.map(message => message.id));
  await expect.element(page.getByText(messages.at(-1)!.content)).toBeVisible();
  f.add({ ...reply(9), content: '长回复的开头，请从这里阅读。\n\n' + Array.from({ length: 32 }, (_, i) => `第 ${i + 1} 段：${'逐步核对用户实际看到的内容。'.repeat(8)}`).join('\n\n') + '\n\n长回复的结尾。' });
  await expect.poll(() => document.querySelector('[data-chat-viewport-row="reply-9"]')).not.toBeNull();
  await pause(1000);
  const scroll = document.querySelector<HTMLElement>('.session-chat-scroll')!;
  const row = document.querySelector<HTMLElement>('[data-chat-viewport-row="reply-9"]')!;
  await page.screenshot({ path: `/tmp/veymux-long-live-reply-${width}.png` });
  expect(Math.abs(row.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 12)).toBeLessThanOrEqual(1);
  await expect.poll(() => attention().unreadIds).toEqual([]);
  expect(document.querySelector('[data-chat-new-message-prompt]')?.textContent).not.toContain('查看新消息');
});

it.each([1280, 390])('offers a return to latest while reading history, without calling viewed content new at width %i', async width => {
  const messages = Array.from({ length: 12 }, (_, i) => reply(i + 1, true));
  const f = await mount(width, messages, messages.map(message => message.id));
  await expect.element(page.getByText(messages.at(-1)!.content)).toBeVisible();
  const scroll = document.querySelector<HTMLElement>('.session-chat-scroll')!;
  scroll.scrollTop = 0; scroll.dispatchEvent(new Event('scroll'));
  await expect.element(page.getByRole('button', { name: '回到最新', exact: true })).toBeVisible();
  f.add(reply(13, true));
  await page.getByRole('button', { name: '1 条未读消息' }).click();
  await expect.poll(() => attention().unreadIds, { timeout: 3000 }).toEqual([]);
  // A tall reply may still extend below the viewport after its opening is seen.
  if (scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop > 96) {
    await expect.element(page.getByRole('button', { name: '回到最新', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '回到最新', exact: true }).click();
  }
  await expect.poll(() => scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop).toBeLessThanOrEqual(1);
  expect(document.querySelector('[data-chat-new-message-prompt]')).toBeNull();
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
  await page.screenshot({ path: `/tmp/veymux-chat-unread-rail-${width}.png` });
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
  await page.screenshot({ path: `/tmp/veymux-reply-context-${width}.png` });
});
