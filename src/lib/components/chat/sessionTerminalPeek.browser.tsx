import { createRoot, type Root } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import '../../../index.css';
import { ChatUserMessage } from './ChatTimeline';
import { composeChatDraft } from './chatComposerContent';
import { SessionWorkspace } from './SessionWorkspace';
import { AgentFloatingSessionButtons } from '../AgentIndicators';
import { sessionNeedsReview } from '../../utils/agentAttention';
import { SplitPaneTitle } from '../SplitPaneTitle';
import { SessionModeSwitch } from './SessionModeSwitch';
import { TerminalView } from '../views/TerminalView';
import { useTerminalStore } from '../../stores/useTerminalStore';
import { getDefaultTerminalSettings } from '../../terminal/settings';
import type { TerminalHandlers } from '../../terminal/types';
import { clearChatSnapshots } from './chatSnapshot';
import { TerminalGeometry } from '../../terminal/geometry';
const backend = vi.hoisted(() => ({ inputs: vi.fn(), connect: vi.fn(), resize: vi.fn(), close: vi.fn(), handlers: undefined as TerminalHandlers | undefined }));
vi.mock('../../terminal/factory', () => ({ createTermdockAPI: () => ({
  connect: (_id: string, handlers: TerminalHandlers) => {
    backend.connect(); backend.handlers = handlers;
    queueMicrotask(() => { handlers.onEvent({ type: 'connected', mode: 'shell', cwd: '/tmp' }); handlers.onEvent({ type: 'data', data: '\r\nlive attach output\r\n' }); handlers.onEvent({ type: 'terminal-output-activity', active: true }); });
    return { close: backend.close };
  },
  sendInput: async (_id: string, text: string) => { backend.inputs(text); if (!/[\x00-\x1f\x7f]/.test(text)) backend.handlers?.onEvent({ type: 'data', data: text }); },
  resize: async (size: { seq: number; cols: number; rows: number }) => { backend.resize(size); queueMicrotask(() => backend.handlers?.onEvent({ type: 'resize-ack', ok: true, ...size })); },
}) }));
declare module 'vitest/browser' { interface BrowserCommands { peekMove(selector: string, x?: number, y?: number): Promise<void>; peekResize(dx: number, dy: number): Promise<void> } }
let root: Root | undefined, sessionId = '';
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
afterEach(async () => {
  root?.unmount(); root = undefined; useTerminalStore.getState().clearAllTerminalSessions(); clearChatSnapshots();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); document.body.replaceChildren(); localStorage.clear(); sessionStorage.clear();
  await page.viewport(1280, 900);
});
async function mount(width = 1280, withAssistant = false, paneTitle = false, replyCount = 1, withAttention = false) {
  await page.viewport(width, 900);
  // Start outside any trigger left under the pointer by the previous journey.
  await commands.peekMove('html', .99, .005);
  sessionId = `peek-${Date.now()}`; let mode = 'chat', replyPending = true;
  localStorage.setItem(`termdock:session-view:${location.origin}:${sessionId}`, mode);
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (String(url).includes('/view-mode')) { if (init?.body) mode = JSON.parse(String(init.body)).mode; return Response.json({ mode, chatEligibility: { allowed: true, program: 'codex' } }); }
    if (String(url).includes('/chat')) return Response.json({ agentAvailable: true, agent: { displayName: 'Codex', slug: 'codex' }, replyPending, messages: [{ id: 'u1', role: 'user', content: '检查构建输出', createdAt: 1, status: 'delivered' }, ...(withAssistant ? Array.from({ length: replyCount }, (_, i) => ({ id: `a${i + 1}`, role: 'assistant', content: i ? `继续检查第 ${i + 1} 项构建结果` : '正在检查构建输出', createdAt: i + 2, status: 'stored' })) : [])] });
    return Response.json({});
  }));
  useTerminalStore.getState().setTerminalSession(sessionId, { sessionId: 'backend-peek', mode: 'shell', cols: 120, rows: 32, cwd: '/tmp' });
  useTerminalStore.getState().replaceBuffer(sessionId, ['isolated terminal output\r\n$ ']);
  const host = document.createElement('div'); host.className = 'h-screen flex flex-col'; document.body.append(host);
  root = createRoot(host);
  function Attention() {
    const count = useTerminalStore(state => [...state.sessions.values()].filter(sessionNeedsReview).length);
    return <AgentFloatingSessionButtons reviewCount={count} runningSessions={[]} activeSessionId={sessionId} runningButtonEnabled={false} isDesktopLayout={width >= 1024} containerElement={host} />;
  }
  root.render(<><header data-test-session-header className={paneTitle ? 'h-6 shrink-0' : 'h-12 shrink-0'}>{paneTitle ? <SplitPaneTitle session={{ id: sessionId, name: '构建检查', customName: true, mode: 'shell', tmuxSessionName: null }} active onActivate={() => {}} /> : <SessionModeSwitch sessionId={sessionId} />}</header><main className="flex-1 min-h-0"><SessionWorkspace sessionId={sessionId} name="构建检查" active>{(visible, interactive) => <TerminalView sessionId={sessionId} mode="shell" isActive isLayoutVisible={visible} focusSuspended={!interactive} suppressKeyboard={!visible} terminalSettings={{ ...getDefaultTerminalSettings(), rendererMode: 'canvas', enableImages: false, fontLigatures: false }} />}</SessionWorkspace></main>{withAttention && <Attention />}</>);
  await expect.element(page.getByText('处理中…')).toBeVisible(); await frame();
  return { completeReply: () => { replyPending = false; window.dispatchEvent(new Event('online')); } };
}
it.each([1280, 390])('baseline: switches between chat and the retained full terminal at width %i', async width => {
  await mount(width);
  const editor = document.querySelector('[data-session-chat] [role="textbox"]') as HTMLElement;
  editor.focus(); await userEvent.keyboard('保留聊天草稿');
  const input = document.querySelector('textarea[data-terminal-input-anchor]');
  await page.getByRole('button', { name: '切换到终端' }).click();
  await expect.poll(() => document.querySelector('.xterm-rows')?.textContent).toContain('isolated terminal output');
  expect(document.querySelector('textarea[data-terminal-input-anchor]')).toBe(input);
  await page.getByRole('button', { name: '切换到对话' }).click();
  expect(editor.textContent).toContain('保留聊天草稿');
  expect(backend.connect).toHaveBeenCalledTimes(1);
});

