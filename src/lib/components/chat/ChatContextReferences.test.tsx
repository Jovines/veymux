// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SessionChatView } from './SessionChatView';
import { readChatEditor, setChatEditorCaret } from './ChatRichEditor';
import { attachmentToken, composeChatDraft, parseChatDraft } from './chatComposerContent';
import { clearChatSnapshots } from './chatSnapshot';
import { requestReferenceInsertion } from '../sidebar/requestReferenceInsertion';
import { createOwnedTerminalPasteRequest, releaseOwnedTerminalPasteRequest } from '../../terminal/ownedPaste';
import type { ContextReference } from '../../terminal/contextReference';
import { writeFileReferenceDrag } from './fileReferenceTransfer';
import { SessionCapabilitiesContext, ShareAccessContext } from '../../federation/ShareAccessContext';
import { sharedSessionCapabilities } from '../../federation/sessionCapabilities';

const file: ContextReference = { kind: 'file', path: '/workspace/login.ts', text: '/workspace/login.ts ' };
const code: ContextReference = { kind: 'code', path: '/workspace/login.ts', lines: { start: 42, end: 48 }, text: '/workspace/login.ts:42-48\n```ts\n42 throw new Error("登录失败");\n```\n' };
const posts: { content: string; requestId: string }[] = [];
beforeEach(() => {
  posts.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (_url, init?: RequestInit) => {
    if (init?.method === 'POST') { posts.push(JSON.parse(String(init.body))); throw new Error('offline'); }
    return Response.json({ agentAvailable: true, messages: [] });
  }));
});
afterEach(() => { cleanup(); clearChatSnapshots(); sessionStorage.clear(); vi.unstubAllGlobals(); });
const editor = () => screen.getByRole('textbox') as HTMLElement;
const text = () => readChatEditor(editor()).text;
function type(value: string) { const node = editor(); node.replaceChildren(document.createTextNode(value)); setChatEditorCaret(node, value.length); fireEvent.input(node); }
async function mount(active = true, canWrite = true) { const view = render(<SessionChatView sessionId="context-reference" active={active} canWrite={canWrite} onTerminal={() => {}} />); await screen.findByText('想一起完成什么？'); return view; }
function insert(reference: ContextReference, extra: object = {}) {
  fireEvent(window, new CustomEvent('termdock-insert-reference', { detail: { sessionId: 'context-reference', text: reference.text, reference, ...extra } }));
}

it('keeps typed/pasted paths, code and lookalike labels as text; only explicit metadata creates a block', async () => {
  await mount();
  const ordinary = `${code.text}\n【文件1】 【代码1】 user@example.com`;
  type(ordinary); expect(document.querySelector('[data-chat-inline-token]')).toBeNull();
  fireEvent(window, new CustomEvent('termdock-insert-reference', { detail: { sessionId: 'context-reference', text: file.text } }));
  expect(document.querySelector('[data-chat-inline-token]')).toBeNull();
  expect(text()).toContain(ordinary);
  insert(file);
  expect(screen.getByRole('button', { name: '预览文件 login.ts' })).toBeTruthy();
  expect(document.querySelectorAll('[data-chat-inline-token]')).toHaveLength(1);
  expect(text()).toContain('【文件1】 【代码1】');
  expect(posts).toHaveLength(0);
});

it.each([{ ...file, path: 'https://example.com/file' }, { ...code, lines: { start: 48, end: 42 } }, { ...file, text: '/different' }])('ignores malformed or mismatched metadata without converting normal input (%j)', async reference => {
  await mount(); insert(reference, { text: file.text });
  expect(document.querySelector('[data-chat-inline-token]')).toBeNull();
  expect(text()).toBe(file.text);
});

it('retains exact source selections through send failure, editing and remount; removes just one reference', async () => {
  let view = await mount(); type('请检查 '); insert(file); insert(code);
  expect(screen.getByRole('button', { name: '预览代码 login.ts' })).toBeTruthy();
  expect(editor().textContent).toContain('login.ts · L42–48');
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
  await screen.findByRole('button', { name: '修改草稿' });
  const sent = parseChatDraft(posts[0].content);
  expect(sent.attachments).toHaveLength(2);
  expect(sent.attachments[1].context).toMatchObject(code);
  expect(sent.text).toContain(attachmentToken(sent.attachments[1]));
  expect(composeChatDraft(sent.text, sent.attachments, sent.mentions)).toBe(posts[0].content);
  fireEvent.click(screen.getByRole('button', { name: '修改草稿' }));
  view.unmount(); view = await mount();
  fireEvent.click(screen.getAllByRole('button', { name: '移除附件 login.ts' })[0]);
  expect(screen.queryByRole('button', { name: '预览文件 login.ts' })).toBeNull();
  expect(screen.getByRole('button', { name: '预览代码 login.ts' })).toBeTruthy();
  expect(text()).toContain('请检查');
  expect(text()).not.toContain(attachmentToken(sent.attachments[0]));
  view.unmount();
});

