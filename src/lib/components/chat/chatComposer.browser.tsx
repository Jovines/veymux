import { useTerminalStore } from '../../stores/useTerminalStore';
import { createRoot, type Root } from 'react-dom/client';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { Swiper, SwiperSlide } from 'swiper/react';
import type { Swiper as SwiperInstance } from 'swiper';
import 'swiper/css';
import '../../../index.css';
import { SessionChatView } from './SessionChatView';
import { SESSION_NO_SWIPE, SESSION_SWIPER_FOCUSABLE_ELEMENTS } from './sessionSwipe';
import { clearChatSnapshots } from './chatSnapshot';
import { composeChatDraft } from './chatComposerContent';
import { readChatEditor, setChatEditorCaret } from './ChatRichEditor';
import { useSessionDirectoryStore } from '../../stores/useSessionDirectory';
import { uploadFiles } from '../../terminal/api';
const peerMentions = vi.hoisted(() => ({ sessions: [] as unknown[] }));
vi.mock('../../terminal/api', async original => ({ ...await original<typeof import('../../terminal/api')>(),
  listCollaborationGroups: async () => ({ groups: [{ id: 'team', name: '界面打磨', sessionIds: ['browser-composer', 'worker'] }], sessions: peerMentions.sessions }),
  subscribeCollaborationGroups: () => () => {},
  uploadFiles: vi.fn(async () => ({ files: [{ path: '/tmp/pasted.png' }] })),
}));

declare module 'vitest/browser' {
  interface BrowserCommands { touchDrag(selector: string, dx: number, dy: number): Promise<void> }
}