it.each([1280, 390])('measures and synchronizes the new Agent terminal behind chat before sending its startup command at width %i', async width => {
  await page.viewport(width, 900);
  sessionId = `chat-startup-${width}-${Date.now()}`;
  localStorage.setItem(`termdock:session-view:${location.origin}:${sessionId}`, 'chat');
  vi.stubGlobal('fetch', vi.fn(async url => String(url).includes('/view-mode') ? Response.json({ mode: 'chat' })
    : String(url).includes('/chat') ? Response.json({ agentAvailable: false, messages: [] }) : Response.json({})));
  useTerminalStore.getState().setTerminalSession(sessionId, { sessionId: 'startup-backend', mode: 'shell', cols: 80, rows: 24, cwd: '/tmp' });
  const launch = vi.fn();
  function Startup() {
    const [pending, setPending] = useState(true), [stream, setStream] = useState(false), [viewport, setViewport] = useState(false), [content, setContent] = useState(false);
    useEffect(() => { if (pending && stream && viewport && content) { launch('codex\r'); setPending(false); } }, [pending, stream, viewport, content]);
    return <SessionWorkspace sessionId={sessionId} name="新建 Codex" active terminalStartupPending={pending}>{(visible, interactive) => <TerminalView
      sessionId={sessionId} mode="shell" isActive isLayoutVisible={visible} focusSuspended={!interactive} suppressKeyboard={!visible}
      terminalSettings={{ ...getDefaultTerminalSettings(), rendererMode: 'canvas', enableImages: false, fontLigatures: false }}
      onStreamReadyChange={(_id, ready) => setStream(ready)} onViewportReadyChange={(_id, ready) => setViewport(ready)} onContentReadyChange={(_id, ready) => setContent(ready)} />}</SessionWorkspace>;
  }
  const host = document.createElement('div'); host.className = 'h-screen'; document.body.append(host); root = createRoot(host); root.render(<Startup />);
  await expect.element(page.getByRole('textbox', { name: '给助手的消息' })).toBeVisible();
  const editor = document.querySelector('[data-session-chat] [role="textbox"]') as HTMLElement;
  editor.focus();
  await expect.poll(() => launch.mock.calls).toEqual([['codex\r']]);
  expect(backend.resize.mock.calls.some(([size]) => size.cols > 80 && size.rows > 24)).toBe(width === 1280);
  expect(backend.resize.mock.calls.length).toBeGreaterThan(0);
  expect(document.activeElement).toBe(editor);
  expect(backend.connect).toHaveBeenCalledOnce();
  expect(document.querySelector('[data-session-workspace] > [aria-hidden="true"]')).toBeNull();
  await expect.element(page.elementLocator(document.querySelector('.xterm')!)).not.toBeVisible();
});