it('preserves the original terminal payload while carrying optional chat metadata', async () => {
  const source = document.createElement('button'); document.body.append(source);
  const receive = vi.fn((event: Event) => {
    const detail = (event as CustomEvent).detail;
    expect(detail.text).toBe(code.text);
    expect(detail.reference).toMatchObject({ ...code, text: code.text });
    expect(detail.submitAfterPaste).toBe(false);
    window.dispatchEvent(new CustomEvent('termdock-insert-reference-ack', { detail: { nonce: detail.nonce, ok: true } }));
  });
  window.addEventListener('termdock-insert-reference', receive);
  try { expect(await requestReferenceInsertion(code.text, 'terminal', () => true, source, { reference: code })).toBe(true); expect(receive).toHaveBeenCalledOnce(); }
  finally { window.removeEventListener('termdock-insert-reference', receive); source.remove(); }
});

it('requires the matching session, permission and owned input scope', async () => {
  const view = await mount();
  insert(file, { sessionId: 'another' });
  insert(file, { nonce: 'forged', ownedPaste: true });
  expect(text()).toBe('');
  view.rerender(<SessionChatView sessionId="context-reference" canWrite={false} onTerminal={() => {}} />);
  insert(file); expect(text()).toBe('');
  view.rerender(<SessionChatView sessionId="context-reference" active={false} onTerminal={() => {}} />);
  insert(file); expect(text()).toBe('');
  view.rerender(<SessionChatView sessionId="context-reference" onTerminal={() => {}} />);
  const source = document.createElement('button'); document.body.append(source);
  const owned = createOwnedTerminalPasteRequest(source, 'context-reference', file.text)!;
  try { act(() => window.dispatchEvent(new CustomEvent('termdock-insert-reference', { detail: { ...owned, reference: file } }))); expect(screen.getByRole('button', { name: '预览文件 login.ts' })).toBeTruthy(); }
  finally { releaseOwnedTerminalPasteRequest(owned.nonce); source.remove(); }
});

it('opens captured code independently of changed files and dismisses it without losing the draft', async () => {
  await mount(); type('保留问题 '); insert(code);
  fireEvent.click(screen.getByRole('button', { name: '预览代码 login.ts' }));
  const dialog = await screen.findByRole('dialog', { name: '代码引用预览' });
  await waitFor(() => expect(dialog.textContent).toContain('登录失败'));
  fireEvent.click(screen.getByRole('button', { name: '关闭引用预览' }));
  expect(text()).toContain('保留问题');
  expect(screen.getByRole('button', { name: '移除附件 login.ts' })).toBeTruthy();
});

it('preserves literal metadata examples as user text, including after sending', async () => {
  const literal = '```termdock-context\n' + JSON.stringify({ attachments: [{ path: file.path, name: 'login.ts', reference: '文件1', context: file }], mentions: [] }) + '\n```';
  const result = parseChatDraft(composeChatDraft(literal, [], []));
  expect(result.text).toBe(literal);
  expect(result.attachments).toEqual([]);
  await mount(); type(literal);
  expect(document.querySelector('[data-chat-inline-token]')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
  await screen.findByRole('button', { name: '修改草稿' });
  expect(parseChatDraft(posts[0].content)).toEqual({ text: literal, attachments: [], mentions: [] });
});

it('keeps ordinary paste and text drags literal while file-tree drags carry explicit references', async () => {
  await mount();
  fireEvent.paste(editor(), { clipboardData: { files: [], getData: () => code.text } });
  expect(text()).toBe(code.text);
  expect(document.querySelector('[data-chat-inline-token]')).toBeNull();
  const values = new Map<string, string>();
  const transfer = { files: [], types: [] as string[], setData: (type: string, value: string) => values.set(type, value), getData: (type: string) => values.get(type) || '' };
  transfer.setData('text/plain', file.text);
  fireEvent.drop(editor(), { dataTransfer: transfer });
  expect(document.querySelector('[data-chat-inline-token]')).toBeNull();
  writeFileReferenceDrag(transfer, file.text, file);
  fireEvent.drop(editor(), { dataTransfer: transfer });
  expect(screen.getByRole('button', { name: '预览文件 login.ts' })).toBeTruthy();
  expect(posts).toHaveLength(0);
});

it.each([undefined, { directories: [{ path: '/shared', access: 'read' as const }] }])('never opens resources without grants or outside the granted directory (%j)', async resources => {
  render(<ShareAccessContext.Provider value={resources ?? {}}><SessionCapabilitiesContext.Provider value={sharedSessionCapabilities({ canWrite: true }, resources)}><SessionChatView sessionId="context-reference" onTerminal={() => {}} /></SessionCapabilitiesContext.Provider></ShareAccessContext.Provider>);
  await screen.findByText('想一起完成什么？');
  insert({ ...file, path: '/shared/../private/login.ts' });
  const preview = screen.queryByRole('button', { name: '预览文件 login.ts' });
  if (preview) fireEvent.click(preview);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(vi.mocked(fetch).mock.calls.some(([path]) => String(path).includes('/fs/'))).toBe(false);
});
