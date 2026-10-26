import { createRoot, type Root } from 'react-dom/client';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { Swiper, SwiperSlide } from 'swiper/react';
import type { Swiper as SwiperInstance } from 'swiper';
import 'swiper/css';
import '../../../index.css';
import { SessionWorkspace } from './SessionWorkspace';
import { initializeSessionViewMode } from './sessionViewMode';
import { useTerminalStore } from '../../stores/useTerminalStore';
import { clearChatSnapshots } from './chatSnapshot';
import { readChatEditor, setChatEditorCaret } from './ChatRichEditor';
import { TODO_GUIDANCE } from '../../todos/guidance';
import { SESSION_NO_SWIPE, SESSION_SWIPER_FOCUSABLE_ELEMENTS } from './sessionSwipe';
import { useMediaCompressionPreferences } from '../../terminal/mediaCompressionPreferences';
const compressionUploads = vi.hoisted(() => vi.fn());
vi.mock('../../terminal/api', async original => ({ ...await original<typeof import('../../terminal/api')>(), uploadFiles: compressionUploads }));
const originalMediaPreferences = { ...useMediaCompressionPreferences.getState().preferences };

declare module 'vitest/browser' { interface BrowserCommands { composerTap(selector: string): Promise<void> } }
let root: Root | undefined, swiper: SwiperInstance | undefined, id = '', counter = 0;
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
afterEach(() => {
  root?.unmount(); root = undefined; useTerminalStore.getState().clearAllTerminalSessions(); clearChatSnapshots();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); sessionStorage.clear(); localStorage.clear(); document.body.replaceChildren();
  for (const edge of ['top', 'right', 'bottom', 'left']) document.documentElement.style.removeProperty(`--safe-${edge}-inset`);
  compressionUploads.mockReset(); useMediaCompressionPreferences.setState({ preferences: originalMediaPreferences });
});
async function mount(width = 390, height = 844) {
  await page.viewport(width, height); id = `composer-actions-${++counter}`;
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => String(url).includes('/view-mode')
    ? Response.json({ mode: init?.body ? JSON.parse(String(init.body)).mode : 'chat', chatEligibility: { allowed: true, program: 'codex' } })
    : Response.json({ agentAvailable: true, agent: { displayName: 'Codex', slug: 'codex' }, messages: [] })));
  initializeSessionViewMode(id, 'chat');
  useTerminalStore.getState().setTerminalSession(id, { sessionId: 'backend', mode: 'shell', cols: 100, rows: 30, cwd: '/workspace/current-project' });
  const host = document.createElement('div'); host.id = 'root'; host.style.height = '100dvh'; document.body.append(host);
  function App() {
    const [index, setIndex] = useState(0);
    return <Swiper onSwiper={value => { swiper = value; }} onSlideChange={value => setIndex(value.activeIndex)} speed={0} touchStartPreventDefault={false} noSwipingSelector={SESSION_NO_SWIPE} focusableElements={SESSION_SWIPER_FOCUSABLE_ELEMENTS} className="session-chat-swiper h-full">
      <SwiperSlide><SessionWorkspace sessionId={id} name="当前任务" active={index === 0}>{() => <div />}</SessionWorkspace></SwiperSlide>
      <SwiperSlide><div>另一个会话</div></SwiperSlide>
    </Swiper>;
  }
  root = createRoot(host); root.render(<App />);
  await expect.element(page.getByRole('textbox')).toBeVisible();
  await expect.poll(() => document.querySelector('[data-session-workspace]')?.getAttribute('data-session-input-ready')).toBe('true');
  await frame();
  return document.querySelector<HTMLElement>('[role="textbox"]')!;
}
it.each([390, 320, 1280])('inserts the common todo prompt at the caret with no submission or focus loss at width %i', async width => {
  const editor = await mount(width);
  await page.elementLocator(editor).fill('前文后文'); setChatEditorCaret(editor, 2);
  const blur = vi.fn(); editor.addEventListener('blur', blur);
  await commands.composerTap('[aria-label="更多会话操作"]');
  await expect.element(page.getByRole('menu', { name: '会话操作' })).toBeVisible();
  expect(document.activeElement).toBe(editor); expect(blur).not.toHaveBeenCalled();
  await page.screenshot({ path: `/tmp/termdock-chat-actions-${width}.png` });
  await commands.composerTap('[role="menuitem"]:has-text("插入待办提示")');
  await expect.poll(() => readChatEditor(editor).text).toBe(`前文 ${TODO_GUIDANCE} 后文`);
  expect(document.activeElement).toBe(editor); expect(blur).not.toHaveBeenCalled();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url).split('?')[0].endsWith('/chat') && init?.method === 'POST')).toHaveLength(0);
  expect(swiper?.activeIndex).toBe(0); editor.removeEventListener('blur', blur);
});
it.each([390, 1280])('clears and restores local history from the composer menu without losing the draft at width %i', async width => {
  const editor = await mount(width);
  vi.mocked(fetch).mockImplementation(async () => Response.json({ agentAvailable: true, messages: [{ id: 'old-display', role: 'assistant', content: '保留在服务端的旧记录', createdAt: 1, status: 'stored' }] }));
  window.dispatchEvent(new Event('online'));
  await expect.element(page.getByText('保留在服务端的旧记录', { exact: true })).toBeVisible();
  await page.elementLocator(editor).fill('保留草稿');
  const blur = vi.fn(); editor.addEventListener('blur', blur);
  expect(document.querySelector('[data-session-chat] > [data-chat-clear-display]')).toBeNull();
  await commands.composerTap('[aria-label="更多会话操作"]');
  const clear = page.getByRole('menuitem', { name: '清空显示', exact: true }).element();
  expect(clear.closest('[role="menu"]')).toBeTruthy();
  await commands.composerTap('[role="menuitem"]:has-text("清空显示")');
  await expect.element(page.getByText('保留在服务端的旧记录', { exact: true })).not.toBeInTheDocument();
  expect(readChatEditor(editor).text).toBe('保留草稿'); expect(document.activeElement).toBe(editor); expect(blur).not.toHaveBeenCalled();
  await commands.composerTap('[aria-label="更多会话操作"]');
  await commands.composerTap('[role="menuitem"]:has-text("恢复旧记录")');
  await expect.element(page.getByText('保留在服务端的旧记录', { exact: true })).toBeVisible();
  expect(readChatEditor(editor).text).toBe('保留草稿'); expect(blur).not.toHaveBeenCalled();
  expect(vi.mocked(fetch).mock.calls.some(([url, init]) => init?.method === 'DELETE' || init?.method === 'POST' && String(url).split('?')[0].endsWith('/chat'))).toBe(false);
  editor.removeEventListener('blur', blur);
});
it('keeps a short mobile menu inside the safe area and preserves focus when dismissed outside', async () => {
  const editor = await mount(320, 500); await page.elementLocator(editor).fill('保留这段草稿');
  document.documentElement.style.setProperty('--safe-top-inset', '59px');
  document.documentElement.style.setProperty('--safe-left-inset', '20px'); document.documentElement.style.setProperty('--safe-right-inset', '20px');
  const blur = vi.fn(); editor.addEventListener('blur', blur);
  await commands.composerTap('[aria-label="更多会话操作"]');
  const menu = document.querySelector('[role="menu"]')!;
  const rect = menu.getBoundingClientRect();
  expect(rect.top).toBeGreaterThanOrEqual(67); expect(rect.left).toBeGreaterThanOrEqual(28);
  expect(rect.right).toBeLessThanOrEqual(292);
  expect(document.activeElement).toBe(editor);
  await commands.composerTap('[aria-label="更多会话操作"]');
  expect(document.querySelector('[role="menu"]')).toBeNull();
  await commands.composerTap('[aria-label="更多会话操作"]');
  await commands.composerTap('.session-chat-welcome h2');
  expect(document.querySelector('[role="menu"]')).toBeNull(); expect(document.activeElement).toBe(editor); expect(blur).not.toHaveBeenCalled();
  expect(readChatEditor(editor).text).toBe('保留这段草稿'); editor.removeEventListener('blur', blur);
});
it('uses the current directory and current chat Session for copy and share actions', async () => {
  await mount();
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  await commands.composerTap('[aria-label="更多会话操作"]');
  await commands.composerTap('[role="menuitem"]:has-text("复制当前目录")');
  await expect.poll(() => write.mock.calls[0]?.[0]).toBe('/workspace/current-project');
  const share = vi.fn(); window.addEventListener('termdock:open-services', share);
  try {
    await commands.composerTap('[aria-label="更多会话操作"]');
    await commands.composerTap('[role="menuitem"]:has-text("分享这个会话")');
    expect((share.mock.calls[0][0] as CustomEvent).detail).toEqual({ inviteSessionId: id, viewMode: 'chat' });
  } finally { window.removeEventListener('termdock:open-services', share); }
});
it('supports keyboard selection without opening a second Session or changing the draft', async () => {
  const editor = await mount(1280); await page.elementLocator(editor).fill('不修改草稿');
  const button = document.querySelector<HTMLElement>('[aria-label="更多会话操作"]')!; button.focus();
  await userEvent.keyboard('{ArrowDown}');
  expect(document.activeElement?.textContent).toBe('插入待办提示');
  await userEvent.keyboard('{End}'); expect(document.activeElement?.textContent).toBe('媒体压缩设置');
  await userEvent.keyboard('{Escape}');
  expect(document.querySelector('[role="menu"]')).toBeNull(); expect(document.activeElement).toBe(button);
  expect(readChatEditor(editor).text).toBe('不修改草稿'); expect(swiper?.activeIndex).toBe(0);
});