it('moves the same complete terminal into a hover bubble, accepts input, and closes immediately outside', async () => {
  await mount();
  const editor = document.querySelector('[data-session-chat] [role="textbox"]') as HTMLElement;
  editor.focus(); await userEvent.keyboard('聊天草稿不变');
  const input = document.querySelector<HTMLTextAreaElement>('textarea[data-terminal-input-anchor]')!;
  const viewport = document.querySelector('.xterm')!, toolbar = document.querySelector('[data-mobile-keyboard]');
  await page.getByRole('button', { name: '查看终端详情' }).hover();
  await expect.element(page.getByRole('dialog', { name: '会话终端预览' })).toBeVisible();
  const panel = document.querySelector<HTMLElement>('[data-terminal-peek]')!;
  expect(panel.querySelector('textarea[data-terminal-input-anchor]')).toBe(input);
  expect(panel.querySelector('.xterm')).toBe(viewport);
  expect(document.activeElement).toBe(editor);
  expect(panel.getBoundingClientRect().right).toBeLessThanOrEqual(innerWidth);
  expect(panel.getBoundingClientRect().bottom).toBeLessThanOrEqual(innerHeight);
  const below = parseFloat(panel.style.paddingTop) > 0;
  await commands.peekMove('[data-chat-terminal-access] [data-terminal-peek-trigger]', .5, below ? 1.1 : -.1);
  expect(document.querySelector('[data-terminal-peek]')).toBe(panel);
  await commands.peekMove('[data-terminal-peek] .xterm');
  expect(document.activeElement).toBe(editor);
  expect(document.querySelector('[data-terminal-peek]')).toBe(panel);
  await page.elementLocator(panel.querySelector('.xterm')!).click();
  await expect.poll(() => document.activeElement === input).toBe(true);
  await userEvent.keyboard('hello{Enter}{Escape}{Control>}c{/Control}');
  await expect.poll(() => backend.inputs.mock.calls.map(([text]) => text).join('')).toContain('hello\r\x1b\x03');
  expect(editor.textContent).toBe('聊天草稿不变');
  if (toolbar) expect(panel.contains(toolbar)).toBe(true);
  await page.screenshot({ path: `/tmp/termdock-terminal-peek-dpr${devicePixelRatio}.png` });
  await page.getByRole('button', { name: '查看终端详情' }).hover();
  expect(document.querySelector('[data-terminal-peek]')).toBe(panel);
  await commands.peekMove('body', .99, .005);
  await expect.poll(() => document.querySelector('[data-terminal-peek]')).toBeNull();
  await expect.poll(() => document.activeElement === editor).toBe(true);
  expect(document.querySelector('textarea[data-terminal-input-anchor]')).toBe(input);
  expect(backend.connect).toHaveBeenCalledTimes(1);
  expect(backend.close).not.toHaveBeenCalled();
});
it('reopens and expands the retained terminal without losing state or reconnecting', async () => {
  await mount();
  const input = document.querySelector('textarea[data-terminal-input-anchor]');
  await page.getByRole('button', { name: '查看终端详情' }).hover();
  await expect.element(page.getByRole('dialog', { name: '会话终端预览' })).toBeVisible();
  await expect.poll(() => backend.resize.mock.calls.length).toBeGreaterThan(0);
  const peekCols = backend.resize.mock.lastCall![0].cols;
  expect(peekCols).toBeGreaterThan(40);
  await commands.peekMove('body', .99, .005);
  await expect.poll(() => document.querySelector('[data-terminal-peek]')).toBeNull();
  await page.getByRole('button', { name: '查看终端详情' }).hover();
  await page.getByRole('button', { name: '在完整会话中打开终端' }).click();
  await expect.poll(() => backend.resize.mock.lastCall?.[0].cols).toBeGreaterThan(peekCols);
  await expect.poll(() => document.querySelector('[data-terminal-peek]')).toBeNull();
  await expect.element(page.getByRole('button', { name: '切换到对话' })).toBeVisible();
  expect(document.querySelector('textarea[data-terminal-input-anchor]')).toBe(input);
  await expect.poll(() => document.querySelector('.xterm-rows')?.textContent).toContain('isolated terminal output');
  expect(backend.connect).toHaveBeenCalledTimes(1);
  expect(backend.close).not.toHaveBeenCalled();
});

it('keeps toolbar shortcuts, live output and reconnect handling working while hovering the retained terminal', async () => {
  const { completeReply } = await mount();
  await page.getByRole('button', { name: '查看终端详情' }).hover();
  await expect.element(page.getByRole('dialog', { name: '会话终端预览' })).toBeVisible();
  const panel = document.querySelector('[data-terminal-peek]')!;
  await page.elementLocator(panel).getByRole('button', { name: 'Esc', exact: true }).click();
  await expect.poll(() => backend.inputs.mock.calls.map(([text]) => text).join('')).toContain('\x1b');
  await page.elementLocator(panel).getByRole('button', { name: 'Ctrl-C', exact: true }).click();
  await expect.poll(() => backend.inputs.mock.calls.map(([text]) => text).join('')).toContain('\x03');
  backend.handlers!.onEvent({ type: 'reconnecting' }); await frame();
  backend.handlers!.onEvent({ type: 'connected', mode: 'shell' });
  backend.handlers!.onEvent({ type: 'data', data: '\r\nreconnected live output\r\n$ ' });
  backend.handlers!.onEvent({ type: 'terminal-output-activity', active: true });
  await expect.poll(() => panel.querySelector('.xterm-rows')?.textContent).toContain('reconnected live output');
  await commands.peekMove('[data-terminal-peek] .xterm');
  completeReply();
  await expect.element(page.getByText('处理中…')).toBeVisible();
  expect(document.querySelector('[data-terminal-peek]')).toBe(panel);
  await page.elementLocator(panel.querySelector('.xterm')!).click();
  await userEvent.keyboard('after-reconnect');
  await expect.poll(() => backend.inputs.mock.calls.map(([text]) => text).join('')).toContain('after-reconnect');
  await commands.peekMove('body', .99, .005);
  await expect.poll(() => document.querySelector('[data-terminal-peek]')).toBeNull();
});

