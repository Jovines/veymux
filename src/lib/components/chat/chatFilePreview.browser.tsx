import { createRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import '../../../index.css';
import { I18nProvider } from '../../i18n';
import { ChatFilePreview } from './ChatFilePreview';
import { HtmlPreviewFrame, type HtmlPreviewFrameHandle } from '../sidebar/HtmlPreviewFrame';

// The UI, opaque shell and runtime are real. Only the authenticated resource
// reader is replaced; production transport has its own boundary/integration suites.
vi.mock('../../federation/browserIntegration', async original => ({
  ...await original<typeof import('../../federation/browserIntegration')>(),
  getActiveClient: async () => ({ fetch: (path: string, init?: RequestInit) => fetch(path, init) }),
}));
const fixture = vi.hoisted(() => ({ text: '', failure: false, resources: {} as Record<string, { body: string; type: string }> }));
vi.mock('../../terminal/api', async original => ({
  ...await original<typeof import('../../terminal/api')>(),
  readFileContent: async (path: string) => ({ path, content: fixture.text, size: fixture.text.length }),
  cancelIoSlot: vi.fn(),
  getSettings: async () => ({}),
}));

declare module 'vitest/browser' {
  interface BrowserCommands {
    filePreviewPolicy(policy: 'desktop' | 'server'): Promise<void>;
    filePreviewAction(action: string): Promise<{ text: string | null; scroll: number; storage?: string; parent?: string; blocked?: string; base?: string; module?: string; request?: string; requestBlocked?: string; images?: boolean } | null>;
  }
}

const path = '/tmp/review/MR8511901-搜索筛选器样式优化-C1-59515415d413.html';
const token = 'abcdef0123456789abcdef0123456789';
const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:16px system-ui;margin:16px}a,button{display:block;margin:12px 0}#bottom{margin-top:1100px}</style>
<h1>搜索筛选器审查</h1><a href="#bottom">正文锚点</a><button>展开审查意见</button><p id="report"></p><h2 id="bottom">报告结尾</h2>
<script>
localStorage.setItem('mode','review'); sessionStorage.setItem('session','private');
localStorage.flag='enabled'; document.body.dataset.storage=[localStorage.getItem('mode'),localStorage.flag,sessionStorage.getItem('session')].join(',');
try { parent.localStorage.getItem('secret'); document.body.dataset.parent='allowed'; } catch { document.body.dataset.parent='blocked'; }
fetch('/api/terminal/settings').then(()=>document.body.dataset.blocked='no').catch(()=>document.body.dataset.blocked='yes');
document.querySelector('button').onclick=()=>document.getElementById('report').textContent='审查意见已展开';
</script>`;
let root: Root | undefined;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  await commands.filePreviewPolicy('desktop');
  fixture.text = html; fixture.failure = false; fixture.resources = {};
  window.localStorage.setItem('veymux:locale', 'zh');
  window.localStorage.setItem('secret', 'parent-secret');
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (!url.includes('/api/terminal/fs/preview/')) return Response.json({});
    if (fixture.failure) throw new Error('连接已断开');
    if (!url.includes(token)) return new Response(null, { status: 302, headers: { location: url.replace('/preview/', `/preview/${token}/`) } });
    const resource = fixture.resources[new URL(url, location.origin).pathname.split('/').pop()!];
    return new Response(resource?.body ?? fixture.text, { headers: { 'content-type': resource?.type ?? 'text/html' } });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  root?.unmount(); root = undefined;
  vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren();
  document.documentElement.removeAttribute('style'); window.localStorage.removeItem('secret');
});
function mount(canWrite = true, filePath = path) {
  function App() {
    const [open, setOpen] = useState(true);
    return <I18nProvider>{open ? <ChatFilePreview path={filePath} sessionId="preview-test" canWrite={canWrite} close={() => setOpen(false)} /> : <p>返回对话</p>}</I18nProvider>;
  }
  const host = document.createElement('div'); document.body.append(host);
  root = createRoot(host); root.render(<App />);
}
async function loaded() {
  await expect.poll(() => document.querySelector('iframe')?.getAttribute('src'), { timeout: 10000 }).toContain('/preview-shell.html#');
  await expect.poll(async () => (await commands.filePreviewAction('state'))?.storage, { timeout: 10000 }).toBe('review,enabled,private');
}
for (const layout of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 568 }, { width: 568, height: 320 }]) {
  it(`reads and interacts with HTML at ${layout.width}×${layout.height} without duplicate headers or overflow`, async () => {
    await page.viewport(layout.width, layout.height); mount(); await loaded();
    const dialog = document.querySelector('[role="dialog"]')!;
    const frame = dialog.querySelector('iframe')!;
    const header = dialog.querySelector('[data-file-preview-toolbar]')!;
    expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
    expect(frame.getBoundingClientRect().height).toBeGreaterThan(layout.height * (layout.height < 400 ? .4 : .7));
    expect(header.getBoundingClientRect().height).toBeLessThanOrEqual(layout.width < 640 ? 49 : 41);
    expect(frame.getBoundingClientRect().top).toBe(header.getBoundingClientRect().bottom);
    expect(dialog.querySelectorAll('[aria-label="关闭文件预览"]')).toHaveLength(1);
    expect(dialog.querySelector('[aria-label="文件信息与操作"]')).toBeNull();
    for (const button of header.querySelectorAll('button')) {
      const box = button.getBoundingClientRect(), outer = dialog.getBoundingClientRect();
      expect(box.width).toBeGreaterThanOrEqual(layout.width < 640 ? 44 : 32); expect(box.height).toBeGreaterThanOrEqual(layout.width < 640 ? 44 : 32);
      expect(box.left).toBeGreaterThanOrEqual(outer.left); expect(box.right).toBeLessThanOrEqual(outer.right);
    }
    await commands.filePreviewAction('expand');
    expect((await commands.filePreviewAction('state'))?.text).toContain('审查意见已展开');
    await commands.filePreviewAction('anchor');
    await expect.poll(async () => (await commands.filePreviewAction('state'))?.scroll).toBeGreaterThan(0);
    expect(dialog.querySelector('iframe')).toBe(frame);
    await page.getByRole('button', { name: '关闭文件预览', exact: true }).click();
    await expect.element(page.getByText('返回对话')).toBeVisible();
  });
}
it('retains document state across app fullscreen, exits only the top layer, and closes from inside the frame', async () => {
  await page.viewport(1280, 900); mount(); await loaded();
  const frame = document.querySelector('iframe');
  const request = vi.spyOn(HTMLElement.prototype, 'requestFullscreen').mockRejectedValue(new Error('Unavailable'));
  await commands.filePreviewAction('expand');
  await page.getByRole('button', { name: '全屏预览', exact: true }).click();
  expect(document.querySelector('[data-html-preview-frame]')?.classList.contains('fixed')).toBe(true);
  expect(document.querySelector('iframe')).toBe(frame);
  expect((await commands.filePreviewAction('state'))?.text).toContain('审查意见已展开');
  await commands.filePreviewAction('escape');
  await expect.poll(() => document.querySelector('[data-html-preview-frame]')?.classList.contains('fixed')).toBe(false);
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.querySelector('iframe')).toBe(frame);
  await commands.filePreviewAction('escape');
  await expect.element(page.getByText('返回对话')).toBeVisible(); request.mockRestore();
});
it('keeps parent storage and service APIs inaccessible without a Service Worker', async () => {
  mount(false); await loaded();
  expect(navigator.serviceWorker.controller).toBeNull();
  const state = await commands.filePreviewAction('state');
  expect(state?.parent).toBe('blocked');
  await expect.poll(async () => (await commands.filePreviewAction('state'))?.blocked).toBe('yes');
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/terminal/settings'))).toBe(false);
  expect(window.localStorage.getItem('mode')).toBeNull();
  expect(document.querySelector('iframe')?.sandbox.value).toBe('allow-scripts');
  await expect.element(page.getByRole('button', { name: '引用', exact: true })).not.toBeInTheDocument();
});
it('recovers from a disconnected reader using the retry action', async () => {
  fixture.failure = true; mount();
  await expect.element(page.getByText('HTML 未能打开')).toBeVisible();
  expect(document.querySelector('iframe')).toBeNull();
  fixture.failure = false;
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await loaded();
});
it('adapts toolbar layout when the viewport changes with the dialog open', async () => {
  await page.viewport(1280, 900); mount(); await loaded();
  const frame = document.querySelector('iframe');
  await page.viewport(390, 844);
  await expect.poll(() => document.querySelector('[data-file-preview-toolbar]')?.getBoundingClientRect().height).toBe(49);
  expect(document.querySelector('iframe')).toBe(frame);
  await page.getByRole('button', { name: '源码', exact: true }).click();
  await expect.element(page.getByRole('button', { name: '预览', exact: true })).toBeVisible();
  expect(document.querySelector('iframe')).toBeNull();
  await page.getByRole('button', { name: '预览', exact: true }).click(); await loaded();
});

it('lets fullscreen escape a transformed drawer while retaining the opaque document', async () => {
  await page.viewport(1280, 900);
  const host = document.createElement('div'); document.body.append(host);
  const ref = createRef<HtmlPreviewFrameHandle>();
  root = createRoot(host);
  root.render(<div style={{ transform: 'translateX(0)', width: 320, height: 240, overflow: 'hidden' }}>
    <button onClick={() => void ref.current?.toggleFullscreen()}>Expand</button>
    <HtmlPreviewFrame ref={ref} src={`/api/terminal/fs/preview/${token}/tmp/review/index.html`} title="review" exitFullscreenLabel="Exit" />
  </div>);
  await loaded(); const frame = document.querySelector('iframe');
  vi.spyOn(HTMLElement.prototype, 'requestFullscreen').mockRejectedValue(new Error('Unavailable'));
  await page.getByRole('button', { name: 'Expand', exact: true }).click();
  const fullscreen = document.querySelector('[data-html-preview-frame]')!;
  expect(fullscreen.matches(':popover-open')).toBe(true);
  const box = fullscreen.getBoundingClientRect();
  expect(box.width).toBe(1280); expect(box.height).toBe(900);
  expect(document.querySelector('iframe')).toBe(frame);
  await page.getByRole('button', { name: 'Exit', exact: true }).click();
  expect(fullscreen.matches(':popover-open')).toBe(false);
  expect(document.querySelector('iframe')).toBe(frame);
});
it('opens the Markdown outline from the conversation file preview', async () => {
  await page.viewport(390, 844);
  fixture.text = Array.from({ length: 20 }, (_, index) => `## Chapter ${index}\n\nBody`).join('\n\n');
  mount(true, '/tmp/review/guide.md');
  await page.getByRole('button', { name: /Markdown outline|Markdown 目录/ }).click();
  await expect.poll(() => document.querySelector('[data-markdown-heading-outline-mobile]')).not.toBeNull();
});
it('keeps the report readable while offering details for a failing page script', async () => {
  fixture.text = html.replace("localStorage.setItem('mode','review');", "throw new Error('Report script failed');");
  mount();
  await expect.poll(() => document.querySelector('[aria-label="有预览提示"]')).not.toBeNull();
  const frameTop = document.querySelector('iframe')!.getBoundingClientRect().top;
  await page.getByRole('button', { name: '更多文件操作', exact: true }).click();
  expect(document.querySelector('iframe')!.getBoundingClientRect().top).toBe(frameTop);
  await expect.element(page.getByText('页面脚本运行失败：Uncaught Error: Report script failed', { exact: true })).toBeVisible();
  expect(document.querySelector('iframe')).not.toBeNull();
  expect((await commands.filePreviewAction('state'))?.text).toContain('搜索筛选器审查');
  await page.getByRole('button', { name: '源码', exact: true }).click();
  expect(document.querySelector('iframe')).toBeNull();
});