let root: Root | undefined, swiper: SwiperInstance | undefined;
afterEach(async () => { root?.unmount(); root = undefined; useTerminalStore.getState().clearAllTerminalSessions(); clearChatSnapshots(); sessionStorage.clear(); vi.unstubAllGlobals(); document.body.replaceChildren(); useSessionDirectoryStore.getState().replace([]); await page.viewport(390, 844); });
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
async function mount(messages: object[] = [], agent?: { displayName: string; slug: string }) {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ agentAvailable: true, messages, agent })));
  const host = document.createElement('div'); host.style.height = '100dvh'; document.body.append(host);
  function App() {
    const [index, setIndex] = useState(0);
    return <Swiper onSwiper={value => { swiper = value; }} onSlideChange={value => setIndex(value.activeIndex)} speed={0} touchStartPreventDefault={false} noSwipingSelector={SESSION_NO_SWIPE} focusableElements={SESSION_SWIPER_FOCUSABLE_ELEMENTS} className="session-chat-swiper h-full">
      <SwiperSlide><SessionChatView sessionId="browser-composer" active={index === 0} onTerminal={() => {}} /></SwiperSlide>
      <SwiperSlide><div>第二个 Session</div></SwiperSlide>
    </Swiper>;
  }
  root = createRoot(host); root.render(<App />);
  await expect.element(page.getByRole('textbox')).toBeVisible(); await frame();
}
it('switches Sessions with a native touch swipe on the empty conversation canvas', async () => {
  await mount(); await expect.element(page.getByText('想一起完成什么？')).toBeVisible();
  await commands.touchDrag('.session-chat-scroll', -240, 2);
  await expect.poll(() => swiper?.activeIndex).toBe(1);
  await commands.touchDrag('.swiper-slide-active', 240, 2);
  await expect.poll(() => swiper?.activeIndex).toBe(0);
});
it('switches Sessions from the composer while keeping vertical history scrolling local', async () => {
  await mount(Array.from({ length: 30 }, (_, index) => ({ id: `m${index}`, role: 'user', content: `消息 ${index}\n多行正文\n继续阅读`, createdAt: index, status: 'stored' })));
  await commands.touchDrag('[data-chat-composer]', -220, 2);
  await expect.poll(() => swiper?.activeIndex).toBe(1);
  await commands.touchDrag('.swiper-slide-active', 220, 2);
  await expect.poll(() => swiper?.activeIndex).toBe(0);
  await page.getByRole('textbox').fill('正在编辑的草稿');
  await commands.touchDrag('[role="textbox"]', -220, 1);
  await expect.poll(() => swiper?.activeIndex).toBe(1);
  await commands.touchDrag('.swiper-slide-active', 220, 1);
  await expect.poll(() => swiper?.activeIndex).toBe(0);
  const scroll = document.querySelector('.session-chat-scroll')!;
  scroll.scrollTop = 500; await frame(); const initial = scroll.scrollTop;
  await commands.touchDrag('.session-chat-scroll', 1, -160);
  await expect.poll(() => scroll.scrollTop).toBeGreaterThan(initial);
  expect(swiper?.activeIndex).toBe(0);
  await commands.touchDrag('.session-chat-scroll', -240, 1);
  await expect.poll(() => swiper?.activeIndex).toBe(1);
});
it('scrolls code horizontally without switching the Session', async () => {
  await page.viewport(390, 844);
  await mount([{ id: 'code', role: 'assistant', content: `\`\`\`text\n${'long_code_line_'.repeat(40)}\n\`\`\``, createdAt: 1, status: 'stored' }]);
  await expect.element(page.getByRole('code')).toBeVisible();
  const pre = document.querySelector('pre')!;
  expect(pre.scrollWidth).toBeGreaterThan(pre.clientWidth);
  await commands.touchDrag('[data-session-chat] pre', -200, 1);
  await expect.poll(() => pre.scrollLeft).toBeGreaterThan(0);
  expect(swiper?.activeIndex).toBe(0);
});
it.each([390, 1280])('keeps attachments, the editor and send action visible at width %i', async width => {
  await page.viewport(width, 844);
  const files = [{ path: '/tmp/cover.png', name: '界面截图.png', type: 'image/png', size: 12000 }, { path: '/tmp/demo.mov', name: '操作演示.mov', type: 'video/quicktime', size: 2000000 }];
  sessionStorage.setItem(`termdock:chat:${location.origin}:browser-composer:extras`, composeChatDraft('', files, []));
  await mount(); await expect.element(page.getByRole('button', { name: '移除附件 操作演示.mov' })).toBeVisible();
  const composer = document.querySelector('[data-chat-composer]')!.getBoundingClientRect();
  expect(composer.top).toBeGreaterThan(500); expect(composer.bottom).toBeLessThanOrEqual(844);
  const editor = (document.querySelector('[role="textbox"]') as HTMLElement).getBoundingClientRect(), toolbar = document.querySelector('[data-chat-composer-toolbar]')!.getBoundingClientRect();
  expect(editor.width).toBeGreaterThan(composer.width * .9); expect(toolbar.top).toBeGreaterThanOrEqual(editor.bottom);
  expect(readChatEditor(document.querySelector('[role="textbox"]') as HTMLElement).text).toBe('【图片1】 【视频2】');
  await expect.element(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
  await page.screenshot({ path: `/tmp/chat-composer-${width}.png` });
  await page.getByRole('button', { name: '移除附件 界面截图.png' }).click();
  await expect.element(page.getByRole('button', { name: '移除附件 界面截图.png' })).not.toBeInTheDocument();
});
it('keeps the member picker above the composer and selects without sending', async () => {
  useSessionDirectoryStore.getState().replace([{ sessionId: 'worker', name: '设计助手', customName: true, cwd: '/project/ui', lastActivity: 1, agent: { slug: 'codex', displayName: 'Codex', accentColor: 'var(--primary)', icon: null } }]);
  await mount(); await page.getByRole('button', { name: '提及协作成员' }).click();
  await expect.element(page.getByRole('option')).toBeVisible();
  const menu = document.querySelector('[role="listbox"]')!.getBoundingClientRect(), composer = document.querySelector('[data-chat-composer]')!.getBoundingClientRect();
  expect(menu.top).toBeGreaterThanOrEqual(0); expect(menu.bottom).toBeLessThanOrEqual(composer.top);
  await commands.touchDrag('[role="listbox"]', -160, 2); expect(swiper?.activeIndex).toBe(0);
  await page.screenshot({ path: '/tmp/chat-composer-mentions.png' });
  await page.getByRole('option').click();
  await expect.element(page.getByRole('listbox')).not.toBeInTheDocument();
  expect(readChatEditor(document.querySelector('[role="textbox"]') as HTMLElement).text).toContain('设计助手');
  expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});
it('renders independent inline attachment chips between editable prose', async () => {
  const files = [{ path: '/tmp/a.png', name: '第一张.png', type: 'image/png', reference: '图片1' }, { path: '/tmp/b.png', name: '第二张.png', type: 'image/png', reference: '图片2' }];
  const text = '请对比这张【图片1】与这张【图片2】，说明差别。';
  sessionStorage.setItem(`termdock:chat:${location.origin}:browser-composer:draft`, text);
  sessionStorage.setItem(`termdock:chat:${location.origin}:browser-composer:extras`, composeChatDraft(text, files, []));
  await mount(); const editor = document.querySelector('[role="textbox"]') as HTMLElement;
  expect(readChatEditor(editor).text).toBe(text);
  expect(editor.querySelectorAll('[data-chat-inline-token][contenteditable="false"]')).toHaveLength(2);
  expect(editor.getBoundingClientRect().width).toBeGreaterThan(document.querySelector('[data-chat-composer]')!.clientWidth * .9);
  await page.screenshot({ path: '/tmp/chat-composer-inline.png' });
  await page.getByRole('textbox').fill(text.repeat(15)); await frame();
  expect(editor.scrollHeight).toBeGreaterThan(editor.clientHeight);
  expect(readChatEditor(editor).text).toBe(text.repeat(15));
});
it('uses the mobile return key for a newline and the send button for sending', async () => {
  await mount(); await page.getByRole('textbox').fill('第一行');
  await userEvent.keyboard('{End}{Enter}');
  expect(readChatEditor(document.querySelector('[role="textbox"]') as HTMLElement).text).toBe('第一行\n');
  expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});

it.each([390, 1280])('keeps inline attachments in place through sending at width %i', async width => {
  await page.viewport(width, 844);
  const files = [{ path: '/tmp/one.png', name: '截图.png', type: 'image/png', reference: '图片1' }];
  const text = '请看【图片1】这里的间距';
  sessionStorage.setItem(`termdock:chat:${location.origin}:browser-composer:draft`, text);
  sessionStorage.setItem(`termdock:chat:${location.origin}:browser-composer:extras`, composeChatDraft(text, files, []));
  await mount();
  const editor = document.querySelector('[role="textbox"]') as HTMLElement;
  const chip = editor.querySelector<HTMLElement>('[data-chat-inline-token]')!;
  const before = chip.getBoundingClientRect(), beforeFont = getComputedStyle(chip).fontSize;
  const saved: object[] = [];
  vi.mocked(fetch).mockImplementation(async (_url, init) => {
    if (init?.method === 'POST') {
      const { content } = JSON.parse(String(init.body));
      const message = { id: 'sent-inline', role: 'user', content, createdAt: Date.now(), status: 'delivered' };
      saved.push(message);
      return Response.json(message);
    }
    return Response.json({ agentAvailable: true, messages: saved });
  });
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.element(page.getByRole('group', { name: '附件 图片1 · 截图.png' })).toBeVisible();
  const bubble = document.querySelector('[data-chat-user-bubble]')!;
  const sentChip = bubble.querySelector<HTMLElement>('[data-chat-inline-token]')!;
  expect(sentChip.previousSibling?.textContent).toBe('请看');
  expect(sentChip.nextSibling?.textContent).toBe('这里的间距');
  expect(bubble.querySelector('ul')).toBeNull();
  expect(sentChip.getBoundingClientRect().height).toBe(before.height);
  expect(getComputedStyle(sentChip).fontSize).toBe(beforeFont);
  expect(document.querySelector('.session-chat-scroll')!.scrollWidth).toBe(document.querySelector('.session-chat-scroll')!.clientWidth);
  await page.screenshot({ path: `/tmp/chat-inline-sent-${width}.png` });
});

it.each([390, 1280])('previews a picture while editing and after sending at width %i', async width => {
  await page.viewport(width, 844);
  const files = [{ path: '/tmp/preview.png', name: '预览图.png', type: 'image/png', reference: '图片1' }];
  const text = '看看【图片1】间距';
  sessionStorage.setItem(`termdock:chat:${location.origin}:browser-composer:draft`, text);
  sessionStorage.setItem(`termdock:chat:${location.origin}:browser-composer:extras`, composeChatDraft(text, files, []));
  await mount();
  const saved: object[] = [];
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (String(url).includes('/api/terminal/fs/blob?')) {
      const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jv10AAAAASUVORK5CYII='), char => char.charCodeAt(0));
      return new Response(png, { headers: { 'Content-Type': 'image/png' } });
    }
    if (init?.method === 'POST') {
      const { content } = JSON.parse(String(init.body));
      const message = { id: 'preview-sent', role: 'user', content, createdAt: Date.now(), status: 'delivered' };
      saved.push(message); return Response.json(message);
    }
    return Response.json({ agentAvailable: true, messages: saved });
  });
  const editor = document.querySelector('[role="textbox"]') as HTMLElement;
  editor.focus();
  (document.querySelector('[aria-label="预览图片 预览图.png"]') as HTMLButtonElement).focus();
  await userEvent.keyboard('{Enter}');
  expect(saved).toHaveLength(0);
  await expect.element(page.getByRole('img', { name: '预览图.png' })).toBeVisible();
  expect(document.querySelector('[data-markdown-image-lightbox] img')?.getAttribute('src')).toMatch(/^blob:/);
  await page.getByRole('button', { name: 'Close image preview' }).click();
  expect(readChatEditor(editor).text).toBe(text);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.poll(() => document.querySelector('[data-chat-user-bubble]')).not.toBeNull();
  await page.getByRole('button', { name: '预览图片 预览图.png' }).click();
  await expect.element(page.getByRole('img', { name: '预览图.png' })).toBeVisible();
  await page.screenshot({ path: `/tmp/chat-image-preview-${width}.png` });
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => document.querySelector('[data-markdown-image-lightbox]')).toBeNull();
  expect(saved).toHaveLength(1);
});