it('opens the same preview on devices without hover', async () => {
  await mount(390);
  const media = window.matchMedia.bind(window);
  vi.spyOn(window, 'matchMedia').mockImplementation(query => query === '(hover: hover) and (pointer: fine)' ? { matches: false } as MediaQueryList : media(query));
  await page.getByRole('button', { name: '查看终端详情' }).click();
  await expect.element(page.getByRole('dialog', { name: '会话终端预览' })).toBeVisible();
  await expect.element(page.getByRole('button', { name: '切换到终端' })).toBeVisible();
  await expect.poll(() => document.querySelector('[data-terminal-peek] .xterm-rows')?.textContent).toContain('isolated terminal output');
});

it('opens the terminal after dwelling on the agent avatar or name and cancels a brief hover', async () => {
  await mount(1280, true);
  await commands.peekMove('body', .99, .005);
  await expect.poll(() => document.querySelector('[data-terminal-peek]')).toBeNull();
  const editor = document.querySelector('[data-session-chat] [role="textbox"]') as HTMLElement;
  editor.focus();
  const input = document.querySelector('textarea[data-terminal-input-anchor]');
  const trigger = page.getByRole('button', { name: '查看Codex的终端' });
  await trigger.hover();
  await new Promise(resolve => setTimeout(resolve, 80));
  expect(document.querySelector('[data-terminal-peek]')).toBeNull();
  await commands.peekMove('body', .99, .005);
  await new Promise(resolve => setTimeout(resolve, 250));
  expect(document.querySelector('[data-terminal-peek]')).toBeNull();
  const button = document.querySelector('[data-terminal-peek-delay="200"]')!;
  await page.elementLocator(button.querySelector('[aria-hidden="true"]')!).hover();
  await expect.element(page.getByRole('dialog', { name: '会话终端预览' })).toBeVisible();
  const panel = document.querySelector('[data-terminal-peek]')!;
  expect(panel.querySelector('textarea[data-terminal-input-anchor]')).toBe(input);
  expect(document.activeElement).toBe(editor);
  await commands.peekMove('[data-terminal-peek] .xterm');
  expect(document.querySelector('[data-terminal-peek]')).toBe(panel);
  await commands.peekMove('body', .99, .005);
  await expect.poll(() => document.querySelector('[data-terminal-peek]')).toBeNull();
  await trigger.hover();
  await expect.element(page.getByRole('dialog', { name: '会话终端预览' })).toBeVisible();
  expect(backend.connect).toHaveBeenCalledTimes(1);
});

it('fits the view toggle into a split pane title and switches without reconnecting', async () => {
  await mount(1280, false, true);
  const header = document.querySelector('[data-pane-titlebar]')!;
  const input = document.querySelector('textarea[data-terminal-input-anchor]');
  const toTerminal = page.elementLocator(header).getByRole('button', { name: '切换到终端' });
  expect(header.getBoundingClientRect().height).toBe(24);
  const button = header.querySelector<HTMLButtonElement>('[aria-label="切换到终端"]')!;
  expect(button.getBoundingClientRect().height).toBe(header.clientHeight);
  expect(header.querySelector('[data-split-pane-title]')?.contains(button)).toBe(false);
  await toTerminal.click();
  await expect.poll(() => document.querySelector('.xterm-rows')?.textContent).toContain('isolated terminal output');
  await page.elementLocator(header).getByRole('button', { name: '切换到对话' }).click();
  await expect.element(page.getByText('处理中…')).toBeVisible();
  expect(document.querySelector('textarea[data-terminal-input-anchor]')).toBe(input);
  expect(backend.connect).toHaveBeenCalledTimes(1);
});

