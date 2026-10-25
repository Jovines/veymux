// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SessionAccessView } from './SessionAccessView';
import { useChatImagePreview } from '../components/chat/useChatImagePreview';
import type { SecureClient } from './secureClient';
import { useSessionCapabilities } from './ShareAccessContext';

vi.mock('@xterm/xterm', () => ({ Terminal: class {} }));
vi.mock('./SessionResourceSidebar', () => ({ SessionResourceSidebar: ({ open, pinned }: any) => <div data-testid="shared-sidebar" data-open={open} data-pinned={pinned} /> }));

vi.mock('../components/markdown/MarkdownPreview', () => ({ MarkdownImageLightbox: ({ images, index, onClose }: any) => <div role="dialog" aria-label="附件图片预览">{images[index].alt}<button onClick={onClose}>关闭图片</button></div> }));
vi.mock('../components/chat/SessionChatView', () => ({ SessionChatView: () => {
  const attachments = [{ name: '本会话图片.png', path: '/attachments/one/upload/image.png' }, { name: '其他会话图片.png', path: '/attachments/two/upload/image.png' }];
  const preview = useChatImagePreview(attachments), capabilities = useSessionCapabilities();
  return <div>{attachments.map(file => <button key={file.name} onClick={() => preview.onPreview?.(file)}>{file.name}</button>)}<span>{capabilities.has('session.input') ? '允许输入' : '禁止输入'}</span>{preview.preview}</div>;
} }));
afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('uses the pane width and starts narrow split sidebars closed', async () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 640, height: 600 } as DOMRect);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ mode: 'chat' })));
  const client = { targetPeerId: 'split-guest', request: vi.fn(async ({ type }) => type === 'permissions' ? { grants: [{ resources: { directories: [{ path: '/shared', access: 'read' }] } }] } : { items: ['one', 'two'].map(sessionId => ({ sessionId, name: sessionId, live: true, canWrite: false, canResize: false })) }) };
  render(<SessionAccessView client={client as unknown as SecureClient} initialViewMode="chat" initialViewLayout="split" />);
  const sidebars = await screen.findAllByTestId('shared-sidebar');
  expect(sidebars).toHaveLength(2);
  for (const sidebar of sidebars) {
    expect(sidebar.getAttribute('data-pinned')).toBe('false');
    expect(sidebar.getAttribute('data-open')).toBe('false');
  }
});

it('previews the authorized Session attachment without opening the file sidebar or enabling input', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ mode: 'chat' })));
  const client = { targetPeerId: 'attachment-guest', request: vi.fn(async ({ type }) => type === 'permissions' ? { grants: [] } : { items: [{ sessionId: 'one', attachmentRoot: '/attachments/one', name: '只读会话', live: true, canWrite: false, canResize: false }] }) };
  render(<SessionAccessView client={client as unknown as SecureClient} initialViewMode="chat" />);
  await screen.findByText('禁止输入');
  expect(screen.queryByRole('button', { name: /侧栏/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '其他会话图片.png' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '本会话图片.png' }));
  expect(await screen.findByRole('dialog', { name: '附件图片预览' })).toBeTruthy();
});
