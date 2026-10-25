import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import '../../../index.css';
import { SessionWorkspace } from './SessionWorkspace';
import { SessionModeSwitch } from './SessionModeSwitch';
import { TerminalView } from '../views/TerminalView';
import { useTerminalStore } from '../../stores/useTerminalStore';
import { getDefaultTerminalSettings } from '../../terminal/settings';
import { clearChatSnapshots } from './chatSnapshot';
import type { TerminalHandlers } from '../../terminal/types';
import { syncInitialViewportCssVars, useViewportHeight } from '../../hooks/useViewportHeight';
import { Swiper, SwiperSlide } from 'swiper/react';
import 'swiper/css';
import { SESSION_NO_SWIPE, SESSION_SWIPER_FOCUSABLE_ELEMENTS } from './sessionSwipe';
import { readChatEditor } from './ChatRichEditor';

const backend = vi.hoisted(() => ({ connect: vi.fn(), close: vi.fn(), input: vi.fn(), handlers: undefined as TerminalHandlers | undefined }));
vi.mock('../../terminal/factory', () => ({ createTermdockAPI: () => ({
  connect: (_id: string, handlers: TerminalHandlers) => {
    backend.connect(); backend.handlers = handlers;
    queueMicrotask(() => {
      handlers.onEvent({ type: 'connected', mode: 'shell', cwd: '/tmp' });
      handlers.onEvent({ type: 'data', data: '\r\nmobile live output\r\n' });
      handlers.onEvent({ type: 'terminal-output-activity', active: true });
    });
    return { close: backend.close };
  },
  sendInput: async (_id: string, text: string) => backend.input(text),
  resize: async (size: { seq: number; cols: number; rows: number }) => {
    queueMicrotask(() => backend.handlers?.onEvent({ type: 'resize-ack', ok: true, ...size }));
  },
}) }));
declare module 'vitest/browser' { interface BrowserCommands { peekTap(selector: string): Promise<void>; peekTapOutside(): Promise<void>; peekDrag(selector: string, dy: number): Promise<boolean[]> } }
let root: Root | undefined;
afterEach(() => {
  root?.unmount(); root = undefined;
  useTerminalStore.getState().clearAllTerminalSessions(); clearChatSnapshots();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks();
  document.body.replaceChildren(); localStorage.clear(); sessionStorage.clear();
  for (const edge of ['top', 'right', 'bottom', 'left']) document.documentElement.style.removeProperty(`--safe-${edge}-inset`);
  document.documentElement.removeAttribute('style');
  delete document.documentElement.dataset.termdockNativeKeyboard;
  delete document.documentElement.dataset.termdockNativePan;
  delete document.documentElement.dataset.termdockTouchViewport;
});
function NativeViewport() { useViewportHeight(); return null; }
async function mount(width: number, height: number, longReply = false, native = false) {
  await page.viewport(width, height);
  const sessionId = `touch-peek-${width}-${height}`;
  let mode = 'chat';
  const saveMode = vi.fn();
  localStorage.setItem(`termdock:session-view:${location.origin}:${sessionId}`, mode);
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (String(url).includes('/view-mode')) {
      if (init?.body) { mode = JSON.parse(String(init.body)).mode; saveMode(mode); }
      return Response.json({ mode, chatEligibility: { allowed: true, program: 'codex' } });
    }
    if (String(url).includes('/chat')) return Response.json({ agentAvailable: true, agent: { displayName: 'Codex', slug: 'codex' }, replyPending: true, messages: [
      { id: 'user1', role: 'user', content: '检查构建结果', createdAt: 1, status: 'delivered' },
      { id: 'assistant1', role: 'assistant', content: longReply ? '正在检查构建结果，确认手机和桌面的体验。\n\n'.repeat(22) : '正在检查构建结果', createdAt: 2, status: 'stored' },
    ] });
    return Response.json({});
  }));
  useTerminalStore.getState().setTerminalSession(sessionId, { sessionId: 'mobile-backend', mode: 'shell', cols: 100, rows: 32, cwd: '/tmp' });
  const host = document.createElement('div'); host.className = 'flex h-screen flex-col'; document.body.append(host);
  if (native) { syncInitialViewportCssVars(); host.id = 'root'; host.style.height = `${height}px`; }
  root = createRoot(host);
  root.render(<>{native && <NativeViewport />}<header data-termdock-window-header="true" className="relative h-10 shrink-0"><SessionModeSwitch sessionId={sessionId} /></header>
    <main className="min-h-0 flex-1"><Swiper className="h-full" touchStartPreventDefault={false} simulateTouch={false} noSwipingSelector={SESSION_NO_SWIPE} focusableElements={SESSION_SWIPER_FOCUSABLE_ELEMENTS}><SwiperSlide><SessionWorkspace sessionId={sessionId} name="构建检查" active>{(visible, interactive) =>
      <TerminalView sessionId={sessionId} mode="shell" isActive isLayoutVisible={visible} focusSuspended={!interactive} suppressKeyboard={!visible}
        terminalSettings={{ ...getDefaultTerminalSettings(), rendererMode: 'canvas', enableImages: false, fontLigatures: false }} />
    }</SessionWorkspace></SwiperSlide></Swiper></main></>);
  await expect.element(page.getByText('处理中…')).toBeVisible();
  expect(navigator.maxTouchPoints).toBeGreaterThan(0);
  expect(matchMedia('(hover: hover) and (pointer: fine)').matches).toBe(false);
  return { saveMode };
}