it('follows server transitions independently of completed replies, raw data and reconnect replay', async () => {
  const { completeReply } = await mount(1280, true); completeReply();
  await page.getByRole('button', { name: '查看Codex的终端' }).hover();
  await commands.peekMove('[data-terminal-peek] .xterm');
  const panel = document.querySelector('[data-terminal-peek]');
  backend.handlers!.onEvent({ type: 'terminal-output-activity', active: false });
  await expect.poll(() => document.querySelector('[data-chat-reply-status]')).toBeNull();
  expect(document.querySelector('[data-terminal-peek]')).toBe(panel);
  backend.handlers!.onEvent({ type: 'data', data: '\r\nnew real output\r\n' });
  await frame(); expect(document.querySelector('[data-chat-reply-status]')).toBeNull();
  backend.handlers!.onEvent({ type: 'terminal-output-activity', active: true });
  await expect.element(page.getByText('处理中…')).toBeVisible();
  backend.handlers!.onEvent({ type: 'reconnecting' });
  await expect.poll(() => document.querySelector('[data-chat-reply-status]')).toBeNull();
  backend.handlers!.onEvent({ type: 'connected', mode: 'shell', replayChunks: ['history-only'], replayOutOfWindow: true });
  await frame(); expect(document.querySelector('[data-chat-reply-status]')).toBeNull();
  backend.handlers!.onEvent({ type: 'terminal-output-activity', active: true });
  await expect.element(page.getByText('处理中…')).toBeVisible();
  await commands.peekMove('body', .99, .005);
  await expect.poll(() => document.querySelector('[data-terminal-peek]')).toBeNull();
});

// Regression: repeatedly inspecting an idle reply must not change the PTY grid.
it('keeps the terminal grid stable across repeated previews of the same reply', async () => {
  const fit = vi.spyOn(TerminalGeometry.prototype, 'fit');
  await mount(1470, true);
  backend.handlers!.onEvent({ type: 'terminal-output-activity', active: false });
  const trigger = page.getByRole('button', { name: '查看Codex的终端' });
  for (let i = 0; i < 3; i++) {
    await trigger.hover();
    await expect.element(page.getByRole('dialog', { name: '会话终端预览' })).toBeVisible();
    await new Promise(resolve => setTimeout(resolve, 600));
    expect(backend.resize.mock.calls, JSON.stringify({calls: backend.resize.mock.calls, fits: fit.mock.results.map(result => result.value).filter(Boolean)})).toHaveLength(1);
    await commands.peekMove('body', .99, .005);
    await expect.poll(() => document.querySelector('[data-terminal-peek]')).toBeNull();
  }
  expect(backend.connect).toHaveBeenCalledTimes(1);
});

it('uses the whole window for a preview anchored in a narrow split pane', async () => {
  await mount(1280, true);
  const workspace = document.querySelector<HTMLElement>('[data-session-workspace]')!;
  const main = workspace.parentElement!;
  Object.assign(main.style, { position: 'fixed', left: '320px', top: '48px', width: '550px', height: '760px' });
  await frame();
  await page.getByRole('button', { name: '查看Codex的终端' }).hover();
  await expect.element(page.getByRole('dialog', { name: '会话终端预览' })).toBeVisible();
  const check = () => {
    const panel = document.querySelector('[data-terminal-peek]')!.getBoundingClientRect();
    expect(panel.left).toBeGreaterThanOrEqual(12);
    expect(panel.right).toBeLessThanOrEqual(innerWidth - 12);
    expect(panel.top).toBeGreaterThanOrEqual(12);
    expect(panel.bottom).toBeLessThanOrEqual(innerHeight - 12);
    expect(panel.width).toBeGreaterThan(550);
  };
  check();
  await page.screenshot({ path: `/tmp/termdock-peek-pane-dpr${devicePixelRatio}.png` });
  Object.assign(main.style, { left: '400px', width: '400px', height: '400px' });
  await frame(); await frame();
  // A moved trigger may leave the pointer and close the hover preview.
  await page.getByRole('button', { name: '查看Codex的终端' }).hover();
  await expect.element(page.getByRole('dialog', { name: '会话终端预览' })).toBeVisible(); check();
  await commands.peekMove('body', .99, .005);
  await expect.poll(() => document.querySelector('[data-terminal-peek]')).toBeNull();
});

