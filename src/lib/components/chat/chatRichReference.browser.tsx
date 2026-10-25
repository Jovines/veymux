import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import '../../../index.css';
import { SessionChatView } from './SessionChatView';
import { clearChatSnapshots } from './chatSnapshot';
import { parseChatContent } from './chatReferences';
import type { ChatMessage } from './chatMessages';

declare module 'vitest/browser' {
  interface BrowserCommands { selectRichText(selector: string, text: string): Promise<void> }
}

let root: Root | undefined;
afterEach(() => {
  root?.unmount(); root = undefined;
  window.getSelection()?.removeAllRanges();
  clearChatSnapshots(); sessionStorage.clear(); vi.unstubAllGlobals();
  document.body.replaceChildren();
});

for (const width of [390, 1280]) for (const version of [1, 2] as const) {
  it(`quotes selected OpenUI v${version} text and table cells through the composer at width ${width}`, async () => {
    await page.viewport(width, 844);
    const content = 'OpenUI selection target';
    const code = version === 2
      ? `$count = 1\nroot = Stack([TextContent("${content}"), Table([Col("方案", ["轻量方案"])]), Input("notes", "补充备注"), Button("增加数量", @Set($count, $count + 1)), TextContent("数量：" + $count)])`
      : `root = Stack([Text("${content}"), Table(["方案"], [["轻量方案"]]), Input("notes", "补充备注", "填写备注")])`;
    const message: ChatMessage = { id: 'rich-quote', role: 'assistant', content: '不应替代选中文字的后备说明', createdAt: 1, status: 'stored', ui: { version, code } };
    const posts: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)).content);
        return Response.json({ id: 'sent', createdAt: 2, status: 'pending' });
      }
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        return Response.json({ revision: body.revision + 1, values: body.values });
      }
      return Response.json({ agentAvailable: true, agent: { displayName: 'Codex' }, messages: [message] });
    }));
    const host = document.createElement('div'); host.id = 'root'; document.body.append(host);
    root = createRoot(host); root.render(<SessionChatView sessionId={`rich-reference-${version}-${width}`} onTerminal={() => {}} />);
    await expect.element(page.getByText(content, { exact: true })).toBeVisible();
    const text = page.getByText(content, { exact: true }).element();
    expect(getComputedStyle(text).userSelect).toBe('text');
    expect(getComputedStyle(text).getPropertyValue('-webkit-touch-callout')).not.toBe('none');
    expect(getComputedStyle(page.getByRole('cell', { name: '轻量方案' }).element()).userSelect).toBe('text');
    const selector = '[data-chat-message="rich-quote"] [data-chat-rich-content]';
    await commands.selectRichText(selector, 'selection target');
    await expect.element(page.getByRole('button', { name: '引用选中内容', exact: true })).toBeVisible();
    expect(window.getSelection()?.toString()).toBe('selection target');
    await page.getByRole('button', { name: '引用选中内容', exact: true }).click();
    await expect.element(page.getByRole('button', { name: '移除消息引用' })).toBeVisible();
    await page.getByRole('textbox', { name: '给Codex的消息' }).fill('请解释所选内容');
    await page.getByRole('button', { name: '发送消息' }).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(parseChatContent(posts[0])).toMatchObject({ text: '请解释所选内容', reference: { author: 'Codex', text: 'selection target' } });
    expect(posts[0]).not.toContain(message.content);

    await commands.selectRichText(selector, '轻量方案');
    await page.getByRole('button', { name: '引用选中内容', exact: true }).click();
    await expect.element(page.getByRole('button', { name: '移除消息引用' })).toBeVisible();
    expect(document.querySelector('.session-chat-composer blockquote')?.textContent).toContain('轻量方案');
    await page.getByRole('button', { name: '移除消息引用' }).click();
    const field = version === 2 ? page.getByPlaceholder('补充备注', { exact: true }) : page.getByRole('textbox', { name: '补充备注' });
    await field.fill('保留表单交互');
    await expect.element(field).toHaveValue('保留表单交互');
    if (version === 2) {
      const button = page.getByRole('button', { name: '增加数量' });
      expect(getComputedStyle(button.element()).userSelect).toBe('none');
      await button.click();
      await expect.element(page.getByText('数量：2', { exact: true })).toBeVisible();
    }
  });
}
