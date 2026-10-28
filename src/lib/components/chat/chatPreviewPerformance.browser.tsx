import { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import '../../../index.css';
import { I18nProvider } from '../../i18n';
import { ChatFilePreview } from './ChatFilePreview';

const fixture = vi.hoisted(() => ({ text: '' }));
vi.mock('../../terminal/api', async original => ({
  ...await original<typeof import('../../terminal/api')>(),
  readFileContent: async (path: string) => ({ path, content: fixture.text, size: fixture.text.length }),
  cancelIoSlot: vi.fn(), getSettings: async () => ({}),
}));
let root: Root | undefined;
afterEach(() => { root?.unmount(); document.body.replaceChildren(); });
function mount(path: string) {
  window.localStorage.setItem('veymux:locale', 'zh');
  const host = document.createElement('div'); document.body.append(host);
  function App() {
    const [open, setOpen] = useState(true);
    return <I18nProvider>{open ? <ChatFilePreview path={path} sessionId="performance" canWrite close={() => setOpen(false)} /> : <p>返回对话</p>}</I18nProvider>;
  }
  root = createRoot(host); root.render(<App />);
}
for (const width of [390, 1280]) {
  it(`bounds source nodes and closes the dialog at ${width}px`, async () => {
    await page.viewport(width, 844);
    fixture.text = Array.from({ length: 12000 }, (_, i) => `line ${i + 1}: value`).join('\n');
    const start = performance.now();
    mount('/tmp/performance.txt');
    await expect.poll(() => document.querySelectorAll('[data-file-preview-line]').length).toBeGreaterThan(0);
    const count = document.querySelectorAll('[data-file-preview-line]').length;
    console.log(JSON.stringify({ width, nodes: count, loadMs: Math.round(performance.now() - start) }));
    await page.getByRole('button', { name: '关闭文件预览', exact: true }).click();
    await expect.element(page.getByText('返回对话')).toBeVisible();
    expect(count).toBeLessThanOrEqual(200);
  });
}

for (const width of [390, 1280]) {
  it(`searches across pages, jumps to lines and returns to chat at ${width}px`, async () => {
    await page.viewport(width, 844);
    fixture.text = Array.from({ length: 12000 }, (_, i) => `line ${i + 1}: value`).join('\n');
    mount('/tmp/search-performance.txt');
    await expect.element(page.getByRole('button', { name: '下一段', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '下一段', exact: true }).click();
    await expect.poll(() => document.querySelector('[data-file-preview-line]')?.getAttribute('data-file-preview-line')).toBe('161');
    await page.getByRole('searchbox').fill('line 11999:');
    await expect.poll(() => document.querySelector('mark')?.textContent).toBe('line 11999:');
    expect(document.querySelectorAll('[data-file-preview-line]').length).toBeLessThanOrEqual(200);
    await page.getByRole('searchbox').fill('');
    await page.getByRole('spinbutton', { name: '跳到行' }).fill('8000');
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => document.querySelector('[data-file-preview-line="8000"]')).not.toBeNull();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
    await page.getByRole('button', { name: '关闭文件预览', exact: true }).click();
    await expect.element(page.getByText('返回对话')).toBeVisible();
  });
}
it.each(['md', 'csv', 'html'])('opens large %s as bounded source before rich parsing', async ext => {
  fixture.text = Array.from({ length: 12000 }, (_, i) => `value ${i},value`).join('\n');
  mount(`/tmp/large.${ext}`);
  await expect.poll(() => document.querySelector('[data-bounded-text-preview]')).not.toBeNull();
  expect(document.querySelector('iframe, table, [data-markdown-preview-block-start]')).toBeNull();
  expect(document.querySelectorAll('[data-file-preview-line]').length).toBeLessThanOrEqual(200);
});
it('chunks a one-megabyte line without horizontal overflow', async () => {
  await page.viewport(390, 844);
  fixture.text = 'x'.repeat(1024 * 1024); mount('/tmp/minified.txt');
  await expect.poll(() => document.querySelector('[data-bounded-text-preview]')).not.toBeNull();
  const preview = document.querySelector('[data-bounded-text-preview]')!;
  expect(preview.querySelectorAll('[data-file-preview-line]').length).toBeLessThanOrEqual(200);
  expect(preview.scrollWidth).toBeLessThanOrEqual(preview.clientWidth + 1);
});
it('highlights ordinary code using the real worker and closes cleanly', async () => {
  fixture.text = 'const answer = 42;'; mount('/tmp/ordinary.ts');
  await expect.poll(() => document.querySelector('[data-file-preview-line] .token'), { timeout: 10000 }).not.toBeNull();
  await page.getByRole('button', { name: '关闭文件预览', exact: true }).click();
  await expect.element(page.getByText('返回对话')).toBeVisible();
});
