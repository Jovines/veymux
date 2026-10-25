import { useCallback, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { ChatFilePreview } from './ChatFilePreview';
import { ChatMessageViewport } from './ChatMessageViewport';
import '../../../index.css';

// Keep the real preview portal and keyboard layer; only its file reader is a fixture.
vi.mock('../sidebar/RightSidebar', () => ({
  FilePreview: ({ onClose }: { onClose: () => void }) => <div className="flex h-full flex-col bg-surface p-4">
    <h1>检查结果文件</h1><p>阅读文件时，后面的回复仍应保留未读提示。</p>
    <button type="button" onClick={onClose}>关闭文件预览</button>
  </div>,
}));

let root: Root | undefined;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
afterEach(() => { root?.unmount(); root = undefined; vi.restoreAllMocks(); document.body.replaceChildren(); });

interface Exposure { closedAt: number; viewedAt: number }
function Harness({ previewInitiallyOpen, onViewed, exposure }: { previewInitiallyOpen: boolean; onViewed: () => void; exposure: Exposure }) {
  const [preview, setPreview] = useState(previewInitiallyOpen), [unread, setUnread] = useState(true);
  const scroll = useRef<HTMLDivElement>(null);
  const viewed = useCallback(() => { exposure.viewedAt = performance.now(); onViewed(); setUnread(false); }, [exposure, onViewed]);
  return <main className="flex h-dvh flex-col bg-surface text-foreground">
    <button type="button" onClick={() => setPreview(true)}>打开文件预览</button>
    <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto p-4">
      <ChatMessageViewport id="covered-reply" root={scroll} unread={unread} viewing onViewed={viewed}>
        <article className="min-h-60"><p>检查已完成，这是一条尚未查看的新回复。</p></article>
      </ChatMessageViewport>
    </div>
    {preview && <ChatFilePreview path="/tmp/exposure-result.md" sessionId="exposure-browser" canWrite={false}
      close={() => { exposure.closedAt = performance.now(); setPreview(false); }} />}
  </main>;
}

async function mount(width: number, previewInitiallyOpen: boolean) {
  await page.viewport(width, 844);
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  const onViewed = vi.fn(), exposure: Exposure = { closedAt: 0, viewedAt: 0 };
  root.render(<Harness previewInitiallyOpen={previewInitiallyOpen} onViewed={onViewed} exposure={exposure} />);
  await expect.poll(() => document.querySelector('[data-chat-viewport-row="covered-reply"]')).not.toBeNull();
  return { onViewed, exposure };
}

async function closeAndExpose(onViewed: ReturnType<typeof vi.fn>, exposure: Exposure) {
  await page.getByRole('button', { name: '关闭文件预览', exact: true }).click();
  await expect.element(page.getByRole('dialog', { name: '文件预览', exact: true })).not.toBeInTheDocument();
  await pause(450);
  expect(onViewed).not.toHaveBeenCalled();
  await expect.poll(() => onViewed.mock.calls.length).toBe(1);
  expect(exposure.viewedAt - exposure.closedAt).toBeGreaterThanOrEqual(600);
  expect(document.querySelector('[data-chat-unread]')).toBeNull();
}

it.each([1280, 390])('keeps a reply unread behind the file preview and starts exposure only after closing at width %i', async width => {
  const { onViewed, exposure } = await mount(width, true);
  await expect.element(page.getByRole('dialog', { name: '文件预览', exact: true })).toBeVisible();
  await pause(800);
  expect(onViewed).not.toHaveBeenCalled();
  expect(document.querySelector('[data-chat-unread]')).not.toBeNull();
  await closeAndExpose(onViewed, exposure);
});

it.each([1280, 390])('discards partial exposure when the file preview opens and requires a new 600ms after closing at width %i', async width => {
  const { onViewed, exposure } = await mount(width, false);
  await pause(200);
  await page.getByRole('button', { name: '打开文件预览', exact: true }).click();
  await expect.element(page.getByRole('dialog', { name: '文件预览', exact: true })).toBeVisible();
  await pause(800);
  expect(onViewed).not.toHaveBeenCalled();
  await closeAndExpose(onViewed, exposure);
});
