// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SessionAccessView } from './SessionAccessView';
import type { SecureClient } from './secureClient';
const mocks = vi.hoisted(() => ({ osc: [] as Array<(data: string) => boolean>, upload: vi.fn(), selection: '', writes: [] as Array<{ data: string; callback?: () => void }>, resize: vi.fn(), options: {} as Record<string, unknown>, fit: vi.fn(), fontsReady: Promise.resolve(), dimensions: { cols: 120, rows: 40 } }));
vi.mock('../terminal/fontLoading', () => ({ ensureTerminalFontsReady: () => mocks.fontsReady }));
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  cols = 80; rows = 24;
  options: Record<string, unknown>;
  parser = { registerOscHandler: (_id: number, callback: (data: string) => boolean) => { mocks.osc.push(callback); return { dispose() {} }; } };
  buffer = { active: { type: 'normal', baseY: 0, viewportY: 0 } };
  constructor(options: Record<string, unknown>) { mocks.options = options; this.options = options; }
  loadAddon() {} open() {} dispose() {}
  attachCustomKeyEventHandler() {} getSelection() { return mocks.selection; } hasSelection() { return !!mocks.selection; }
  write(data: string, callback?: () => void) { mocks.writes.push({ data, callback }); }
  resize(cols: number, rows: number) { this.cols = cols; this.rows = rows; mocks.resize(cols, rows); }
  scrollToBottom() {} refresh() {}
  onData() { return { dispose() {} }; }
} }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { proposeDimensions() { mocks.fit(); return mocks.dimensions; } } }));
vi.mock('../terminal/api', async original => ({ ...await original<typeof import('../terminal/api')>(), uploadSessionAttachments: mocks.upload }));
beforeEach(() => { mocks.osc.length = 0; mocks.selection = ''; mocks.upload.mockReset(); mocks.upload.mockResolvedValue({ files: [{ path: '/attachments/photo.png' }] }); mocks.fontsReady = Promise.resolve(); mocks.dimensions = { cols: 120, rows: 40 }; });
afterEach(() => { cleanup(); mocks.writes.length = 0; vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('scoped encrypted terminal viewer', () => {
  it('sends resize only when its measured grid differs from the connected or pending grid', async () => {
    let notify = () => {};
    vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { notify = callback; } observe() {} disconnect() {} });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 1000, height: 600 } as DOMRect);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
    const socket = { readyState: 1, send: vi.fn(), close: vi.fn(), onopen: null as (() => void) | null, onmessage: null as ((event: { data: string }) => void) | null };
    const client = { targetPeerId: 'resize-dedup', request: vi.fn(async () => ({ items: [{ sessionId: 'backend', name: 'task', live: true, canWrite: true, canResize: true }] })), openSocket: vi.fn(() => socket) };
    render(<SessionAccessView client={client as unknown as SecureClient} />);
    await waitFor(() => expect(client.openSocket).toHaveBeenCalledOnce());
    act(() => socket.onopen!());
    expect(socket.send).not.toHaveBeenCalled();
    act(() => {
      socket.onmessage!({ data: JSON.stringify({ type: 'connected', cols: 120, rows: 40 }) });
      mocks.writes.at(-1)!.callback!(); notify(); notify();
    });
    expect(socket.send).not.toHaveBeenCalled();
    act(() => { mocks.dimensions = { cols: 121, rows: 40 }; notify(); notify(); });
    expect(socket.send).toHaveBeenCalledOnce();
    const request = JSON.parse(socket.send.mock.calls[0][0]);
    expect(request).toMatchObject({ type: 'resize', cols: 121, rows: 40 });
    act(() => { socket.onmessage!({ data: JSON.stringify({ type: 'resize-ack', ok: true, seq: request.seq, cols: 121, rows: 40 }) }); notify(); });
    expect(socket.send).toHaveBeenCalledOnce();
  });
  it('waits for fonts and advertises measured geometry on its first encrypted socket', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 1000, height: 600 } as DOMRect);
    let ready!: () => void;
    mocks.fontsReady = new Promise(resolve => { ready = resolve; });
    const socket = { readyState: 0, close: vi.fn() };
    const client = { targetPeerId: 'geometry', request: vi.fn(async () => ({ items: [{ sessionId: 'backend', name: 'task', live: true, canWrite: true, canResize: true }] })), openSocket: vi.fn((_url: string) => socket) };
    const view = render(<SessionAccessView client={client as unknown as SecureClient} />);
    await act(async () => {});
    expect(client.openSocket).not.toHaveBeenCalled();
    await act(async () => ready());
    await waitFor(() => expect(client.openSocket).toHaveBeenCalledOnce());
    const query = new URL(client.openSocket.mock.calls[0][0], 'https://fixture.local').searchParams;
    expect(query.get('cols')).toBe('120');
    expect(query.get('rows')).toBe('40');
    view.unmount();
  });

  it('does not open a stale terminal after unmounting during font initialization', async () => {
    let ready!: () => void;
    mocks.fontsReady = new Promise(resolve => { ready = resolve; });
    const client = { targetPeerId: 'cancel-geometry', request: vi.fn(async () => ({ items: [{ sessionId: 'backend', name: 'task', live: true, canWrite: true, canResize: true }] })), openSocket: vi.fn() };
    const view = render(<SessionAccessView client={client as unknown as SecureClient} />);
    await act(async () => {});
    view.unmount();
    await act(async () => ready());
    expect(client.openSocket).not.toHaveBeenCalled();
  });

  it('uses the real grid in read-only mode and acknowledges flowSeq only after xterm applies output', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    const socket = { readyState: 1, send: vi.fn(), close: vi.fn(), onopen: null, onmessage: null as ((e: { data: string }) => void) | null, onclose: null, onerror: null };
    const client = { targetPeerId: 'C', request: vi.fn(async () => ({ items: [{ sessionId: 'backend', sourceSessionId: 'frontend', name: 'task', live: true, canWrite: false, canResize: false }] })), openSocket: vi.fn(() => socket) };
    render(<SessionAccessView client={client as unknown as SecureClient} initialSessionId="frontend" />);
    await waitFor(() => expect(client.openSocket).toHaveBeenCalledOnce());
    act(() => socket.onmessage!({ data: JSON.stringify({ type: 'connected', replayChunks: ['screen'], replayOutOfWindow: true, replayLastSeq: 4, streamEpoch: 'epoch', cols: 120, rows: 40 }) }));
    expect(mocks.resize).toHaveBeenCalledWith(120, 40);
    expect(mocks.writes[0].data).toBe('\x1bcscreen');
    expect(mocks.options.disableStdin).toBe(true);
    expect(mocks.options.mouseEventsRequireAlt).toBe(true);
    expect(mocks.options.theme).toHaveProperty('background', '#1C1B1A');
    act(() => socket.onmessage!({ data: JSON.stringify({ type: 'data', data: 'output', flowSeq: 7, seq: 9 }) }));
    expect(socket.send).not.toHaveBeenCalled();
    act(() => mocks.writes[1].callback!());
    expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual({ type: 'output-ack', flowSeq: 7, since: 9, epoch: 'epoch' });
    expect(mocks.fit).not.toHaveBeenCalled();
  });
});