it.each([{ width: 390, height: 844 }, { width: 844, height: 390 }])('touch preview keeps chat and the retained live terminal at $width × $height', async ({ width, height }) => {
  const { saveMode } = await mount(width, height);
  const editor = document.querySelector('[data-session-chat] [role="textbox"]') as HTMLElement;
  editor.focus(); await userEvent.keyboard('保留的聊天草稿');
  const input = document.querySelector('textarea[data-terminal-input-anchor]');
  backend.handlers!.onEvent({ type: 'terminal-output-activity', active: false });
  await expect.element(page.getByRole('button', { name: '查看终端详情' })).toBeVisible();
  const trigger = '[data-chat-terminal-access] [data-terminal-peek-trigger]';
  await commands.peekTap(trigger);
  await expect.element(page.getByRole('dialog', { name: '会话终端预览' })).toBeVisible();
  const panel = document.querySelector('[data-terminal-peek]')!;
  expect(document.activeElement).toBe(editor);
  expect(saveMode).not.toHaveBeenCalled();
  expect(panel.querySelector('textarea[data-terminal-input-anchor]')).toBe(input);
  await expect.poll(() => panel.querySelector('.xterm-rows')?.textContent).toContain('mobile live output');
  backend.handlers!.onEvent({ type: 'data', data: '\r\nstill working in preview\r\n' });
  await expect.poll(() => panel.querySelector('.xterm-rows')?.textContent).toContain('still working in preview');
  const rect = panel.getBoundingClientRect();
  expect(rect.left).toBeGreaterThanOrEqual(12); expect(rect.top).toBeGreaterThanOrEqual(12);
  expect(rect.right).toBeLessThanOrEqual(innerWidth - 12); expect(rect.bottom).toBeLessThanOrEqual(innerHeight - 12);
  expect(backend.input).not.toHaveBeenCalled();
  await page.screenshot({ path: `/tmp/termdock-terminal-peek-touch-${width}.png` });
  await commands.peekTap(trigger);
  await expect.poll(() => document.querySelector('[data-terminal-peek]')).toBeNull();
  expect(document.activeElement).toBe(editor);
  expect(saveMode).not.toHaveBeenCalled();
  await commands.peekTap(trigger);
  await expect.element(page.getByRole('dialog', { name: '会话终端预览' })).toBeVisible();
  await commands.peekTap('[aria-label="关闭终端预览"]');
  await expect.poll(() => document.querySelector('[data-terminal-peek]')).toBeNull();
  expect(editor.textContent).toBe('保留的聊天草稿');
  await commands.peekTap(trigger);
  await commands.peekTapOutside();
  await expect.poll(() => document.querySelector('[data-terminal-peek]')).toBeNull();
  await commands.peekTap(trigger);
  await commands.peekTap('[aria-label="在完整会话中打开终端"]');
  await expect.poll(() => document.querySelector('[data-terminal-peek]')).toBeNull();
  await expect.element(page.getByRole('button', { name: '切换到对话' })).toBeVisible();
  expect(saveMode).toHaveBeenCalledWith('terminal');
  expect(document.querySelector('textarea[data-terminal-input-anchor]')).toBe(input);
  expect(backend.connect).toHaveBeenCalledTimes(1); expect(backend.close).not.toHaveBeenCalled();
});

