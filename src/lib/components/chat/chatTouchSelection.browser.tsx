import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { Swiper, SwiperSlide } from 'swiper/react';
import type { Swiper as SwiperInstance } from 'swiper';
import 'swiper/css';
import '../../../index.css';
import { SessionChatView } from './SessionChatView';
import { clearChatSnapshots } from './chatSnapshot';
import { SESSION_NO_SWIPE, SESSION_SWIPER_FOCUSABLE_ELEMENTS } from './sessionSwipe';

let root: Root | undefined, swiper: SwiperInstance | undefined;
afterEach(() => {
  root?.unmount(); root = undefined; swiper = undefined;
  window.getSelection()?.removeAllRanges(); clearChatSnapshots(); sessionStorage.clear();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren();
});
async function mount(canWrite = true) {
  await page.viewport(390, 844);
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('iPhone');
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ agentAvailable: true, messages: [
    { id: 'user', role: 'user', content: '用户发送的普通文字也可以选择', createdAt: 1, status: 'stored' },
    { id: 'reply', role: 'assistant', content: '这是一段需要引用的**加粗文字**，还有*斜体文字*和[链接文字](https://example.com)。', createdAt: 2, status: 'stored' },
  ] })));
  const host = document.createElement('div'); host.id = 'root'; document.body.append(host);
  root = createRoot(host); root.render(<Swiper className="session-chat-swiper h-full" onSwiper={value => { swiper = value; }} speed={0} touchStartPreventDefault={false} simulateTouch={false} noSwipingSelector={SESSION_NO_SWIPE} focusableElements={SESSION_SWIPER_FOCUSABLE_ELEMENTS}>
    <SwiperSlide><SessionChatView sessionId="native-selection" canWrite={canWrite} onTerminal={() => {}} /></SwiperSlide><SwiperSlide>其他会话</SwiperSlide>
  </Swiper>);
  await expect.element(page.getByText('加粗文字', { exact: true })).toBeVisible();
  return document.querySelector<HTMLElement>('[data-chat-message="reply"] p')!;
}
function pointer(target: HTMLElement, type: 'pointerdown' | 'pointerup', x = 180) {
  const event = new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 7, isPrimary: true, button: 0, clientX: x, clientY: 100 });
  target.dispatchEvent(event); return event;
}
function select(target: HTMLElement) {
  const range = document.createRange(); range.selectNodeContents(target);
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
}
// Chromium cannot reproduce iOS selection handles. These events verify the
// application's behavior after native selection exists, with a real Swiper.
function move(target: HTMLElement, x: number, y: number) {
  const touch = new Touch({ identifier: 7, target, clientX: x, clientY: y, pageX: x, pageY: y });
  const event = new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [touch], targetTouches: [touch], changedTouches: [touch] });
  target.dispatchEvent(event); return event;
}

it('restores native selection on user messages and formatted reply text while leaving actions nonselectable', async () => {
  const paragraph = await mount();
  const user = page.getByText('用户发送的普通文字也可以选择').element();
  for (const target of [user, paragraph, ...paragraph.querySelectorAll('strong, em, a')]) {
    expect(getComputedStyle(target).userSelect).toBe('text');
    if (CSS.supports('-webkit-touch-callout', 'default')) expect(getComputedStyle(target).getPropertyValue('-webkit-touch-callout')).toBe('default');
  }
  expect(getComputedStyle(page.getByRole('button', { name: '引用消息' }).all()[0].element()).userSelect).toBe('none');
});

it('lets selection handles move vertically and horizontally without cancelling native defaults or paging away', async () => {
  const paragraph = await mount();
  await page.getByRole('textbox').fill('保留草稿');
  pointer(paragraph, 'pointerdown'); // Native selection may start in an existing touch sequence.
  select(paragraph);
  await expect.element(page.getByRole('button', { name: '引用选中内容', exact: true })).toBeVisible();
  expect(move(paragraph, 180, 170).defaultPrevented).toBe(false);
  expect(move(paragraph, 20, 100).defaultPrevented).toBe(false);
  expect(swiper?.activeIndex).toBe(0);
  pointer(paragraph, 'pointerup');
  pointer(paragraph, 'pointerdown'); // A second gesture starts on a selection handle.
  expect(paragraph.closest(SESSION_NO_SWIPE)).not.toBeNull();
  expect(move(paragraph, 20, 100).defaultPrevented).toBe(false);
  pointer(paragraph, 'pointerup');
  await page.getByRole('button', { name: '引用选中内容', exact: true }).click();
  await expect.element(page.getByRole('button', { name: '移除消息引用' })).toBeVisible();
  await expect.element(page.getByRole('textbox')).toHaveTextContent('保留草稿');
  expect(document.querySelector('.session-chat-composer blockquote')?.textContent).toContain('加粗文字');
  document.dispatchEvent(new Event('selectionchange'));
  expect(document.querySelector('[data-chat-text-selection]')).toBeNull();
});

it('protects native copy in readonly conversations without enabling quote actions', async () => {
  const paragraph = await mount(false); select(paragraph);
  expect(paragraph.closest(SESSION_NO_SWIPE)).not.toBeNull();
  expect(move(paragraph, 20, 170).defaultPrevented).toBe(false);
  expect(page.getByRole('button', { name: '引用选中内容', exact: true }).query()).toBeNull();
  window.getSelection()!.removeAllRanges(); document.dispatchEvent(new Event('selectionchange'));
  expect(document.querySelector('[data-chat-text-selection]')).toBeNull();
});
