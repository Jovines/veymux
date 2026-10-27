import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import { SessionChatView } from './SessionChatView';
import { AppFeedbackHost, useFeedbackStore } from '../ui/AppFeedback';
import { useTerminalStore } from '../../stores/useTerminalStore';
import { clearChatSnapshots } from './chatSnapshot';
import { clearChatHistoryRequests } from './chatHistoryRequest';
import type { ChatMessage } from './chatMessages';
import { SECURE_READY_EVENT } from '../../federation/connectionRecovery';
import '../../../index.css';
declare module 'vitest/browser' { interface BrowserCommands { replyActivate(selector: string): Promise<void> } }
let root: Root | undefined;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
afterEach(() => { root?.unmount(); root = undefined; clearChatHistoryRequests(); clearChatSnapshots(); useTerminalStore.getState().clearAllTerminalSessions(); useFeedbackStore.setState({ items: [] }); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); localStorage.clear(); sessionStorage.clear(); });
async function mount(width: number) {
  await page.viewport(width, 844);
  const all: ChatMessage[] = Array.from({ length: 90 }, (_, i) => ({ id: `m-${i}`, sequence: i + 1, role: i % 2 ? 'assistant' : 'user', content: `消息 ${i}：核对原消息与返回位置。\n\n${'这段内容用于确认列表跳转后能保持阅读位置。'.repeat(i % 4 + 1)}`, createdAt: i + 1, status: 'stored' }));
  const link = (reply: number, target: number) => { all[reply].replyTo = `m-${target}`; all[reply].replyContext = { id: `m-${target}`, text: `消息 ${target}：核对原消息与返回位置。`, createdAt: target + 1 }; };
  link(7, 4); link(85, 84); link(87, 8); link(89, 6);
  let offline = false, missing = false;
  const requests: string[] = [], delayed = new Map<string, { promise: Promise<void>; release: () => void }>();
  const index = () => ({ conversationId: 'reply-navigation', messageIds: all.filter(m => m.role === 'assistant').map(m => m.id), viewedMessageIds: all.filter(m => m.role === 'assistant').map(m => m.id) });
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = new URL(String(input), location.origin); requests.push(url.search);
    if (!url.pathname.endsWith('/chat')) return Response.json({});
    if (offline) throw new TypeError('offline');
    const before = url.searchParams.get('before'), after = url.searchParams.get('after'), around = url.searchParams.get('around');
    if (around && missing) return new Response('', { status: 404 });
    if (around && delayed.has(around)) await delayed.get(around)!.promise;
    const anchor = all.findIndex(m => m.id === (before || after || around));
    const start = around ? Math.max(0, anchor - 1) : before ? Math.max(0, anchor - 30) : after ? anchor + 1 : all.length - 30;
    const end = before ? anchor : Math.min(all.length, start + 30);
    return Response.json({ agentAvailable: true, agent: { displayName: 'Codex' }, messages: all.slice(start, end), updates: after ? all.slice(Math.max(0, anchor - 29), anchor + 1) : undefined, chatIndex: index(), page: { hasOlder: start > 0, hasNewer: end < all.length, mode: around ? 'around' : before ? 'before' : after ? 'after' : 'latest' } });
  }));
  const host = document.createElement('main'); host.style.cssText = 'height:100vh;display:flex;flex-direction:column'; document.body.append(host); root = createRoot(host); root.render(<><SessionChatView sessionId="reply-navigation" onTerminal={() => {}} /><AppFeedbackHost /></>);
  await expect.poll(() => document.querySelector('[data-chat-message="m-89"]')).not.toBeNull(); await pause(100);
  return { requests, append: () => { all.push({ id: 'new-reply', sequence: 91, role: 'assistant', content: '定位之后到达的新回复。', createdAt: 91, status: 'stored' }); window.dispatchEvent(new Event(SECURE_READY_EVENT)); }, offline: () => { offline = true; }, missing: () => { missing = true; }, hold: (id: string) => { let release!: () => void; delayed.set(id, { promise: new Promise<void>(done => { release = done; }), release: () => release() }); return () => delayed.get(id)!.release(); } };
}
function readingPoint() {
  const root = document.querySelector<HTMLElement>('.session-chat-scroll')!, bounds = root.getBoundingClientRect();
  const node = [...root.querySelectorAll<HTMLElement>('[data-chat-message] p')].find(node => { const r = node.getBoundingClientRect(); return r.bottom > bounds.top + 20 && r.top < bounds.bottom; })!;
  const row = node.closest<HTMLElement>('[data-chat-viewport-row]')!;
  return { id: row.dataset.chatViewportRow!, paragraph: [...row.querySelectorAll<HTMLElement>('p')].indexOf(node), top: node.getBoundingClientRect().top };
}
function pointTop(point: ReturnType<typeof readingPoint>) { return document.querySelector(`[data-chat-viewport-row="${point.id}"]`)?.querySelectorAll('p')[point.paragraph]?.getBoundingClientRect().top; }
const target = (id: string) => document.querySelector<HTMLElement>(`[data-chat-viewport-row="${id}"]`);
it.each([1280, 390])('loads an older original and returns to the same visible text at width %i', async width => {
  const f = await mount(width), point = readingPoint();
  await page.screenshot({ path: `/tmp/veymux-reply-jump-before-${width}.png` });
  await commands.replyActivate('[data-chat-message="m-89"] [data-chat-reply-context]');
  await expect.poll(() => target('m-6')).not.toBeNull();
  const list = document.querySelector('.session-chat-scroll')!.getBoundingClientRect();
  await expect.poll(() => target('m-6')!.getBoundingClientRect().top - list.top).toBeGreaterThanOrEqual(5);
  expect(target('m-6')!.getBoundingClientRect().top - list.top).toBeLessThan(30);
  expect(f.requests.some(query => query.includes('around=m-6'))).toBe(true);
  expect(document.querySelector('[data-chat-located="true"]')?.getAttribute('data-chat-viewport-row')).toBe('m-6');
  await page.screenshot({ path: `/tmp/veymux-reply-jump-target-${width}.png` });
  f.offline();
  await commands.replyActivate('[aria-label="返回回复"]');
  await expect.poll(() => pointTop(point)).not.toBeUndefined();
  expect(Math.abs(pointTop(point)! - point.top)).toBeLessThanOrEqual(1);
  expect(document.querySelector('[aria-label="返回回复"]')).toBeNull();
});
it.each([1280, 390])('jumps within loaded history without a request and keeps the editor focused at width %i', async width => {
  const f = await mount(width), editor = document.querySelector<HTMLElement>('[role="textbox"]')!;
  await page.getByRole('textbox').fill('保留草稿和键盘');
  const blur = vi.fn(); editor.addEventListener('blur', blur);
  const link = document.querySelector<HTMLElement>('[data-chat-message="m-85"] [data-chat-reply-context]')!;
  const list = document.querySelector<HTMLElement>('.session-chat-scroll')!;
  list.scrollTop += link.getBoundingClientRect().top - list.getBoundingClientRect().top - 100; list.dispatchEvent(new Event('scroll')); await pause(60);
  const point = readingPoint(), composer = document.querySelector('.session-chat-composer')!.getBoundingClientRect().toJSON();
  await commands.replyActivate('[data-chat-message="m-85"] [data-chat-reply-context]');
  await expect.poll(() => document.querySelector('[aria-label="返回回复"]')).not.toBeNull();
  expect(f.requests.some(query => query.includes('around='))).toBe(false);
  expect(document.activeElement).toBe(editor); expect(blur).not.toHaveBeenCalled();
  await commands.replyActivate('[aria-label="返回回复"]');
  expect(Math.abs(pointTop(point)! - point.top)).toBeLessThanOrEqual(1);
  expect(document.querySelector('.session-chat-composer')!.getBoundingClientRect().toJSON()).toEqual(composer);
  expect(editor.textContent).toBe('保留草稿和键盘'); expect(blur).not.toHaveBeenCalled();
});
it('keeps the current page and return state intact when the original is unavailable', async () => {
  const f = await mount(390); f.missing(); const point = readingPoint();
  await commands.replyActivate('[data-chat-message="m-89"] [data-chat-reply-context]');
  await expect.poll(() => useFeedbackStore.getState().items.some(item => item.message.includes('原消息'))).toBe(true);
  expect(Math.abs(pointTop(point)! - point.top)).toBeLessThanOrEqual(1);
  expect(document.querySelector('[aria-label="返回回复"]')).toBeNull();
});
it('ignores a late result after another reference supersedes it', async () => {
  const f = await mount(390), release = f.hold('m-6');
  await commands.replyActivate('[data-chat-message="m-89"] [data-chat-reply-context]');
  await expect.poll(() => f.requests.some(query => query.includes('around=m-6'))).toBe(true);
  await commands.replyActivate('[data-chat-message="m-87"] [data-chat-reply-context]');
  await expect.poll(() => document.querySelector('[data-chat-located="true"]')?.getAttribute('data-chat-viewport-row')).toBe('m-8');
  release(); await pause(100);
  expect(document.querySelector('[data-chat-located="true"]')?.getAttribute('data-chat-viewport-row')).toBe('m-8');
});
it('cancels a slow lookup without changing the page or leaving a return button', async () => {
  const f = await mount(390), release = f.hold('m-6'), point = readingPoint();
  await commands.replyActivate('[data-chat-message="m-89"] [data-chat-reply-context]');
  await commands.replyActivate('[aria-label="取消定位"]');
  release(); await pause(100);
  expect(target('m-6')).toBeNull(); expect(document.querySelector('[aria-label="返回回复"]')).toBeNull();
  expect(Math.abs(pointTop(point)! - point.top)).toBeLessThanOrEqual(1);
});
it('returns through nested references and stays at the saved text as a new reply arrives', async () => {
  const f = await mount(390), origin = readingPoint();
  await commands.replyActivate('[data-chat-message="m-89"] [data-chat-reply-context]');
  await expect.poll(() => target('m-6')).not.toBeNull();
  const middle = readingPoint();
  await commands.replyActivate('[data-chat-message="m-7"] [data-chat-reply-context]');
  await expect.poll(() => document.querySelector('[data-chat-located="true"]')?.getAttribute('data-chat-viewport-row')).toBe('m-4');
  await commands.replyActivate('[aria-label="返回回复"]');
  expect(Math.abs(pointTop(middle)! - middle.top)).toBeLessThanOrEqual(1);
  await commands.replyActivate('[aria-label="返回回复"]');
  expect(Math.abs(pointTop(origin)! - origin.top)).toBeLessThanOrEqual(1);
  f.append();
  await expect.poll(() => target('new-reply')).not.toBeNull();
  await pause(100);
  expect(Math.abs(pointTop(origin)! - origin.top)).toBeLessThanOrEqual(1);
});