describe('shared terminal attachments and split scope', () => {
  beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }); sessionStorage.clear(); });
  function client(items = [{ sessionId: 'backend', sourceSessionId: 'stable', name: 'Shared task', live: true, canWrite: true, canResize: true }]) {
    const sockets: Array<{ readyState: number; send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }> = [];
    return { targetPeerId: 'attachments', request: vi.fn(async (packet: { type: string }) => packet.type === 'session-list' ? { items } : { grants: [] }), openSocket: vi.fn(() => { const socket = { readyState: 1, send: vi.fn(), close: vi.fn() }; sockets.push(socket); return socket; }), sockets };
  }
  it('uploads a pasted image through the stable Session attachment permission and inserts only its returned path', async () => {
    const connection = client();
    render(<SessionAccessView client={connection as unknown as SecureClient} />);
    await waitFor(() => expect(connection.openSocket).toHaveBeenCalledOnce());
    fireEvent.paste(screen.getByLabelText('共享终端'), { clipboardData: { files: [new File(['image'], 'photo.png', { type: 'image/png' })], getData: () => '' } });
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledOnce());
    expect(mocks.upload.mock.calls[0][0]).toBe('stable');
    await waitFor(() => expect(connection.sockets[0].send).toHaveBeenCalledWith(expect.stringContaining('/attachments/photo.png')));
    expect(connection.sockets[0].send.mock.calls[0][0]).toContain('200~');
  });
  it('blocks image paste and file drops for read-only recipients while retaining copy', async () => {
    const connection = client([{ sessionId: 'backend', sourceSessionId: 'stable', name: 'Shared task', live: true, canWrite: false, canResize: false }]);
    render(<SessionAccessView client={connection as unknown as SecureClient} />);
    await waitFor(() => expect(connection.openSocket).toHaveBeenCalledOnce());
    const data = { files: [new File(['data'], 'private.txt')], getData: () => '', types: ['Files'] };
    fireEvent.paste(screen.getByLabelText('共享终端'), { clipboardData: data });
    fireEvent.drop(screen.getByLabelText('共享终端'), { dataTransfer: data });
    await act(async () => {});
    expect(mocks.upload).not.toHaveBeenCalled(); expect(connection.sockets[0].send).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('上传文件到终端')).toBeNull();
    mocks.selection = 'selected output'; const setData = vi.fn();
    fireEvent.copy(screen.getByLabelText('共享终端'), { clipboardData: { setData } });
    expect(setData).toHaveBeenCalledWith('text/plain', 'selected output');
  });
  it('shares one authorized directory between two independent panes', async () => {
    const connection = client([{ sessionId: 'one', sourceSessionId: 'stable-one', name: 'One', live: true, canWrite: true, canResize: true }, { sessionId: 'two', sourceSessionId: 'stable-two', name: 'Two', live: true, canWrite: false, canResize: false }]);
    const view = render(<SessionAccessView client={connection as unknown as SecureClient} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '分屏查看' })).toBeTruthy());
    view.rerender(<SessionAccessView client={connection as unknown as SecureClient} initialViewLayout="split" />);
    await waitFor(() => expect(connection.openSocket).toHaveBeenCalledTimes(2));
    expect(connection.request.mock.calls.filter(([packet]) => packet.type === 'session-list')).toHaveLength(1);
    expect(screen.getAllByLabelText('共享终端')).toHaveLength(2);
    expect(screen.getAllByLabelText('上传文件到终端')).toHaveLength(1);
    view.unmount(); expect(connection.sockets.every(socket => socket.close.mock.calls.length === 1)).toBe(true);
  });
  it('does not insert a delayed upload into a newly selected Session', async () => {
    let complete!: (value: unknown) => void; mocks.upload.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const connection = client([{ sessionId: 'one', sourceSessionId: 'stable-one', name: 'One', live: true, canWrite: true, canResize: true }, { sessionId: 'two', sourceSessionId: 'stable-two', name: 'Two', live: true, canWrite: true, canResize: true }]);
    render(<SessionAccessView client={connection as unknown as SecureClient} initialSessionId="one" />);
    await waitFor(() => expect(connection.openSocket).toHaveBeenCalledOnce());
    fireEvent.paste(screen.getByLabelText('共享终端'), { clipboardData: { files: [new File(['image'], 'photo.png', { type: 'image/png' })], getData: () => '' } });
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Two' }));
    await waitFor(() => expect(connection.openSocket).toHaveBeenCalledTimes(2));
    await act(async () => { complete({ files: [{ path: '/attachments/photo.png' }] }); });
    expect(connection.sockets.every(socket => !socket.send.mock.calls.length)).toBe(true);
  });
});