it.each([390, 320])('overlays file information at width %i without shifting the report and closes only the popup on Escape', async width => {
  await page.viewport(width, 844); mount(); await loaded();
  const frame = document.querySelector('iframe')!, original = frame.getBoundingClientRect().toJSON();
  await page.getByRole('button', { name: '更多文件操作', exact: true }).click();
  await expect.element(page.getByRole('dialog', { name: '文件信息与操作', exact: true })).toBeVisible();
  expect(frame.getBoundingClientRect().toJSON()).toEqual(original);
  const popup = document.querySelector('[aria-label="文件信息与操作"]')!.getBoundingClientRect();
  expect(popup.left).toBeGreaterThanOrEqual(0); expect(popup.right).toBeLessThanOrEqual(width);
  expect(popup.bottom).toBeLessThanOrEqual(844);
  await userEvent.keyboard('{Escape}');
  await expect.element(page.getByRole('dialog', { name: '文件信息与操作', exact: true })).not.toBeInTheDocument();
  expect(document.querySelector('iframe')).toBe(frame);
  expect(frame.getBoundingClientRect().toJSON()).toEqual(original);
  await userEvent.keyboard('{Escape}');
  await expect.element(page.getByText('返回对话')).toBeVisible();
});

for (const policy of ['desktop', 'server'] as const) {
  it(`resolves module imports and Request resources without a base-uri warning under the ${policy} policy`, async () => {
    await commands.filePreviewPolicy(policy);
    fixture.resources = {
      'module.js': { body: 'export const result = "module-ready";', type: 'text/javascript' },
      'data.json': { body: '{"status":"request-ready"}', type: 'application/json' },
      'image.svg': { body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="currentColor"/></svg>', type: 'image/svg+xml' },
    };
    fixture.text = html + `<img src="./image.svg" alt="Relative image"><script type="importmap">{"imports":{"demo":"./module.js"}}</script>
<script type="module">import { result } from 'demo';document.body.dataset.module=result;</script>
<script>fetch(new Request('./data.json')).then(r=>r.json()).then(data=>document.body.dataset.request=data.status);fetch(new Request('/api/terminal/settings')).then(()=>document.body.dataset.requestBlocked='no').catch(()=>document.body.dataset.requestBlocked='yes');</script>`;
    mount(); await loaded();
    await expect.poll(async () => (await commands.filePreviewAction('state'))?.module).toBe('module-ready');
    await expect.poll(async () => (await commands.filePreviewAction('state'))?.request).toBe('request-ready');
    await expect.poll(async () => (await commands.filePreviewAction('state'))?.images).toBe(true);
    await expect.poll(async () => (await commands.filePreviewAction('state'))?.requestBlocked).toBe('yes');
    expect((await commands.filePreviewAction('state'))?.base).toMatch(/^https:\/\/veymux-preview\.invalid\/[a-f0-9-]+\/$/);
    expect(document.querySelector('[aria-label="有预览提示"]')).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/terminal/settings'))).toBe(false);
  });
}
it('still reports an actual page attempt to change the browser base address', async () => {
  fixture.text = html + `<script>const base=document.createElement('base');base.href='https://outside.invalid/';document.head.append(base);</script>`;
  mount(); await loaded();
  await expect.poll(() => document.querySelector('[aria-label="有预览提示"]')).not.toBeNull();
  await page.getByRole('button', { name: '更多文件操作', exact: true }).click();
  await expect.element(page.getByText('页面尝试更改链接的解析地址，已阻止。', { exact: true })).toBeVisible();
});
