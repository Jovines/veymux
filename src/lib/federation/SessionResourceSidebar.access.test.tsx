// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SessionResourceSidebar } from './SessionResourceSidebar';
import { useSidebarStore } from '../stores/useSidebarStore';
import { StrictMode } from 'react';

vi.mock('../components/sidebar/Sidebar', () => ({ Sidebar: ({ children }: any) => <aside>{children}</aside> }));
vi.mock('../components/sidebar/FileTree', () => ({ FileTree: ({ rootPath, onFileSelect, onPathReference }: any) => <div><button onClick={() => onFileSelect(`${rootPath}/file.txt`)}>打开测试文件</button>{onPathReference && <button onClick={() => onPathReference(`${rootPath}/file.txt`)}>插入文件引用</button>}</div> }));
vi.mock('../components/sidebar/RightSidebar', () => ({ FilePreview: ({ canInsertReference }: any) => <div>已打开文件{canInsertReference && <button>预览内插入引用</button>}</div> }));
vi.mock('../terminal/api', () => ({ readFileContent: vi.fn(async () => ({ content: 'original', size: 8, binary: false })) }));
const before = useSidebarStore.getState();
afterEach(() => { cleanup(); useSidebarStore.setState(before); });

it('hides reference insertion for read-only sessions while keeping separately granted file editing available', async () => {
  render(<SessionResourceSidebar resources={{ directories: [{ path: '/allowed', access: 'write' }] }} canWrite={false} pinned open onClose={() => {}} onInsert={() => false} />);
  expect(screen.queryByRole('button', { name: '插入文件引用' })).toBeNull();
  expect(screen.getByRole('button', { name: '上传' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '打开测试文件' }));
  await screen.findByText('已打开文件');
  expect(screen.queryByRole('button', { name: '预览内插入引用' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '编辑' }));
  expect(await screen.findByRole('textbox', { name: '编辑文件内容' })).toBeTruthy();
});

it('allows file references for writable sessions but keeps read-only directories uneditable', async () => {
  render(<SessionResourceSidebar resources={{ directories: [{ path: '/allowed', access: 'read' }] }} canWrite pinned open onClose={() => {}} onInsert={() => true} />);
  expect(screen.getByRole('button', { name: '插入文件引用' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '上传' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '打开测试文件' }));
  expect(await screen.findByRole('button', { name: '预览内插入引用' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '编辑' })).toBeNull();
});
it('opens the shared editor under the application StrictMode lifecycle', async () => {
  render(<StrictMode><SessionResourceSidebar resources={{ directories: [{ path: '/allowed', access: 'write' }] }} pinned open onClose={() => {}} onInsert={() => false} /></StrictMode>);
  fireEvent.click(screen.getByRole('button', { name: '打开测试文件' }));
  fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
  expect(await screen.findByRole('textbox', { name: '编辑文件内容' })).toBeTruthy();
});