describe('ordinary shared terminal copy', () => {
  beforeEach(() => { sessionStorage.clear(); vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }); });
  function fixture() {
    const socket = { readyState: 1, send: vi.fn(), close: vi.fn(), onmessage: null as ((event: { data: string }) => void) | null };
    const client = { targetPeerId: 'copy', closed: false, request: vi.fn(async () => ({ items: [{ sessionId: 'one', name: 'One', live: true, canWrite: true, canResize: true }] })), openSocket: vi.fn(() => socket) };
    const view = render(<SessionAccessView client={client as unknown as SecureClient} />);
    return { socket, client, view };
  }
  it('copies a tmux selection over the bound secure socket without a local xterm selection', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { socket, client } = fixture(); await waitFor(() => expect(client.openSocket).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByLabelText('复制终端选区'));
    const request = JSON.parse(socket.send.mock.calls[0][0]); expect(request).toMatchObject({ type: 'tmux', action: 'copy-selection' });
    await act(async () => socket.onmessage!({ data: JSON.stringify({ type: 'tmux-result', reqId: request.reqId, success: true, selection: { status: 'copied', paneId: '%0', text: 'terminal output', bytes: 15 } }) }));
    expect(writeText).toHaveBeenCalledWith('terminal output');
  });
  it('suppresses clipboard commands in replay while accepting live tmux clipboard output', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { socket, client } = fixture(); await waitFor(() => expect(client.openSocket).toHaveBeenCalledOnce());
    act(() => socket.onmessage!({ data: JSON.stringify({ type: 'connected', replayChunks: ['replay'], cols: 100, rows: 30 }) }));
    await act(async () => { mocks.osc[0]('c;' + btoa('old clipboard')); }); expect(writeText).not.toHaveBeenCalled();
    act(() => mocks.writes.at(-1)!.callback!());
    await act(async () => { mocks.osc[0]('c;' + btoa('live selection')); }); expect(writeText).toHaveBeenCalledWith('live selection');
  });
  it('does not copy a late tmux response after the viewer has unmounted', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { client, view } = fixture(); await waitFor(() => expect(client.openSocket).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByLabelText('复制终端选区')); view.unmount(); await act(async () => {});
    expect(writeText).not.toHaveBeenCalled();
  });
});