it.each([1280, 390])('keeps a preview entry above the composer after activity stops at width %i', async width => {
  const { completeReply } = await mount(width, true);
  const status = document.querySelector<HTMLElement>('[data-chat-reply-status]')!;
  expect(status.querySelector('.td-loading-spinner')).not.toBeNull();
  expect(status.closest('[data-chat-agent-header]')).toBeNull();
  expect(status.closest('[data-chat-message-actions]')).toBeNull();
  expect(status.closest('[data-chat-terminal-dock]')).not.toBeNull();
  expect(status.closest('.session-chat-scroll')).toBeNull();
  expect(document.querySelector('[data-chat-reply-feedback]')).toBeNull();
  await page.screenshot({ path: `/tmp/termdock-output-status-${width}-dpr${devicePixelRatio}.png` });
  backend.handlers!.onEvent({ type: 'terminal-output-activity', active: false });
  await expect.element(page.getByRole('status', { name: 'Codex等待回复' })).toBeVisible();
  const entry = document.querySelector('[data-chat-terminal-access]')!;
  expect(entry.isConnected).toBe(true);
  expect(status).toBe(entry);
  expect(status.textContent).toContain('等待回复…');
  expect(status.querySelector('.td-loading-spinner')).not.toBeNull();
  completeReply();
  await expect.poll(() => document.querySelector('[data-chat-reply-status]')).toBeNull();
  expect(entry.textContent).toBe('详情');
  expect(document.querySelector('[data-chat-reply-feedback]')).toBeNull();
  const terminalInput = document.querySelector('textarea[data-terminal-input-anchor]');
  await page.getByRole('button', { name: '查看终端详情', exact: true }).click();
  await expect.element(page.getByRole('dialog', { name: '会话终端预览' })).toBeVisible();
  expect(document.querySelector('textarea[data-terminal-input-anchor]')).toBe(terminalInput);
  backend.handlers!.onEvent({ type: 'terminal-output-activity', active: true });
  await expect.element(page.getByText('处理中…')).toBeVisible();
  expect(document.querySelector('[data-chat-terminal-access]')).toBe(entry);
  await page.getByRole('button', { name: '关闭终端预览' }).click();
  expect(backend.connect).toHaveBeenCalledTimes(1);
  await page.screenshot({ path: `/tmp/termdock-quiet-status-${width}-dpr${devicePixelRatio}.png` });
});