it.each([390, 1280])('removes a pasted image with a single Backspace at width %i', async width => {
  await page.viewport(width, 844); await mount();
  const editor = document.querySelector('[role="textbox"]') as HTMLElement;
  editor.focus();
  const clipboardData = new DataTransfer();
  clipboardData.items.add(new File(['image'], '很长的截图文件名.png', { type: 'image/png' }));
  editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  await expect.element(page.getByRole('button', { name: /移除附件 termdock-clipboard-/ })).toBeVisible();
  await expect.poll(() => readChatEditor(editor).end).toBe('【图片1】 '.length);
  await userEvent.keyboard('{Backspace}');
  await expect.poll(() => editor.querySelector('[data-chat-inline-token]')).toBeNull();
  expect(readChatEditor(editor)).toMatchObject({ text: '', start: 0, end: 0 });
  await expect.element(page.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
});

it.each([
  { text: '前【图片1】 后', at: '前【图片1】 '.length, key: 'Backspace', expected: '前后', caret: 1, chips: 0 },
  { text: '【图片1】文字', at: '【图片1】文'.length, key: 'Backspace', expected: '【图片1】字', caret: '【图片1】'.length, chips: 1 },
  { text: '【图片1】【图片1】', at: '【图片1】【图片1】'.length, key: 'Backspace', expected: '【图片1】', caret: '【图片1】'.length, chips: 1 },
  { text: '前【图片1】后', at: 1, key: 'Delete', expected: '前后', caret: 1, chips: 0 },
  { text: '【图片1】 ', at: '【图片1】 '.length, key: 'deleteContentBackward', expected: '', caret: 0, chips: 0 },
])('deletes inline chips or adjacent text predictably: $text / $key', async ({ text, at, key, expected, caret, chips }) => {
  const files = [{ path: '/tmp/one.png', name: '一个很长的图片文件名.png', reference: '图片1' }];
  sessionStorage.setItem(`termdock:chat:${location.origin}:browser-composer:draft`, text);
  sessionStorage.setItem(`termdock:chat:${location.origin}:browser-composer:extras`, composeChatDraft(text, files, []));
  await mount(); const editor = document.querySelector('[role="textbox"]') as HTMLElement;
  expect(editor.querySelector('[data-chat-inline-token]')?.textContent).toBe('图片1');
  editor.focus(); setChatEditorCaret(editor, at);
  if (key === 'deleteContentBackward') {
    const event = new InputEvent('beforeinput', { inputType: key, bubbles: true, cancelable: true });
    editor.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
  } else await userEvent.keyboard(`{${key}}`);
  await expect.poll(() => readChatEditor(editor).text).toBe(expected);
  expect(readChatEditor(editor)).toMatchObject({ start: caret, end: caret });
  expect(editor.querySelectorAll('[data-chat-inline-token]')).toHaveLength(chips);
});

it.each([390, 1280])('keeps an empty composer the same height through deletion at width %i', async width => {
  await page.viewport(width, 844); await mount();
  const editor = document.querySelector('[role="textbox"]') as HTMLElement;
  editor.focus(); const initialHeight = editor.getBoundingClientRect().height;
  const composer = document.querySelector('[data-chat-composer]')!;
  const composerHeight = composer.getBoundingClientRect().height;
  for (const keys of ['{Backspace}', 'x{Backspace}', '{Backspace}', 'abc{Backspace}{Backspace}{Backspace}', '{Delete}']) {
    await userEvent.keyboard(keys); await frame();
    expect({ html: editor.innerHTML, text: readChatEditor(editor).text, height: editor.getBoundingClientRect().height }).toMatchObject({ text: '', height: initialHeight });
    expect(composer.getBoundingClientRect().height).toBe(composerHeight);
    expect(document.activeElement).toBe(editor);
    await expect.element(page.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
    expect(getComputedStyle(editor, '::before').content).toContain('输入消息');
  }
  await userEvent.keyboard('{Shift>}{Enter}{/Shift}'); await frame();
  expect(readChatEditor(editor).text).toBe('\n');
  expect(editor.getBoundingClientRect().height).toBe(initialHeight + 28);
  await userEvent.keyboard('{Backspace}'); await frame();
  expect(readChatEditor(editor).text).toBe('');
  expect(editor.getBoundingClientRect().height).toBe(initialHeight);
});

it.each([390, 1280])('previews a video in the editor and sent message at width %i', async width => {
  await page.viewport(width, 844);
  const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
  const stream = canvas.captureStream(5), chunks: Blob[] = [];
  const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
  const recorded = new Promise<Blob>(resolve => { recorder.ondataavailable = event => chunks.push(event.data); recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' })); });
  recorder.start();
  const drawing = canvas.getContext('2d')!; drawing.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--chrome-bg'); drawing.fillRect(0, 0, 160, 90);
  await new Promise(resolve => setTimeout(resolve, 250)); recorder.stop();
  const clip = await recorded; stream.getTracks().forEach(track => track.stop());
  const files = [{ path: '/tmp/recorded-demo.webm', name: '录屏演示.webm', type: 'video/webm', reference: '视频1' }];
  const text = '看看【视频1】这个问题';
  sessionStorage.setItem(`termdock:chat:${location.origin}:browser-composer:draft`, text);
  sessionStorage.setItem(`termdock:chat:${location.origin}:browser-composer:extras`, composeChatDraft(text, files, []));
  await mount(); const saved: object[] = [];
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (String(url).includes('/api/terminal/fs/video?')) return new Response(clip, { headers: { 'Content-Type': 'video/webm' } });
    if (init?.method === 'POST' && String(url).includes('/chat')) {
      const message = { id: 'video-sent', role: 'user', content: JSON.parse(String(init.body)).content, createdAt: Date.now(), status: 'delivered' };
      saved.push(message); return Response.json(message);
    }
    return Response.json({ agentAvailable: true, messages: saved });
  });
  const editor = document.querySelector('[role="textbox"]') as HTMLElement;
  expect(editor.querySelector('[data-chat-inline-token]')?.textContent).toBe('视频1');
  for (const stage of ['editor', 'sent']) {
    await page.getByRole('button', { name: '预览视频 录屏演示.webm' }).click();
    await expect.element(page.getByRole('dialog', { name: '视频预览' })).toBeVisible();
    await expect.poll(() => document.querySelector<HTMLVideoElement>('video')?.readyState, { timeout: 10000 }).toBeGreaterThanOrEqual(2);
    const video = document.querySelector<HTMLVideoElement>('video')!;
    expect(video.src).toMatch(/^blob:/);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect.poll(() => video.paused).toBe(false);
    await page.screenshot({ path: `/tmp/chat-video-${stage}-${width}.png` });
    await page.getByRole('button', { name: '关闭视频预览' }).click();
    if (stage === 'editor') {
      expect(readChatEditor(editor).text).toBe(text);
      await page.getByRole('button', { name: '发送消息', exact: true }).click();
      await expect.poll(() => document.querySelector('[data-chat-user-bubble]')).not.toBeNull();
      expect(document.querySelector('[data-chat-user-bubble] [data-chat-inline-token]')?.textContent).toBe('视频1');
    }
  }
  expect(saved).toHaveLength(1);
});

it.each([390, 1280])('keeps reply loading in the conversation and the terminal entry above the composer at width %i', async width => {
  await page.viewport(width, 844);
  const agent = { displayName: 'Codex', slug: 'codex' };
  await mount([], agent);
  let acknowledge!: (response: Response) => void;
  const messages: object[] = [];
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (init?.method === 'POST' && String(url).includes('/chat')) return new Promise<Response>(resolve => { acknowledge = resolve; });
    return Response.json({ agentAvailable: true, agent, messages, replyPending: messages.length > 0 });
  });
  const input = document.querySelector('[role="textbox"]') as HTMLElement;
  await page.getByRole('textbox').fill('检查本次构建');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.element(page.getByRole('status', { name: 'Codex发送中' })).toBeVisible();
  const card = document.querySelector<HTMLElement>('[data-chat-reply-status]')!;
  const dock = document.querySelector<HTMLElement>('[data-chat-terminal-dock]')!;
  const form = document.querySelector<HTMLElement>('[data-chat-composer]')!;
  expect(dock.contains(card)).toBe(true);
  expect(card.closest('.session-chat-scroll')).toBeNull();
  expect(card.getBoundingClientRect().bottom).toBeLessThanOrEqual(form.getBoundingClientRect().top);
  expect(dock.querySelector('[data-chat-terminal-access]')?.textContent).toContain('详情');
  expect(document.activeElement).toBe(input);
  messages.push({ id: 'sent-author', role: 'user', content: '检查本次构建', createdAt: Date.now(), status: 'delivered' });
  acknowledge(Response.json({ id: 'sent-author', status: 'delivered' }));
  await expect.element(page.getByRole('status', { name: 'Codex发送中' })).not.toBeInTheDocument();
  await expect.element(page.getByRole('status', { name: 'Codex等待回复' })).toBeVisible();

  const store = useTerminalStore.getState();
  store.setTerminalSession('browser-composer', { sessionId: 'backend-composer', cols: 80, rows: 24 });
  store.setTerminalOutputActivity('browser-composer', true);
  await expect.element(page.getByRole('status', { name: 'Codex处理中' })).toBeVisible();
  expect(document.querySelectorAll('[data-chat-agent-header]')).toHaveLength(1);
  expect(document.querySelector('[data-chat-reply-status]')?.textContent).toContain('处理中…');

  store.setTerminalOutputActivity('browser-composer', false);
  await expect.element(page.getByRole('status', { name: 'Codex等待回复' })).toBeVisible();

  store.setTerminalOutputActivity('browser-composer', true);
  await page.screenshot({ path: `/tmp/termdock-agent-waiting-${width}.png` });
  messages.push({ id: 'progress-author', role: 'assistant', content: Array.from({ length: 24 }, (_, index) => `正在核对第 ${index} 项结果。`).join('\n\n'), createdAt: Date.now(), status: 'stored', responseKind: 'progress' });
  window.dispatchEvent(new Event('online'));
  await expect.element(page.getByText('正在核对第 23 项结果。')).toBeVisible();
  const tailStatus = document.querySelector<HTMLElement>('[data-chat-reply-status]')!;
  expect(tailStatus.closest('[data-chat-terminal-dock]')).not.toBeNull();
  expect(document.querySelector('[data-chat-agent-awaiting]')).toBeNull();
  expect(tailStatus.closest('[data-chat-message-actions]')).toBeNull();
  expect(document.querySelector('[data-chat-agent-header]')?.contains(tailStatus)).toBe(false);
  expect(tailStatus.querySelector('.td-loading-spinner')).not.toBeNull();
  await expect.element(page.getByRole('status', { name: 'Codex处理中' })).toBeVisible();
  await page.screenshot({ path: `/tmp/termdock-agent-reply-status-${width}.png` });
});