it.each([320, 390, 1280])('opens device media preferences from chat without changing the draft at width %i', async width => {
  useMediaCompressionPreferences.setState({ preferences: { ...originalMediaPreferences, imageEnabled: false, videoEnabled: false } });
  const editor = await mount(width, 600); await page.elementLocator(editor).fill('保留这段草稿');
  await commands.composerTap('[aria-label="更多会话操作"]');
  await commands.composerTap('[role="menuitem"]:has-text("媒体压缩设置")');
  await expect.element(page.getByRole('dialog', { name: '媒体压缩设置' })).toBeVisible();
  await page.getByRole('checkbox', { name: '压缩图片后上传' }).click();
  await page.getByLabelText('图片最长边').selectOptions('640');
  expect(useMediaCompressionPreferences.getState().preferences).toMatchObject({ imageEnabled: true, imageMaxDimension: 640 });
  const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="媒体压缩设置"]')!, box = dialog.getBoundingClientRect();
  expect(box.left).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(width);
  expect(box.top).toBeGreaterThanOrEqual(0); expect(box.bottom).toBeLessThanOrEqual(600);
  await expect.element(page.getByRole('button', { name: '完成', exact: true })).toBeVisible();
  await page.screenshot({ path: `/tmp/chat-media-settings-${width}.png` });
  await userEvent.keyboard('{Escape}');
  expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(readChatEditor(editor).text).toBe('保留这段草稿');
  expect(vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url).split('?')[0].endsWith('/chat') && init?.method === 'POST')).toHaveLength(0);
});