it('answers terminal cursor queries during hover before any user interaction', async () => {
  await mount();
  await page.getByRole('button', { name: '查看终端详情' }).hover();
  await expect.element(page.getByRole('dialog', { name: '会话终端预览' })).toBeVisible();
  backend.inputs.mockClear();
  backend.handlers!.onEvent({ type: 'data', data: '\x1b[6n' });
  await expect.poll(() => backend.inputs.mock.calls.some(([data]) => /\x1b\[\d+;\d+R/.test(String(data)))).toBe(true);
});

it('resizes the preview with a real drag and preserves its size in a smaller pane', async () => {
  await mount(1280, true);
  const trigger = page.getByRole('button', { name: '查看Codex的终端' });
  await trigger.hover(); await expect.element(page.getByRole('dialog', { name: '会话终端预览' })).toBeVisible();
  const panel = document.querySelector<HTMLElement>('[data-terminal-peek]')!;
  const before = panel.getBoundingClientRect();
  await commands.peekResize(-120, -60);
  await expect.poll(() => JSON.parse(localStorage.getItem('termdock:terminal-peek-size') || '{}').width).toBe(before.width - 120);
  const resized = panel.getBoundingClientRect();
  expect(resized.top).toBe(before.top); expect(resized.left).toBe(before.left);
  expect(resized.height).toBe(before.height - 60);
  const saved = JSON.parse(localStorage.getItem('termdock:terminal-peek-size')!);
  await commands.peekMove('body', .99, .005);
  await expect.poll(() => document.querySelector('[data-terminal-peek]')).toBeNull();
  await trigger.hover(); await expect.element(page.getByRole('dialog', { name: '会话终端预览' })).toBeVisible();
  expect(document.querySelector('[data-terminal-peek]')!.getBoundingClientRect().width).toBe(saved.width);
  const main = document.querySelector('[data-session-workspace]')!.parentElement!;
  Object.assign(main.style, { position: 'fixed', left: '300px', top: '48px', width: '400px', height: '600px' });
  await frame();
  await trigger.hover(); await expect.element(page.getByRole('dialog', { name: '会话终端预览' })).toBeVisible();
  expect(document.querySelector('[data-terminal-peek]')!.getBoundingClientRect().width).toBe(saved.width);
  expect(JSON.parse(localStorage.getItem('termdock:terminal-peek-size')!).width).toBe(saved.width);
});

it.each([1280, 390])('centers an inline image reference with the adjacent message text at width %i', async width => {
  await page.viewport(width, 900);
  const host = document.createElement('div'); host.className = 'p-8'; document.body.append(host); root = createRoot(host);
  const content = composeChatDraft('【图片1】 我请问这个UI设计是什么鬼呢', [{ path: '/tmp/example.png', name: '截图.png', type: 'image/png', reference: '图片1' }], []);
  root.render(<ChatUserMessage content={content} createdAt={1} status="已发送" />);
  await expect.element(page.getByText('图片1', { exact: true })).toBeVisible();
  const token = document.querySelector('[data-chat-inline-token]')!;
  const paragraph = token.closest('p')!;
  const text = Array.from(paragraph.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
  const range = document.createRange(); range.selectNodeContents(text!);
  const a = token.getBoundingClientRect(), b = range.getClientRects()[0];
  expect(Math.abs(a.top + a.height / 2 - b.top - b.height / 2)).toBeLessThanOrEqual(4);
  await page.screenshot({ path: `/tmp/termdock-inline-image-${width}-dpr${devicePixelRatio}.png` });
});

it('keeps processing and an explicit detail action from native working status while the terminal stays silent', async () => {
  await mount(1280, true);
  backend.handlers!.onEvent({ type: 'connected', mode: 'shell', terminalOutputActive: false, tuiProgress: { source: 'osc7501', state: 'indeterminate', progress: null, app: 'codex' } });
  await new Promise(resolve => setTimeout(resolve, 3200));
  await expect.element(page.getByRole('status', { name: 'Codex处理中' })).toBeVisible();
  expect(document.querySelector('[data-chat-reply-status]')?.closest('[data-chat-terminal-dock]')).not.toBeNull();
  await page.getByRole('button', { name: '查看终端详情', exact: true }).click();
  await expect.element(page.getByRole('dialog', { name: '会话终端预览' })).toBeVisible();
  await page.screenshot({ path: `/tmp/termdock-native-silent-working-dpr${devicePixelRatio}.png` });
  backend.handlers!.onEvent({ type: 'tui-progress', tuiProgress: { source: 'osc7501', state: 'remove', progress: null, app: 'codex' } });
  await expect.element(page.getByRole('status', { name: 'Codex等待回复' })).toBeVisible();
});

it('acknowledges native completion in chat, including a result that arrived in terminal mode', async () => {
  await mount(1280, true);
  const done = () => {
    backend.handlers!.onEvent({ type: 'tui-progress', tuiProgress: { source: 'osc7501', state: 'done', progress: null, app: 'codex', message: 'Native completed' } });
    backend.handlers!.onEvent({ type: 'agent-status', agentStatus: 'done', reviewed: false });
  };
  done();
  await expect.poll(() => useTerminalStore.getState().sessions.get(sessionId)?.agentNeedsReview).toBe(false);
  await expect.poll(() => useTerminalStore.getState().sessions.get(sessionId)?.tuiProgress?.reviewed).toBe(true);
  await page.getByRole('button', { name: '切换到终端' }).click();
  backend.inputs.mockClear();
  done();
  await expect.poll(() => useTerminalStore.getState().sessions.get(sessionId)?.agentNeedsReview).toBe(true);
  await page.getByRole('button', { name: '切换到对话' }).click();
  await expect.poll(() => useTerminalStore.getState().sessions.get(sessionId)?.agentNeedsReview).toBe(false);
  await expect.poll(() => useTerminalStore.getState().sessions.get(sessionId)?.tuiProgress?.reviewed).toBe(true);
  expect(backend.inputs).not.toHaveBeenCalled();
});

it('receives message attention through the terminal stream and clears only the exposed conversation reply', async () => {
  await mount(1280, true);
  await page.getByRole('button', { name: '切换到终端' }).click();
  backend.handlers!.onEvent({ type: 'session-chat-index', chatIndex: { conversationId: 'chat-stream', messageIds: ['a1'] } });
  await new Promise(resolve => setTimeout(resolve, 750));
  expect(useTerminalStore.getState().sessions.get(sessionId)?.chatAttention?.unreadIds).toEqual(['a1']);
  await page.getByRole('button', { name: '切换到对话' }).click();
  await expect.poll(() => useTerminalStore.getState().sessions.get(sessionId)?.chatAttention?.unreadIds).toEqual([]);
  expect(document.querySelector('[data-chat-highlight]')).not.toBeNull();
});

it.each([1280, 390, 320])('keeps the composer preview dock and reply actions stable as loading changes at width %i', async width => {
  await mount(width, true, false, 3);
  const replies = [...document.querySelectorAll<HTMLElement>('[data-chat-turn="assistant"] [data-chat-message]')];
  expect(replies).toHaveLength(3);
  const last = replies.at(-1)!;
  const footer = last.querySelector<HTMLElement>('[data-chat-message-actions]')!;
  const status = document.querySelector<HTMLElement>('[data-chat-reply-status]')!;
  expect(status.closest('[data-chat-terminal-dock]')).not.toBeNull();
  expect(status.closest('.session-chat-scroll')).toBeNull();
  expect(footer.contains(status)).toBe(false);
  expect(replies.slice(0, -1).every(reply => !reply.querySelector('[data-chat-reply-status]'))).toBe(true);
  const measure = () => ({
    footer: footer.getBoundingClientRect().toJSON(),
    tools: footer.querySelector('.chat-message-tools')!.getBoundingClientRect().toJSON(),
    time: footer.querySelector('time')!.getBoundingClientRect().toJSON(),
    contentHeight: document.querySelector('.session-chat-scroll')!.scrollHeight,
    composer: document.querySelector('.session-chat-composer')!.getBoundingClientRect().toJSON(),
  });
  const before = measure();
  const trigger = document.querySelector('[data-chat-terminal-access] button')!;
  const button = trigger.getBoundingClientRect();
  const form = document.querySelector('[data-chat-composer]')!.getBoundingClientRect();
  expect(button.bottom).toBeLessThanOrEqual(form.top);
  expect(Math.abs(button.left - form.left)).toBeLessThanOrEqual(1);
  const beside = document.elementFromPoint(Math.min(innerWidth - 16, button.right + 20), button.top + button.height / 2);
  expect(beside?.closest('.session-chat-composer')).not.toBeNull();
  expect(footer.querySelector('time')!.getBoundingClientRect().right).toBeLessThanOrEqual(innerWidth - 16);
  await page.screenshot({ path: `/tmp/termdock-inline-status-${width}-dpr${devicePixelRatio}.png` });
  for (const active of [false, true, false]) {
    backend.handlers!.onEvent({ type: 'terminal-output-activity', active });
    await expect.poll(() => document.querySelector('[data-chat-reply-status]')?.getAttribute('data-chat-reply-phase')).toBe(active ? 'output' : 'quiet');
    expect(document.querySelector('[data-chat-terminal-access] button')).toBe(trigger);
    expect(trigger.getBoundingClientRect().top).toBe(button.top);
    await frame();
    expect(measure()).toEqual(before);
  }
});

it('keeps unread Session navigation in chat with a keyboard and locates it above the composer', async () => {
  await mount(390, true, false, 1, true);
  const store = useTerminalStore.getState(); store.setActiveSessionId(sessionId);
  store.setTerminalSession('unread-background', { sessionId: 'backend-background', cols: 80, rows: 24 });
  store.setSessionChatMode('unread-background', true);
  store.setSessionChatIndex('unread-background', { conversationId: 'other-chat', messageIds: ['unread-result'], viewedMessageIds: [] });
  await expect.poll(() => document.querySelector('[data-attention-button]')).not.toBeNull();
  const editor = document.querySelector('[data-session-chat] [role="textbox"]') as HTMLElement;
  const switched = vi.fn(); window.addEventListener('switch-terminal-session', switched);
  try {
    editor.focus();
    document.documentElement.style.setProperty('--kb-height', '300px');
    document.documentElement.style.setProperty('--app-base-vh', '900px');
    await page.viewport(390, 500); window.dispatchEvent(new Event('resize'));
    // Prove the keyboard state is active: terminal mode retains its old hiding
    // policy, then the same shared mode signal restores the chat control.
    store.setSessionChatMode(sessionId, false);
    await expect.poll(() => document.querySelector('[data-attention-button]')).toBeNull();
    store.setSessionChatMode(sessionId, true);
    await expect.poll(() => document.querySelector('[data-attention-button]')).not.toBeNull();
    await frame();
    const floating = document.querySelector<HTMLElement>('[data-attention-button]')!.getBoundingClientRect();
    const scroll = document.querySelector('.session-chat-scroll')!.getBoundingClientRect();
    const dock = document.querySelector('[data-chat-terminal-dock]')!.getBoundingClientRect();
    expect(floating.top).toBeGreaterThanOrEqual(scroll.top);
    expect(floating.bottom).toBeLessThanOrEqual(scroll.bottom);
    expect(floating.bottom).toBeLessThanOrEqual(dock.top);
    await page.screenshot({ path: `/tmp/termdock-chat-attention-keyboard-dpr${devicePixelRatio}.png` });
    await page.elementLocator(document.querySelector('[data-attention-button]')!).click();
    expect((switched.mock.calls.at(-1)?.[0] as CustomEvent)?.detail).toBe('unread-background');
  } finally {
    window.removeEventListener('switch-terminal-session', switched);
    document.documentElement.style.removeProperty('--kb-height'); document.documentElement.style.removeProperty('--app-base-vh');
  }
});

it('keeps desktop hover previews open without a mobile auto-close countdown', async () => {
  await mount();
  await page.getByRole('button', { name: '查看终端详情' }).hover();
  await expect.element(page.getByRole('dialog', { name: '会话终端预览' })).toBeVisible();
  await commands.peekMove('[data-terminal-peek] header');
  expect(document.querySelector('[data-terminal-peek-countdown]')).toBeNull();
  await new Promise(resolve => setTimeout(resolve, 5200));
  await expect.element(page.getByRole('dialog', { name: '会话终端预览' })).toBeVisible();
  expect(backend.connect).toHaveBeenCalledOnce(); expect(backend.close).not.toHaveBeenCalled(); expect(backend.inputs).not.toHaveBeenCalled();
  await page.getByRole('button', { name: '关闭终端预览' }).click();
  await expect.poll(() => document.querySelector('[data-terminal-peek]')).toBeNull();
});