it.each([390, 1280])('selects and sends a direct mention without creating group context at width %i', async width => {
  await page.viewport(width, 844);
  useSessionDirectoryStore.getState().replace([{ sessionId: 'outside-group', name: '组外助手', customName: true, lastActivity: 1,
    agent: { slug: 'codex', displayName: 'Codex', accentColor: 'var(--primary)', icon: null } }]);
  await mount();
  const posts: Array<{ content: string }> = [];
  vi.mocked(fetch).mockImplementation(async (_url, init) => {
    if (init?.method === 'POST') { posts.push(JSON.parse(String(init.body))); return Response.json({ id: 'direct-chat-request', status: 'pending', createdAt: Date.now() }); }
    return Response.json({ agentAvailable: true, messages: [] });
  });
  await page.getByRole('button', { name: '提及协作成员' }).click();
  await expect.element(page.getByRole('option')).toHaveTextContent('直接联系');
  await page.getByRole('option').click();
  expect(readChatEditor(document.querySelector('[role="textbox"]') as HTMLElement).text).toBe('@「组外助手」 ');
  expect(posts).toHaveLength(0);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].content).toContain('"sessionId":"outside-group","groupId":"","groupName":""');
});

it('selects a supported remote Session outside the group using its owning service title', async () => {
  peerMentions.sessions = [{ sessionId: 'remote:https%3A%2F%2Fpeer.test:worker', name: 'Legacy name', displayName: '远端助手', displaySubtitle: '远端项目',
    serviceOrigin: 'https://peer.test', serviceLabel: '工作电脑', canDirectContact: true, agent: { slug: 'codex', displayName: 'Codex' },
    backendSessionId: null, cwd: '', status: 'ready', capability: '', currentTask: '', updatedAt: 1 }];
  try {
    await mount(); await page.getByRole('button', { name: '提及协作成员' }).click();
    await expect.element(page.getByRole('option')).toHaveTextContent('远端助手');
    await expect.element(page.getByRole('option')).toHaveTextContent('工作电脑');
    await page.getByRole('option').click();
    expect(readChatEditor(document.querySelector('[role="textbox"]') as HTMLElement).text).toBe('@「远端助手」 ');
  } finally { peerMentions.sessions = []; }
});

