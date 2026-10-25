import { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import '../../../index.css';
import { I18nProvider } from '../../i18n';
import { SessionChatView } from './SessionChatView';
import { readChatEditor } from './ChatRichEditor';
import { parseChatDraft } from './chatComposerContent';
import { clearChatSnapshots } from './chatSnapshot';
import { ChatFilePreview } from './ChatFilePreview';
import { requestReferenceInsertion } from '../sidebar/requestReferenceInsertion';
import type { ChatMessage } from './chatMessages';

const fixtures = vi.hoisted(() => ({ directoryFailure: false }));
vi.mock('../../terminal/api', async original => ({ ...await original<typeof import('../../terminal/api')>(),
  readFileContent: async (path: string) => ({ path, content: Array.from({ length: 55 }, (_, n) => `const line${n + 1} = "登录检查 ${n + 1}";`).join('\n'), size: 1024 }),
  listDirectory: async () => { if (fixtures.directoryFailure) throw new Error('offline'); return { path: '/workspace/src', entries: [{ name: 'login.ts', path: '/workspace/src/login.ts', type: 'file' }] }; },
  getSettings: async () => ({}), cancelIoSlot: vi.fn(),
}));

let root: Root | undefined;
afterEach(() => { root?.unmount(); root = undefined; clearChatSnapshots(); sessionStorage.clear(); vi.unstubAllGlobals(); document.body.replaceChildren(); fixtures.directoryFailure = false; });
const composer = () => document.querySelector('[data-chat-composer] [role="textbox"]') as HTMLElement;
async function mount() {
  localStorage.setItem('termdock:locale', 'zh');
  const messages: ChatMessage[] = [], posts: string[] = [];
  let failure = true;
  vi.stubGlobal('fetch', vi.fn(async (_url, init?: RequestInit) => {
    if (init?.method === 'POST' && String(_url).includes('/context-browser/chat')) {
      const { content } = JSON.parse(String(init.body)); posts.push(content);
      if (failure) throw new Error('offline');
      const message: ChatMessage = { id: 'sent-context', role: 'user', content, createdAt: Date.now(), status: 'delivered' };
      messages.push(message); return Response.json(message);
    }
    return Response.json({ agentAvailable: true, agent: { displayName: 'Codex' }, messages });
  }));
  function App() {
    const [preview, setPreview] = useState(false);
    return <I18nProvider><div className="flex h-dvh flex-col bg-surface text-foreground">
      <nav className="flex shrink-0 gap-2 border-b border-border p-2">
        <button type="button" className="min-h-11 px-3" onClick={() => setPreview(true)}>浏览 login.ts</button>
        <button type="button" className="min-h-11 px-3" onClick={event => { void requestReferenceInsertion('/workspace/src ', 'context-browser', () => true, event.currentTarget, { reference: { kind: 'directory', path: '/workspace/src', text: '/workspace/src ' } }); }}>引用 src 目录</button>
      </nav>
      <div className="min-h-0 flex-1"><SessionChatView sessionId="context-browser" onTerminal={() => {}} /></div>
      {preview && <ChatFilePreview path="/workspace/src/login.ts" sessionId="context-browser" canWrite close={() => setPreview(false)} />}
    </div></I18nProvider>;
  }
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host); root.render(<App />);
  await expect.element(page.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
  return { posts, succeed: () => { failure = false; } };
}

it.each([390, 1280])('references real file-preview selections, preserves normal input, and previews/removes/retries at %i px', async width => {
  await page.viewport(width, 844);
  const state = await mount();
  await page.getByRole('textbox', { name: '给Codex的消息' }).fill('普通文字 /workspace/src/login.ts 【代码1】 ');
  expect(composer().querySelector('[data-chat-inline-token]')).toBeNull();
  await page.getByRole('button', { name: '浏览 login.ts' }).click();
  await expect.element(page.getByRole('dialog', { name: '文件预览' })).toBeVisible();
  await expect.poll(() => document.querySelector('[data-file-preview-line="42"]')).not.toBeNull();
  const line = document.querySelector<HTMLElement>('[data-file-preview-line="42"]')!;
  line.scrollIntoView({ block: 'center' }); line.click();
  const sourceReference = page.getByRole('button', { name: /引用.*L42/ });
  await expect.element(sourceReference).toBeVisible(); await sourceReference.click();
  await expect.element(page.getByRole('dialog', { name: '文件预览' })).not.toBeInTheDocument();
  const code = page.getByRole('button', { name: '预览代码 login.ts', exact: true });
  await expect.element(code).toBeVisible();
  expect(composer().textContent).toContain('login.ts · L42');
  expect(readChatEditor(composer()).text).toContain('【代码1】');
  await code.click();
  await expect.element(page.getByRole('dialog', { name: '代码引用预览' })).toBeVisible();
  await expect.element(page.getByText(/登录检查 42/).last()).toBeVisible();
  await page.getByRole('button', { name: '关闭引用预览' }).click();
  await page.getByRole('button', { name: '引用 src 目录' }).click();
  await page.getByRole('button', { name: '预览目录 src', exact: true }).click();
  await expect.element(page.getByRole('dialog', { name: '目录引用预览' })).toBeVisible();
  await expect.element(page.getByRole('button', { name: 'login.ts', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭引用预览' }).click();
  const input = composer().getBoundingClientRect(), send = page.getByRole('button', { name: '发送消息', exact: true }).element().getBoundingClientRect();
  expect(input.bottom).toBeLessThanOrEqual(send.top); expect(send.bottom).toBeLessThanOrEqual(844);
  expect(document.documentElement.scrollWidth).toBe(width);
  await page.screenshot({ path: `/tmp/context-reference-composer-${width}.png` });
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.element(page.getByRole('button', { name: '修改草稿' })).toBeVisible();
  expect(state.posts).toHaveLength(1);
  expect(parseChatDraft(state.posts[0]).attachments[0].context?.text).toContain('42 const line42');
  await page.getByRole('button', { name: '修改草稿' }).click();
  await page.getByRole('button', { name: '移除附件 src' }).click();
  await expect.element(page.getByRole('button', { name: '预览目录 src' })).not.toBeInTheDocument();
  state.succeed();
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.element(page.getByRole('button', { name: '修改草稿' })).not.toBeInTheDocument();
  await page.getByRole('button', { name: '预览代码 login.ts', exact: true }).click();
  await expect.element(page.getByRole('dialog', { name: '代码引用预览' })).toBeVisible();
  await page.screenshot({ path: `/tmp/context-reference-sent-${width}.png` });
});

it('retains a directory reference after a failed preview, retries, and closes without changing the question', async () => {
  await mount(); fixtures.directoryFailure = true;
  await page.getByRole('textbox', { name: '给Codex的消息' }).fill('目录的问题');
  await page.getByRole('button', { name: '引用 src 目录' }).click();
  await page.getByRole('button', { name: '预览目录 src' }).click();
  await expect.element(page.getByRole('button', { name: '重试读取目录' })).toBeVisible();
  fixtures.directoryFailure = false; await page.getByRole('button', { name: '重试读取目录' }).click();
  await expect.element(page.getByRole('button', { name: 'login.ts', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭引用预览' }).click();
  expect(readChatEditor(composer()).text).toContain('目录的问题');
  await expect.element(page.getByRole('button', { name: '移除附件 src' })).toBeVisible();
});
