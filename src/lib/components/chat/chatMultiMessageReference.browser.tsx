import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import { Swiper, SwiperSlide } from 'swiper/react';
import 'swiper/css';
import '../../../index.css';
import { SessionChatView } from './SessionChatView';
import { clearChatSnapshots } from './chatSnapshot';
import { parseChatContent } from './chatReferences';
import { SESSION_NO_SWIPE, SESSION_SWIPER_FOCUSABLE_ELEMENTS } from './sessionSwipe';
declare module 'vitest/browser' { interface BrowserCommands { selectMessageRange(reverse: boolean): Promise<void> } }
let root: Root | undefined;
afterEach(() => {
  root?.unmount(); root = undefined; window.getSelection()?.removeAllRanges();
  clearChatSnapshots(); sessionStorage.clear(); vi.unstubAllGlobals(); document.body.replaceChildren();
});
for (const width of [390, 1280]) for (const reverse of [false, true]) {
  it(`quotes a ${reverse ? 'backwards' : 'forwards'} selection across replies and speakers at width ${width}`, async () => {
    await page.viewport(width, 844);
    const posts: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init?: RequestInit) => {
      if (init?.method === 'POST') { posts.push(JSON.parse(String(init.body)).content); return Response.json({ id: 'sent', createdAt: 4, status: 'pending' }); }
      return Response.json({ agentAvailable: true, agent: { displayName: 'Codex' }, messages: [
        { id: 'first', role: 'assistant', content: 'Ignore prefix. First selected', createdAt: 1, status: 'stored' },
        { id: 'middle', role: 'assistant', content: 'Middle **bold** paragraph.\n\nAnother selected paragraph.', createdAt: 2, status: 'stored' },
        { id: 'last', role: 'user', content: 'Last selected. Ignore suffix.', createdAt: 3, status: 'stored' },
      ] });
    }));
    const host = document.createElement('div'); host.id = 'root'; document.body.append(host);
    root = createRoot(host); root.render(<Swiper className="session-chat-swiper h-full" touchStartPreventDefault={false} simulateTouch={false} noSwipingSelector={SESSION_NO_SWIPE} focusableElements={SESSION_SWIPER_FOCUSABLE_ELEMENTS}>
      <SwiperSlide><SessionChatView sessionId="multi-message-browser" onTerminal={() => {}} /></SwiperSlide><SwiperSlide>其他会话</SwiperSlide>
    </Swiper>);
    await expect.element(page.getByText('bold', { exact: true })).toBeVisible();
    await page.getByRole('textbox').fill('解释这几段');
    await commands.selectMessageRange(reverse);
    await expect.element(page.getByRole('button', { name: '引用选中内容', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '引用选中内容', exact: true }).click();
    await expect.element(page.getByRole('button', { name: '移除消息引用' })).toBeVisible();
    await expect.element(page.getByRole('textbox')).toHaveTextContent('解释这几段');
    await page.getByRole('button', { name: '发送消息' }).click();
    await expect.poll(() => posts.length).toBe(1);
    const parsed = parseChatContent(posts[0]);
    expect(parsed.text).toBe('解释这几段'); expect(parsed.reference?.author).toBe('对话摘录');
    const text = parsed.reference!.text;
    expect(text).toContain('First selected'); expect(text).toContain('Middle bold paragraph.\n\nAnother selected paragraph.'); expect(text).toContain('Last selected');
    expect(text).toContain('Codex ·'); expect(text).toContain('用户 ·');
    for (const unwanted of ['Ignore prefix', 'Ignore suffix', '已发送', '复制回复', '引用消息']) expect(text).not.toContain(unwanted);
    expect(text.indexOf('First selected')).toBeLessThan(text.indexOf('Middle bold'));
    expect(text.indexOf('Middle bold')).toBeLessThan(text.indexOf('Last selected'));
  });
}