const safeLayouts = [
  { name: 'portrait', width: 390, height: 844, top: 59, right: 0, bottom: 34, left: 0 },
  { name: 'landscape', width: 844, height: 390, top: 0, right: 59, bottom: 21, left: 59 },
  { name: 'short-landscape', width: 568, height: 320, top: 38, right: 44, bottom: 34, left: 44 },
  { name: 'desktop-titlebar', width: 1280, height: 900, top: 38, right: 0, bottom: 0, left: 0 },
];
it.each(safeLayouts)('keeps an oversized saved preview and its controls inside the $name safe area', async layout => {
  await mount(layout.width, layout.height, true);
  for (const edge of ['top', 'right', 'bottom', 'left'] as const) document.documentElement.style.setProperty(`--safe-${edge}-inset`, `${layout[edge]}px`);
  localStorage.setItem('termdock:terminal-peek-size', JSON.stringify({ width: 2000, height: 1500 }));
  const input = document.querySelector('textarea[data-terminal-input-anchor]');
  await commands.peekTap('[data-chat-terminal-access] [data-terminal-peek-trigger]');
  await expect.element(page.getByRole('dialog', { name: '会话终端预览' })).toBeVisible();
  const panel = document.querySelector('[data-terminal-peek]')!;
  const check = (top = layout.top) => {
    for (const node of [panel, panel.querySelector('header')!, panel.querySelector('[aria-label="关闭终端预览"]')!, panel.querySelector('[aria-label="在完整会话中打开终端"]')!, panel.querySelector('[aria-label="调整终端预览大小"]')!]) {
      const rect = node.getBoundingClientRect();
      expect(rect.width).toBeGreaterThan(0); expect(rect.height).toBeGreaterThan(0);
      expect(rect.top).toBeGreaterThanOrEqual(top + 12 - .5);
      expect(rect.left).toBeGreaterThanOrEqual(layout.left + 12 - .5);
      expect(rect.right).toBeLessThanOrEqual(layout.width - layout.right - 12 + .5);
      expect(rect.bottom).toBeLessThanOrEqual(layout.height - layout.bottom - 12 + .5);
    }
  };
  check();
  await page.screenshot({ path: `/tmp/termdock-terminal-peek-safe-${layout.name}.png` });
  const grip = panel.querySelector<HTMLElement>('[aria-label="调整终端预览大小"]')!;
  grip.focus(); await userEvent.keyboard('{ArrowDown}{ArrowRight}'); check();
  document.documentElement.style.setProperty('--safe-top-inset', `${layout.top + 12}px`);
  await expect.poll(() => panel.getBoundingClientRect().top).toBeGreaterThanOrEqual(layout.top + 24 - .5);
  check(layout.top + 12);
  expect(document.querySelector('textarea[data-terminal-input-anchor]')).toBe(input);
  expect(backend.connect).toHaveBeenCalledTimes(1); expect(backend.close).not.toHaveBeenCalled();
  await commands.peekTap('[aria-label="关闭终端预览"]');
  await expect.poll(() => document.querySelector('[data-terminal-peek]')).toBeNull();
});

it('toggles a touch preview even when a connected mouse makes hover available', async () => {
  await mount(390, 844);
  const media = window.matchMedia.bind(window);
  vi.spyOn(window, 'matchMedia').mockImplementation(query => query === '(hover: hover) and (pointer: fine)' ? { matches: true } as MediaQueryList : media(query));
  const selector = '[data-chat-terminal-access] [data-terminal-peek-trigger]';
  for (const open of [true, false, true, false]) {
    await commands.peekTap(selector);
    await expect.poll(() => !!document.querySelector('[data-terminal-peek]')).toBe(open);
    expect(document.querySelector(selector)?.getAttribute('aria-expanded')).toBe(String(open));
  }
  expect(backend.connect).toHaveBeenCalledTimes(1); expect(backend.close).not.toHaveBeenCalled();
  expect(backend.input).not.toHaveBeenCalled();
});