it.each([390, 1280])('keeps history and input stationary through image upload states at width %i', async width => {
  await page.viewport(width, 844);
  let finish!: (value: Awaited<ReturnType<typeof uploadFiles>>) => void;
  let fail!: (error: Error) => void;
  let progress: ((percent: number) => void) | undefined;
  vi.mocked(uploadFiles).mockImplementation((_directory, _files, _signal, onProgress) => {
    progress = onProgress;
    return new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  });
  try {
    await mount(Array.from({ length: 5 }, (_, index) => ({ id: `upload-${index}`, role: 'user', content: `消息 ${index}\n${'多行正文\n'.repeat(8)}`, createdAt: index, status: 'stored' })));
    const editor = document.querySelector<HTMLElement>('[role="textbox"]')!;
    const scroll = document.querySelector<HTMLElement>('.session-chat-scroll')!;
    scroll.scrollTop = scroll.scrollHeight / 2;
    editor.focus(); await frame();
    const geometry = () => ({ historyHeight: scroll.clientHeight, historyScroll: scroll.scrollTop, inputTop: editor.getBoundingClientRect().top, composerHeight: document.querySelector('.session-chat-composer')!.getBoundingClientRect().height });
    const before = geometry();
    const paste = () => {
      const clipboardData = new DataTransfer();
      clipboardData.items.add(new File(['image'], '截图.png', { type: 'image/png' }));
      editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    };
    paste();
    await expect.element(page.getByText('正在上传文件 · 0%')).toBeVisible(); await frame();
    await page.screenshot({ path: `/tmp/chat-upload-floating-${width}.png` });
    expect(geometry()).toEqual(before);
    progress?.(63);
    await expect.element(page.getByText('正在上传文件 · 63%')).toBeVisible();
    expect(document.activeElement).toBe(editor);
    expect(geometry()).toEqual(before);
    const status = page.getByRole('status').filter({ hasText: '正在上传文件' });
    const toast = status.element().getBoundingClientRect(), composer = document.querySelector('[data-chat-composer]')!.getBoundingClientRect();
    expect(toast.bottom).toBeLessThanOrEqual(composer.top);
    expect(toast.left).toBeGreaterThanOrEqual(0); expect(toast.right).toBeLessThanOrEqual(width);
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await expect.element(page.getByText('已取消上传')).toBeVisible();
    expect(geometry()).toEqual(before);
    await page.getByRole('button', { name: '重试上传' }).click();
    await expect.element(page.getByText('正在上传文件 · 0%')).toBeVisible();
    fail(new Error('network interrupted'));
    await expect.element(page.getByText('上传未完成，文件尚未添加')).toBeVisible();
    expect(geometry()).toEqual(before);
    await page.getByRole('button', { name: '关闭上传提示' }).click();
    await expect.element(page.getByText('上传未完成，文件尚未添加')).not.toBeInTheDocument();
    expect(geometry()).toEqual(before);
    paste(); await expect.element(page.getByText('正在上传文件 · 0%')).toBeVisible();
    finish({ files: [{ name: 'pasted.png', path: '/tmp/pasted.png', size: 1 }] });
    await expect.element(page.getByText('正在上传文件 · 0%')).not.toBeInTheDocument(); await frame();
    expect(editor.querySelector('[data-chat-inline-token]')).not.toBeNull();
    expect(document.querySelector('[data-chat-upload-status]')).toBeNull();
    expect(scroll.scrollTop).toBe(before.historyScroll);
    // The inserted attachment chip has its own text metrics. Remove it before
    // comparing with the empty draft, so this measures only the transient UI.
    await page.getByRole('button', { name: /移除附件 termdock-clipboard-/ }).click(); await frame();
    expect(geometry()).toEqual(before);
  } finally {
    vi.mocked(uploadFiles).mockReset().mockResolvedValue({ files: [{ name: 'pasted.png', path: '/tmp/pasted.png', size: 1 }] });
  }
});