it('compresses a real local image before uploading and adds the actual encoded attachment', async () => {
  useMediaCompressionPreferences.setState({ preferences: { ...originalMediaPreferences, imageEnabled: true, imageMaxDimension: 640, imageQuality: 0.7 } });
  compressionUploads.mockImplementation(async (_directory, files: File[]) => ({ files: files.map(file => ({ path: `/tmp/${file.name}`, name: file.name, size: file.size })) }));
  const editor = await mount(390); await page.elementLocator(editor).fill('看这张图');
  const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800;
  const context = canvas.getContext('2d')!, pixels = context.createImageData(1200, 800);
  let seed = 7;
  for (let index = 0; index < pixels.data.length; index += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    pixels.data[index] = seed >>> 24; pixels.data[index + 1] = seed >>> 16; pixels.data[index + 2] = seed >>> 8; pixels.data[index + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
  const original = new File([blob], 'noise.png', { type: 'image/png' });
  const clipboardData = new DataTransfer(); clipboardData.items.add(original);
  editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  await expect.poll(() => compressionUploads.mock.calls.length).toBe(1);
  const file = compressionUploads.mock.calls[0][1][0] as File;
  expect(file.name).toMatch(/-compressed\.webp$/); expect(file.type).toBe('image/webp'); expect(file.size).toBeLessThan(original.size);
  const image = new Image(), url = URL.createObjectURL(file);
  try { image.src = url; await image.decode(); expect(image.naturalWidth).toBe(640); } finally { URL.revokeObjectURL(url); }
  await expect.element(page.getByRole('button', { name: `移除附件 ${file.name}` })).toBeVisible();
  expect(readChatEditor(editor).text).toContain('看这张图'); expect(readChatEditor(editor).text).toContain('【图片1】');
});