it('automatically closes a touch-opened preview after three idle seconds, even with live output', async () => {
  await mount(390, 844);
  const editor = document.querySelector<HTMLElement>('[data-session-chat] [role="textbox"]')!;
  editor.focus(); await userEvent.keyboard('自动收起仍保留草稿');
  const input = document.querySelector('textarea[data-terminal-input-anchor]');
  await commands.peekTap('[data-chat-terminal-access] [data-terminal-peek-trigger]');
  await expect.element(page.getByRole('dialog', { name: '会话终端预览' })).toBeVisible();
  const started = performance.now();
  while (performance.now() - started < 3200) {
    backend.handlers!.onEvent({ type: 'data', data: '\r\ncontinuous agent output\r\n' });
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  expect(document.querySelector('[data-terminal-peek]')).toBeNull();
  expect(document.activeElement).toBe(editor); expect(editor.textContent).toBe('自动收起仍保留草稿');
  expect(document.querySelector('textarea[data-terminal-input-anchor]')).toBe(input);
  expect(backend.connect).toHaveBeenCalledOnce(); expect(backend.close).not.toHaveBeenCalled(); expect(backend.input).not.toHaveBeenCalled();
});

it('hides the countdown after a real touch and keeps the preview open until dismissed', async () => {
  await mount(390, 844);
  await commands.peekTap('[data-chat-terminal-access] [data-terminal-peek-trigger]');
  await expect.element(page.getByText('3 秒后收起', { exact: true })).toBeVisible();
  await expect.poll(() => document.querySelector('[data-terminal-peek-countdown]')?.textContent, { timeout: 3000 }).toBe('1 秒后收起');
  const countdown = document.querySelector('[data-terminal-peek-countdown]')!;
  expect(getComputedStyle(countdown).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(getComputedStyle(countdown).color).not.toBe(getComputedStyle(countdown.parentElement!).color);
  const header = document.querySelector('[data-terminal-peek] header')!.getBoundingClientRect();
  for (const node of document.querySelectorAll('[data-terminal-peek] header > span, [data-terminal-peek] header button')) {
    const rect = node.getBoundingClientRect(); expect(rect.left).toBeGreaterThanOrEqual(header.left); expect(rect.right).toBeLessThanOrEqual(header.right);
  }
  await page.screenshot({ path: '/tmp/termdock-peek-3s/mobile-countdown.png' });
  await commands.peekTap('[data-terminal-peek] header');
  await expect.poll(() => document.querySelector('[data-terminal-peek-countdown]')).toBeNull();
  await new Promise(resolve => setTimeout(resolve, 3300));
  expect(document.querySelector('[data-terminal-peek]')).not.toBeNull();
  expect(document.querySelector('[data-terminal-peek-countdown]')).toBeNull();
  await commands.peekTap('[data-chat-terminal-access] [data-terminal-peek-trigger]');
  await expect.poll(() => document.querySelector('[data-terminal-peek]')).toBeNull();
  await commands.peekTap('[data-chat-terminal-access] [data-terminal-peek-trigger]');
  await expect.element(page.getByText('3 秒后收起', { exact: true })).toBeVisible();
  expect(backend.input).not.toHaveBeenCalled(); expect(backend.connect).toHaveBeenCalledOnce();
});

it.each([
  { width: 390, height: 844, keyboardHeight: 430 },
  { width: 844, height: 390, keyboardHeight: 250 },
  { width: 390, height: 844, keyboardHeight: 430, alreadyOpen: true },
  { width: 390, height: 844, keyboardHeight: 430, native: false },
  { width: 390, height: 844, keyboardHeight: 430, staleInnerHeight: true },
])('reclaims the chat composer space for terminal input ($width × $height, already open $alreadyOpen, native $native, stale layout $staleInnerHeight)', async ({ width, height, keyboardHeight, alreadyOpen, native = true, staleInnerHeight }) => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(native ? 'iPhone' : 'Mozilla/5.0 (Linux; Android 15) Mobile Safari/537.36');
  const viewport = Object.assign(new EventTarget(), { height, width, offsetTop: native ? 88 : 0, offsetLeft: 0, scale: 1 });
  vi.stubGlobal('visualViewport', viewport);
  await mount(width, height, false, native);
  const reportKeyboard = async (visible: number) => {
    viewport.height = visible;
    document.documentElement.style.setProperty('--app-base-vh', `${height}px`);
    document.documentElement.style.setProperty('--kb-height', `${height - visible}px`);
    await page.viewport(width, visible);
    viewport.dispatchEvent(new Event('resize'));
    document.dispatchEvent(new CustomEvent('termdock:viewport-keyboard-change', { detail: { isOpen: visible < height } }));
  };
  const editor = document.querySelector<HTMLElement>('[data-session-chat] [role="textbox"]')!;
  const draft = alreadyOpen ? '保留多行聊天草稿\n'.repeat(6) : '保留聊天草稿';
  await page.getByRole('textbox').fill(draft);
  const originalDraft = readChatEditor(editor).text;
  expect(originalDraft.trimEnd()).toBe(draft.trimEnd());
  if (alreadyOpen) { await reportKeyboard(keyboardHeight); editor.focus(); if (native) editor.scrollIntoView({ block: 'end' }); }
  await commands.peekTap('[data-chat-terminal-access] [data-terminal-peek-trigger]');
  await expect.element(page.getByRole('dialog', { name: '会话终端预览' })).toBeVisible();
  const panel = document.querySelector<HTMLElement>('[data-terminal-peek]')!;
  const input = panel.querySelector<HTMLTextAreaElement>('textarea[data-terminal-input-anchor]')!;
  const workspace = document.querySelector('[data-session-workspace]')!;
  const mode = localStorage.getItem(`termdock:session-view:${location.origin}:touch-peek-${width}-${height}`);
  await commands.peekTap(native ? '[data-terminal-touch-surface]' : '[data-terminal-peek] textarea[data-terminal-input-anchor]');
  await expect.poll(() => document.activeElement).toBe(input);
  if (!alreadyOpen) expect(panel.hasAttribute('data-terminal-peek-input-expanded')).toBe(false);
  await reportKeyboard(keyboardHeight);
  await expect.element(page.getByRole('button', { name: '返回对话', exact: true })).toBeVisible();
  if (native) input.scrollIntoView({ block: 'end', inline: 'nearest' });
  await expect.poll(() => panel.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
  const back = panel.querySelector<HTMLElement>('[aria-label="返回对话"]')!;
  expect(back.scrollWidth).toBeLessThanOrEqual(back.clientWidth);
  expect(back.getBoundingClientRect().height).toBeLessThanOrEqual(panel.querySelector('header')!.getBoundingClientRect().height);
  expect(panel.querySelector('header')!.textContent).not.toContain('构建检查');
  expect(getComputedStyle(panel.querySelector('section')!).borderRadius).toBe('0px');
  expect(panel.getBoundingClientRect().left).toBe(0);
  expect(panel.getBoundingClientRect().right).toBe(width);
  expect(document.elementFromPoint(width / 2, document.querySelector('[data-chat-composer]')!.getBoundingClientRect().top + 8)?.closest('[data-terminal-peek]')).toBe(panel);
  if (staleInnerHeight) vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(220);
  const blur = vi.fn(); input.addEventListener('blur', blur);
  for (const visibleHeight of [keyboardHeight, height, keyboardHeight + 10, height, keyboardHeight - 10]) {
    const open = visibleHeight < height;
    if (open && document.activeElement !== input) await commands.peekTap('[data-terminal-peek] textarea[data-terminal-input-anchor]');
    await reportKeyboard(visibleHeight);
    await expect.poll(() => panel.hasAttribute('data-terminal-peek-input-expanded')).toBe(open);
    if (native && open) {
      // Chromium does not open an OS keyboard or pan an already focused field
      // on viewport resize. Exercise its actual document scrolling for the
      // same input to model WebKit's native pan, without blur or replacement.
      input.scrollIntoView({ block: 'end', inline: 'nearest' });
    }
    await expect.poll(() => document.querySelector('[data-terminal-peek]')).toBe(panel);
    await expect.poll(() => input.getBoundingClientRect().bottom).toBeLessThanOrEqual(visibleHeight);
    await expect.poll(() => panel.querySelector('.xterm-screen')!.getBoundingClientRect().height).toBeGreaterThan(24);
    await expect.poll(() => panel.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
    if (open) {
      await expect.poll(() => Math.abs(panel.getBoundingClientRect().bottom - workspace.getBoundingClientRect().bottom)).toBeLessThanOrEqual(1);
      const composerBottom = document.querySelector('[data-chat-composer]')!.getBoundingClientRect().bottom;
      if (composerBottom <= visibleHeight) expect(document.elementFromPoint(width / 2, composerBottom - 2)?.closest('[data-terminal-peek]')).toBe(panel);
    } else {
      await expect.element(page.getByRole('button', { name: '调整终端预览大小' })).toBeVisible();
      expect(getComputedStyle(panel.querySelector('section')!).borderRadius).not.toBe('0px');
    }
    const canvas = panel.querySelector('.xterm-screen')!.getBoundingClientRect();
    expect(canvas.top).toBeGreaterThanOrEqual(panel.querySelector('header')!.getBoundingClientRect().bottom);
    await expect.poll(() => panel.querySelector('.xterm-screen')!.getBoundingClientRect().bottom - panel.querySelector(native ? '[data-native-terminal-input-host]' : '[data-mobile-keyboard]')!.getBoundingClientRect().top).toBeLessThanOrEqual(1);
    const key = panel.querySelector('[data-mobile-keyboard] button')!.getBoundingClientRect();
    expect(key.height).toBeGreaterThan(0);
    expect(key.bottom).toBeLessThanOrEqual(visibleHeight + 1);
    expect(document.elementFromPoint(key.left + key.width / 2, key.top + key.height / 2)?.closest('[data-mobile-keyboard]')).not.toBeNull();
    if (native) { expect(document.activeElement).toBe(input); expect(blur).not.toHaveBeenCalled(); }
  }
  await page.screenshot({ element: panel, path: `/tmp/td-keyboard-review/immersive-preview-keyboard-${native ? 'native' : 'compat'}-${width}${staleInnerHeight ? '-stale' : ''}.png` });
  await page.elementLocator(input).fill('pwd');
  await expect.poll(() => backend.input.mock.calls.map(call => call[0]).join('')).toContain('pwd');
  expect(readChatEditor(editor).text).toBe(originalDraft);
  expect(backend.connect).toHaveBeenCalledOnce(); expect(backend.close).not.toHaveBeenCalled();
  input.removeEventListener('blur', blur);
  await commands.peekTap('[aria-label="返回对话"]');
  await expect.poll(() => document.querySelector('[data-terminal-peek]')).toBeNull();
  expect(document.querySelector('[data-session-chat] [role="textbox"]')).toBe(editor);
  expect(readChatEditor(editor).text).toBe(originalDraft);
  expect(document.activeElement).toBe(editor);
  expect(localStorage.getItem(`termdock:session-view:${location.origin}:touch-peek-${width}-${height}`)).toBe(mode);
  expect(document.querySelector('textarea[data-terminal-input-anchor]')).toBe(input);
});

it.each([
  { width: 390, height: 844, visible: 430, native: true },
  { width: 844, height: 390, visible: 260, native: true },
  { width: 390, height: 844, visible: 430, native: false },
])('restores the bubble on keyboard close and preserves native input focus ($width × $height, native $native)', async ({ width, height, visible, native }) => {
  const viewport = Object.assign(new EventTarget(), { height, width, offsetTop: 0, offsetLeft: 0, scale: 1 });
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(native ? 'iPhone' : 'Mozilla/5.0 (Linux; Android 15) Mobile Safari/537.36');
  vi.stubGlobal('visualViewport', viewport);
  await mount(width, height, false, native);
  const editor = document.querySelector<HTMLElement>('[data-session-chat] [role="textbox"]')!;
  await page.getByRole('textbox').fill('收键盘后保留的草稿');
  const savedSize = JSON.stringify({ width: 340, height: 210 });
  localStorage.setItem('termdock:terminal-peek-size', savedSize);
  await commands.peekTap('[data-chat-terminal-access] [data-terminal-peek-trigger]');
  const panel = document.querySelector<HTMLElement>('[data-terminal-peek]')!;
  const bubble = panel.getBoundingClientRect();
  const input = panel.querySelector<HTMLTextAreaElement>('textarea[data-terminal-input-anchor]')!;
  const blur = vi.fn(), focusEvent = vi.fn();
  input.addEventListener('blur', blur); input.addEventListener('focus', focusEvent);
  const setKeyboard = async (open: boolean) => {
    viewport.height = open ? visible : height;
    document.documentElement.style.setProperty('--app-base-vh', `${height}px`);
    document.documentElement.style.setProperty('--kb-height', `${open ? height - visible : 0}px`);
    await page.viewport(width, open ? visible : height);
    viewport.dispatchEvent(new Event('resize'));
    document.dispatchEvent(new CustomEvent('termdock:viewport-keyboard-change', { detail: { isOpen: open } }));
  };
  for (let cycle = 0; cycle < 2; cycle++) {
    await commands.peekTap(native ? '[data-terminal-touch-surface]' : '[data-terminal-peek] textarea[data-terminal-input-anchor]');
    await expect.poll(() => document.activeElement).toBe(input);
    await setKeyboard(true);
    if (native) input.scrollIntoView({ block: 'end', inline: 'nearest' });
    await expect.poll(() => panel.hasAttribute('data-terminal-peek-input-expanded')).toBe(true);
    const focus = vi.spyOn(input, 'focus');
    focusEvent.mockClear();
    await setKeyboard(false);
    await expect.poll(() => panel.hasAttribute('data-terminal-peek-input-expanded')).toBe(false);
    await expect.element(page.getByRole('button', { name: '调整终端预览大小' })).toBeVisible();
    await expect.poll(() => panel.getBoundingClientRect().width).toBe(bubble.width);
    await expect.poll(() => panel.getBoundingClientRect().height).toBe(bubble.height);
    expect(getComputedStyle(panel.querySelector('section')!).borderRadius).not.toBe('0px');
    if (native) {
      expect(document.activeElement).toBe(input);
      expect(blur).not.toHaveBeenCalled();
    }
    expect(focus).not.toHaveBeenCalled(); expect(focusEvent).not.toHaveBeenCalled();
    focus.mockRestore();
    expect(localStorage.getItem('termdock:terminal-peek-size')).toBe(savedSize);
    expect(readChatEditor(editor).text).toBe('收键盘后保留的草稿');
    expect(panel.querySelector('textarea[data-terminal-input-anchor]')).toBe(input);
    expect(backend.connect).toHaveBeenCalledOnce(); expect(backend.close).not.toHaveBeenCalled();
  }
  input.removeEventListener('blur', blur); input.removeEventListener('focus', focusEvent);
  await commands.peekTap('[aria-label="关闭终端预览"]');
  await expect.poll(() => document.querySelector('[data-terminal-peek]')).toBeNull();
});

it.each([
  { name: 'phone with keyboard closed', ua: 'iPhone', width: 390, height: 844, native: true, keyboardOpen: false },
  { name: 'phone with chat keyboard open', ua: 'iPhone', width: 390, height: 844, native: true, keyboardOpen: true },
  { name: 'landscape phone with keyboard closed', ua: 'iPhone', width: 844, height: 390, native: true, keyboardOpen: false },
  { name: 'touchscreen desktop', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', width: 390, height: 844, native: false, keyboardOpen: true },
  { name: 'iPad', ua: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)', width: 768, height: 1024, native: true, keyboardOpen: true },
])('keeps a bubble throughout terminal scrolling on a $name', async ({ ua, width, height, native, keyboardOpen }) => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
  const viewport = Object.assign(new EventTarget(), { height, width, offsetTop: 0, offsetLeft: 0, scale: 1 });
  vi.stubGlobal('visualViewport', viewport);
  await mount(width, height, false, native);
  await page.getByRole('textbox').fill('滚动不能展开终端');
  if (keyboardOpen) {
    viewport.height = height - 300;
    document.documentElement.style.setProperty('--app-base-vh', `${height}px`);
    document.documentElement.style.setProperty('--kb-height', '300px');
    viewport.dispatchEvent(new Event('resize'));
    document.dispatchEvent(new CustomEvent('termdock:viewport-keyboard-change', { detail: { isOpen: true } }));
  }
  await commands.peekTap('[data-chat-terminal-access] [data-terminal-peek-trigger]');
  const panel = document.querySelector<HTMLElement>('[data-terminal-peek]')!;
  const input = panel.querySelector<HTMLTextAreaElement>('textarea[data-terminal-input-anchor]')!;
  const focus = vi.spyOn(input, 'focus');
  const target = native ? '[data-terminal-touch-surface]' : '[data-terminal-peek] textarea[data-terminal-input-anchor]';
  expect(await commands.peekDrag(target, -40)).not.toContain(true);
  expect(panel.hasAttribute('data-terminal-peek-input-expanded')).toBe(false);
  expect(focus).not.toHaveBeenCalled();
  expect(backend.input).not.toHaveBeenCalled();
  if (!keyboardOpen || !/iPhone/.test(ua)) {
    await commands.peekTap(target);
    await expect.poll(() => document.activeElement).toBe(input);
    expect(panel.hasAttribute('data-terminal-peek-input-expanded')).toBe(false);
  }
  focus.mockRestore();
  expect(backend.connect).toHaveBeenCalledOnce(); expect(backend.close).not.toHaveBeenCalled();
});