it.each([0, 300])('sends without resetting native input focus or caret at keyboard inset %i', async height => {
  await mount([], { displayName: 'Codex', slug: 'codex' });
  const editor = page.getByRole('textbox').element() as HTMLElement;
  await page.getByRole('textbox').fill('保留键盘当前状态');
  document.documentElement.style.setProperty('--kb-height', `${height}px`);
  document.documentElement.style.setProperty('--app-base-vh', '844px');
  const posts: string[] = [];
  vi.mocked(fetch).mockImplementation(async (_url, init) => {
    if (init?.method === 'POST') { posts.push(JSON.parse(String(init.body)).content); return Response.json({ id: 'keyboard-sent', status: 'pending' }); }
    return Response.json({ agentAvailable: true, messages: [] });
  });
  const focus = vi.spyOn(editor, 'focus'), caret = vi.spyOn(getSelection()!, 'addRange');
  let focused = 0, blurred = 0;
  const onFocus = () => focused++, onBlur = () => blurred++;
  editor.addEventListener('focus', onFocus); editor.addEventListener('blur', onBlur);
  try {
    await commands.composerTap('button[aria-label="发送消息"]');
    await expect.poll(() => posts.length).toBe(1); await frame();
    expect(posts[0]).toBe('保留键盘当前状态');
    expect(readChatEditor(editor).text).toBe('');
    expect(document.activeElement).toBe(editor);
    expect(focus).not.toHaveBeenCalled(); expect(caret).not.toHaveBeenCalled();
    expect(focused).toBe(0); expect(blurred).toBe(0);
    if (height) { await userEvent.keyboard('继续输入'); expect(readChatEditor(editor).text).toBe('继续输入'); }
  } finally {
    focus.mockRestore(); caret.mockRestore(); editor.removeEventListener('focus', onFocus); editor.removeEventListener('blur', onBlur);
    document.documentElement.style.removeProperty('--kb-height'); document.documentElement.style.removeProperty('--app-base-vh');
  }
});

it('does not focus the editor when sending after it has lost focus', async () => {
  await mount([], { displayName: 'Codex', slug: 'codex' });
  await page.getByRole('textbox').fill('关闭输入后发送');
  const editor = page.getByRole('textbox').element() as HTMLElement; editor.blur();
  const focus = vi.spyOn(editor, 'focus'), caret = vi.spyOn(getSelection()!, 'addRange');
  try {
    await commands.composerTap('button[aria-label="发送消息"]'); await frame();
    expect(readChatEditor(editor).text).toBe('');
    expect(document.activeElement).not.toBe(editor);
    expect(focus).not.toHaveBeenCalled(); expect(caret).not.toHaveBeenCalled();
  } finally { focus.mockRestore(); caret.mockRestore(); }
});
