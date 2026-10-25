import { createRoot, type Root } from 'react-dom/client';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import type { ChatDelivery } from '../../../server/shared/chatDelivery';
import type { ChatMessage } from './chatMessages';
import { Swiper, SwiperSlide } from 'swiper/react';
import 'swiper/css';
import '../../../index.css';
import { SessionModeSwitch } from './SessionModeSwitch';
import { SessionWorkspace } from './SessionWorkspace';
import { TerminalView } from '../views/TerminalView';
import { useTerminalStore } from '../../stores/useTerminalStore';
import { getDefaultTerminalSettings } from '../../terminal/settings';
import type { TerminalHandlers } from '../../terminal/types';
import { clearChatSnapshots } from './chatSnapshot';
import { SESSION_NO_SWIPE, SESSION_SWIPER_FOCUSABLE_ELEMENTS } from './sessionSwipe';
import { TERMINAL_MODE_HINT_KEY } from './sessionModeOnboarding';

declare module 'vitest/browser' {
  interface BrowserCommands { pendingChatDelivery(stage: string, error: string): Promise<ChatDelivery | null>; setChatReducedMotion(reduce: boolean): Promise<void> }
}
interface InFlight { sent: boolean; stage: string; error: string; observed?: string; content?: string; history?: ChatMessage[]; replies?: ChatMessage[]; replyPending?: boolean }

const backend = vi.hoisted(() => ({ resize: vi.fn(), connect: vi.fn(), input: vi.fn(), close: vi.fn(), handlers: undefined as TerminalHandlers | undefined }));
vi.mock('../../terminal/factory', () => ({ createTermdockAPI: () => ({
  connect: (_id: string, handlers: TerminalHandlers) => {
    backend.connect(); backend.handlers = handlers;
    queueMicrotask(() => { handlers.onEvent({ type: 'connected', mode: 'shell', cwd: '/tmp' }); handlers.onEvent({ type: 'data', data: '\r\nSession mode onboarding fixture\r\n$ ' }); });
    return { close: backend.close };
  },
  sendInput: async (_id: string, text: string) => { backend.input(text); },
  resize: async (size: { seq: number; cols: number; rows: number }) => { backend.resize(size); queueMicrotask(() => backend.handlers?.onEvent({ type: 'resize-ack', ok: true, ...size })); },
}) }));
let root: Root | undefined;
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
afterEach(() => {
  root?.unmount(); root = undefined;
  useTerminalStore.getState().clearAllTerminalSessions(); clearChatSnapshots();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); document.body.replaceChildren(); localStorage.clear(); sessionStorage.clear();
  document.documentElement.style.removeProperty('--safe-left-inset'); document.documentElement.style.removeProperty('--safe-right-inset');
});
async function mount(width: number, initial: 'terminal' | 'chat', compact = false, recovery?: { fail: boolean; recovered: boolean; calls: number; uncertain?: boolean; cancelled?: boolean }, flight?: InFlight) {
  await page.viewport(width, 844);
  const id = `mode-onboarding-${initial}-${width}-${Date.now()}`;
  let mode = initial;
  localStorage.setItem(`termdock:session-view:${location.origin}:${id}`, mode);
  vi.stubGlobal('fetch', vi.fn(async (url, init?: RequestInit) => {
    if (String(url).includes('/view-mode')) {
      if (init?.body) mode = JSON.parse(String(init.body)).mode;
      return Response.json({ mode, chatEligibility: { allowed: true, program: 'codex' } });
    }
    if (flight && String(url).includes('/chat')) {
      if (init?.method === 'POST' && String(url).endsWith('/chat')) {
        flight.sent = true; flight.content = JSON.parse(String(init.body)).content;
        return Response.json({ id: 'in-flight', status: 'pending' });
      }
      const stage = flight.stage, delivery = flight.sent && stage !== 'delivered' ? await commands.pendingChatDelivery(stage, flight.error) : null;
      flight.observed = stage;
      return Response.json({ agentAvailable: true, agent: { displayName: 'Codex', slug: 'codex' }, replyPending: flight.replyPending,
        messages: [...(flight.history ?? []), ...(flight.sent ? [{ id: 'in-flight', role: 'user', content: flight.content, createdAt: 3, status: stage === 'delivered' ? 'delivered' : 'pending', ...(delivery ? { delivery } : {}) }, ...(flight.replies ?? [])] : [])] });
    }
    if (String(url).endsWith('/chat/recover') && recovery) {
      recovery.calls++;
      if (recovery.fail) return Response.json({ error: 'not yet confirmed' }, { status: 409 });
      recovery.recovered = true; return Response.json({ ok: true });
    }
    if (String(url).endsWith('/delivery') && recovery) {
      recovery.calls++; recovery.recovered = true; recovery.cancelled = JSON.parse(String(init?.body)).action === 'cancel'; return Response.json({ ok: true });
    }
    if (String(url).includes('/chat')) return Response.json({ agentAvailable: true, agent: { displayName: 'Codex', slug: 'codex' }, messages: recovery ? [{ id: 'delivery-fixture', role: 'user', content: '请检查构建结果', createdAt: 1, status: recovery.recovered ? recovery.cancelled ? 'cancelled' : 'delivered' : 'pending', ...(!recovery.recovered ? { delivery: recovery.uncertain ? { state: 'outcome-unknown', attemptCount: 1 } : { state: 'binding-required', canReconnect: true } } : {}) }] : [] });
    return Response.json({});
  }));
  useTerminalStore.getState().setTerminalSession(id, { sessionId: `backend-${id}`, cols: 80, rows: 24, cwd: '/tmp' });
  const host = document.createElement('div'); host.className = 'flex h-screen flex-col'; document.body.append(host);
  function Workspace() {
    const [stream, setStream] = useState(false), [viewport, setViewport] = useState(false), [content, setContent] = useState(false);
    return <SessionWorkspace sessionId={id} name="网站改版" active terminalReady={stream && viewport && content}>{(visible, interactive) => <TerminalView
      sessionId={id} mode="shell" isActive isLayoutVisible={visible} focusSuspended={!interactive} suppressKeyboard={!visible}
      terminalSettings={{ ...getDefaultTerminalSettings(), rendererMode: 'canvas', enableImages: false, fontLigatures: false }}
      onStreamReadyChange={(_id, ready) => setStream(ready)} onViewportReadyChange={(_id, ready) => setViewport(ready)} onContentReadyChange={(_id, ready) => setContent(ready)} />}</SessionWorkspace>;
  }
  root = createRoot(host);
  root.render(<><header className="flex h-12 shrink-0 items-center justify-end px-3"><SessionModeSwitch sessionId={id} share={false} compact={compact} /></header>
    <Swiper className="session-chat-swiper min-h-0 w-full flex-1" touchStartPreventDefault={false} simulateTouch={false} noSwipingSelector={SESSION_NO_SWIPE} focusableElements={SESSION_SWIPER_FOCUSABLE_ELEMENTS}>
      <SwiperSlide><Workspace /></SwiperSlide>
    </Swiper></>);
  return { id };
}

it.each([390, 1280])('never flashes an uncertainty card during real projected write stages at width %i', async width => {
  const flight: InFlight = { sent: false, stage: 'not_started', error: 'DELIVERY_IN_PROGRESS' };
  await mount(width, 'chat', false, undefined, flight);
  const input = page.getByRole('textbox', { name: '给Codex的消息' });
  await input.fill('test');
  const cards: string[] = [];
  const observer = new MutationObserver(() => { const notice = document.querySelector('[data-chat-delivery-notice]'); if (notice) cards.push(notice.textContent || ''); });
  observer.observe(document.querySelector('[data-session-chat]')!, { childList: true, subtree: true });
  try {
    await page.getByRole('button', { name: '发送消息' }).click();
    await expect.element(page.getByText('test', { exact: true })).toBeVisible();
    await expect.element(page.getByRole('status', { name: 'Codex发送中' })).toBeVisible();
    const placeholder = document.querySelector('[data-chat-reply-feedback]')!;
    expect(placeholder.closest('.session-chat-scroll')).not.toBeNull();
    const preceding = placeholder.previousElementSibling!;
    const question = preceding.matches('[data-chat-turn="user"]') ? preceding : preceding.querySelector('[data-chat-turn="user"]');
    expect(question?.textContent).toContain('test');
    expect(placeholder.querySelector('[data-chat-agent-header]')?.textContent).toContain('Codex');
    expect(placeholder.querySelector('[style*=mask]')).not.toBeNull();
    expect(placeholder.querySelector('.td-loading-spinner')).toBeNull();
    expect(placeholder.querySelector('[data-chat-agent-awaiting]')).not.toBeNull();
    expect(getComputedStyle(placeholder.querySelector('.chat-agent-waiting')!.firstElementChild!).animationName).toBe('chat-agent-wave');
    expect(page.getByRole('status', { name: 'Codex发送中' }).element().closest('[data-chat-terminal-dock]')).not.toBeNull();
    expect(document.querySelector('[data-chat-terminal-dock]')?.contains(placeholder)).toBe(false);
    await page.screenshot({ path: `/tmp/termdock-reply-placeholder-${width}-dpr${devicePixelRatio}.png` });
    for (const stage of ['unknown', 'not_started', 'paste_attempted', 'paste_written', 'submit_attempted', 'submit_written', 'delivered']) {
      flight.stage = stage; window.dispatchEvent(new Event('online'));
      await expect.poll(() => flight.observed).toBe(stage); await frame();
      expect(document.querySelector('[data-chat-delivery-notice]')).toBeNull();
    }
    expect(cards).toEqual([]);
  } finally { observer.disconnect(); }
  flight.stage = 'paste_written'; flight.error = 'TERMINAL_WRITE_FAILED: connection interrupted';
  window.dispatchEvent(new Event('online'));
  await expect.element(page.getByRole('button', { name: '确认未发送，重新投递' })).toBeVisible();
  flight.error = 'DELIVERY_OUTCOME_UNCONFIRMED'; window.dispatchEvent(new Event('online')); await frame();
  await expect.element(page.getByRole('button', { name: '停止这条投递' })).toBeVisible();
});

it.each([390, 1280])('starts the next reply after the new question and replaces loading with real content at width %i', async width => {
  const flight: InFlight = { sent: false, stage: 'not_started', error: 'DELIVERY_IN_PROGRESS', history: [
    { id: 'old-user', role: 'user', content: '上一轮问题', createdAt: 1, status: 'delivered' },
    { id: 'old-result', role: 'assistant', content: '上一轮结果', createdAt: 2, status: 'stored', replyTo: 'old-user', responseKind: 'result' },
  ] };
  await mount(width, 'chat', false, undefined, flight);
  await expect.element(page.getByText('上一轮结果', { exact: true })).toBeVisible();
  const previous = document.querySelector('[data-chat-message="old-result"]');
  await page.getByRole('textbox', { name: '给Codex的消息' }).fill('下一轮问题');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect.element(page.getByRole('status', { name: 'Codex发送中' })).toBeVisible();
  const feedback = document.querySelector('[data-chat-reply-feedback]')!;
  const preceding = feedback.previousElementSibling!;
  const question = preceding.matches('[data-chat-turn="user"]') ? preceding : preceding.querySelector('[data-chat-turn="user"]');
  expect(question?.textContent).toContain('下一轮问题');
  expect(document.querySelectorAll('[data-chat-agent-header]')).toHaveLength(2);
  expect(document.querySelector('[data-chat-terminal-access]')?.textContent).toContain('详情');
  await page.screenshot({ path: `/tmp/termdock-followup-placeholder-${width}-dpr${devicePixelRatio}.png` });
  flight.stage = 'delivered'; flight.replies = [{ id: 'new-progress', role: 'assistant', content: '正在核对新问题', createdAt: 4, status: 'stored', replyTo: 'in-flight', responseKind: 'progress' }];
  window.dispatchEvent(new Event('online'));
  await expect.element(page.getByText('正在核对新问题', { exact: true })).toBeVisible();
  await expect.element(page.getByRole('status', { name: 'Codex等待回复' })).toBeVisible();
  expect(document.querySelectorAll('[data-chat-agent-header]')).toHaveLength(2);
  expect(document.querySelector('[data-chat-agent-awaiting]')).toBeNull();
  expect(document.querySelector('[data-chat-reply-feedback]')).toBeNull();
  expect(page.getByRole('status', { name: 'Codex等待回复' }).element().closest('[data-chat-terminal-dock]')).not.toBeNull();
  await page.screenshot({ path: `/tmp/termdock-first-reply-static-${width}-dpr${devicePixelRatio}.png` });
  expect(document.querySelector('[data-chat-message="old-result"]')).toBe(previous);
  const terminalInput = document.querySelector('textarea[data-terminal-input-anchor]');
  await page.getByRole('button', { name: '查看终端详情', exact: true }).click();
  await expect.element(page.getByRole('dialog', { name: '会话终端预览' })).toBeVisible();
  expect(document.querySelector('textarea[data-terminal-input-anchor]')).toBe(terminalInput);
  expect(backend.connect).toHaveBeenCalledOnce();
  await page.getByRole('button', { name: '关闭终端预览' }).click();
  flight.replies.push({ id: 'new-result', role: 'assistant', content: '新问题的结果', createdAt: 5, status: 'stored', replyTo: 'in-flight', responseKind: 'result' });
  flight.replyPending = false; window.dispatchEvent(new Event('online'));
  await expect.element(page.getByText('新问题的结果', { exact: true })).toBeVisible();
  expect(document.querySelector('[data-chat-reply-feedback]')).toBeNull();
  expect(document.querySelectorAll('[data-chat-agent-header]')).toHaveLength(2);
  expect(document.querySelector('[data-chat-terminal-access]')?.getAttribute('data-chat-reply-phase')).toBe('idle');
  expect(document.querySelector('[data-chat-terminal-access] .td-loading-spinner')).toBeNull();
  expect(document.querySelector('[data-chat-terminal-access]')?.textContent).toBe('详情');
});

it.each([390, 1280])('shows failed probe guidance and terminal recovery without losing the draft at width %i', async width => {
  const flight: InFlight = { sent: true, stage: 'paste_attempted', error: 'TERMINAL_WRITE_FAILED: TERMINAL_INPUT_ECHO_UNCONFIRMED', content: '检查投递' };
  await mount(width, 'chat', false, undefined, flight);
  await page.getByRole('textbox', { name: '给Codex的消息' }).fill('下一条草稿');
  await expect.element(page.getByText('终端输入检测未通过，已暂停投递。请查看终端，检查是否有残留输入。')).toBeVisible();
  await expect.element(page.getByRole('button', { name: '已检查并清理，重新投递' })).toBeVisible();
  await expect.element(page.getByText('投递待确认', { exact: true })).toBeVisible();
  expect(document.querySelector('[data-chat-composer]')!.getBoundingClientRect().bottom).toBeLessThanOrEqual(844);
  await page.screenshot({ path: `/tmp/termdock-input-probe-failed-${width}-dpr${devicePixelRatio}.png` });
  await page.getByRole('button', { name: '查看终端', exact: true }).click();
  await expect.element(page.getByRole('button', { name: '切换到对话', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '切换到对话', exact: true }).click();
  expect((await page.getByRole('textbox', { name: '给Codex的消息' }).element()).textContent).toBe('下一条草稿');
});

it('keeps waiting readable without the avatar wave when reduced motion is requested', async () => {
  const flight: InFlight = { sent: true, stage: 'delivered', error: 'DELIVERY_IN_PROGRESS', content: '等待首条回复' };
  await mount(390, 'chat', false, undefined, flight);
  await expect.element(page.getByRole('status', { name: 'Codex等待回复' })).toBeVisible();
  const avatar = document.querySelector('.chat-agent-waiting')!.firstElementChild!;
  expect(getComputedStyle(avatar).animationName).toBe('chat-agent-wave');
  try {
    await commands.setChatReducedMotion(true);
    await expect.poll(() => getComputedStyle(avatar).animationName).toBe('none');
    expect(getComputedStyle(avatar).opacity).toBe('1');
    expect(document.querySelector('[data-chat-agent-awaiting]')?.textContent).toContain('Codex');
    expect(document.querySelector('[data-chat-terminal-access]')?.textContent).toContain('详情');
  } finally { await commands.setChatReducedMotion(false); }
});

it('handles an uncertain write in the mobile workspace without hidden commands or losing the composer', async () => {
  const recovery = { fail: false, recovered: false, calls: 0, uncertain: true };
  await mount(390, 'chat', false, recovery); await page.viewport(390, 430);
  await page.getByRole('textbox', { name: '给Codex的消息' }).fill('保留这份草稿');
  const stop = page.getByRole('button', { name: '停止这条投递' });
  await expect.element(stop).toBeVisible();
  const rect = (await stop.element()).getBoundingClientRect();
  expect(rect.top).toBeGreaterThanOrEqual(0); expect(rect.bottom).toBeLessThanOrEqual(430);
  expect(document.querySelector('[data-chat-composer]')!.getBoundingClientRect().bottom).toBeLessThanOrEqual(430);
  expect(recovery.calls).toBe(0);
  await stop.click();
  await expect.element(page.getByText('已停止投递', { exact: true })).toBeVisible();
  expect(recovery.calls).toBe(1);
  expect((await page.getByRole('textbox', { name: '给Codex的消息' }).element()).textContent).toBe('保留这份草稿');
});

it.each([390, 1280])('recovers queued chat inside the workspace without commands or losing the next draft at width %i', async width => {
  const recovery = { fail: true, recovered: false, calls: 0 };
  await mount(width, 'chat', false, recovery);
  await expect.element(page.getByText('等待恢复', { exact: true })).toBeVisible();
  const input = page.getByRole('textbox', { name: '给Codex的消息' });
  await input.fill('下一条草稿\n保留第二行');
  await page.getByRole('button', { name: '重新连接', exact: true }).click();
  await expect.element(page.getByText('暂时无法恢复，消息已保留。可查看终端中的会话。')).toBeVisible();
  expect(document.body.textContent).not.toMatch(/td collab|复制命令|运行以下命令/);
  expect(document.querySelector('[data-chat-message="delivery-fixture"]')).not.toBeNull();
  expect((await input.element()).textContent).toContain('下一条草稿');
  recovery.fail = false;
  await page.getByRole('button', { name: '重新连接', exact: true }).click();
  await expect.element(page.getByText('已发送', { exact: true })).toBeVisible();
  expect(recovery.calls).toBe(2);
  expect(document.querySelector('[data-chat-delivery-notice]')).toBeNull();
  expect(document.querySelectorAll('[data-chat-message="delivery-fixture"]')).toHaveLength(1);
  expect((await input.element()).textContent).toContain('保留第二行');
  await page.screenshot({ path: `/tmp/termdock-in-page-recovery-${width}-dpr${devicePixelRatio}.png` });
});

it.each([[320, false], [390, false], [1280, false], [320, true]] as const)('keeps unread chat discoverable in the mode switch at width %i (compact %s)', async (width, compact) => {
  const { id } = await mount(width, 'terminal', compact);
  useTerminalStore.getState().setSessionChatIndex(id, { conversationId: id, messageIds: ['reply-one', 'reply-two'], viewedMessageIds: [] });
  const entry = page.getByRole('button', { name: '切换到对话，2 条未读消息' });
  await expect.element(entry).toBeVisible();
  const badge = document.querySelector('[data-chat-unread-count="2"]')!;
  const rect = badge.getBoundingClientRect();
  expect(rect.width).toBeGreaterThanOrEqual(16); expect(rect.left).toBeGreaterThanOrEqual(0); expect(rect.right).toBeLessThanOrEqual(width);
  expect(getComputedStyle(badge).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  await page.screenshot({ path: `/tmp/termdock-chat-unread-${width}-${compact}-dpr${devicePixelRatio}.png` });
  await entry.click();
  await expect.element(page.getByRole('textbox', { name: '给Codex的消息' })).toBeVisible();
  expect(useTerminalStore.getState().sessions.get(id)?.chatAttention?.unreadIds).toEqual(['reply-one', 'reply-two']);
  await page.getByRole('button', { name: '切换到终端', exact: true }).first().click();
  await expect.element(page.getByRole('button', { name: '切换到对话，2 条未读消息' })).toBeVisible();
  useTerminalStore.getState().setSessionChatIndex(id, { conversationId: id, messageIds: ['reply-one', 'reply-two'], viewedMessageIds: ['reply-one', 'reply-two'] });
  await expect.element(page.getByRole('button', { name: '切换到对话', exact: true })).toBeVisible();
  expect(document.querySelector('[data-chat-unread-count]')).toBeNull();
});

it.each([320, 390, 1280])('keeps the empty-state switch understated and preserves drafts through a real retained terminal at width %i', async width => {
  await mount(width, 'chat');
  const switchButton = page.getByRole('button', { name: '切换到终端', exact: true }).filter({ hasText: '切换到终端' });
  await expect.element(switchButton).toBeVisible();
  const editor = document.querySelector<HTMLElement>('[data-session-chat] [role="textbox"]')!;
  editor.focus(); await userEvent.keyboard('切换后保留这份草稿');
  const node = document.querySelector<HTMLButtonElement>('[data-session-mode-welcome] button')!;
  const rect = node.getBoundingClientRect(), color = getComputedStyle(node);
  expect(rect.height).toBeGreaterThanOrEqual(44); expect(rect.left).toBeGreaterThanOrEqual(0); expect(rect.right).toBeLessThanOrEqual(width);
  expect(color.backgroundColor).toBe('rgba(0, 0, 0, 0)');
  expect(localStorage.getItem(TERMINAL_MODE_HINT_KEY)).toBeNull();
  await page.screenshot({ path: `/tmp/termdock-session-mode-empty-${width}-dpr${devicePixelRatio}.png` });
  await page.elementLocator(node).click();
  await expect.element(page.getByRole('button', { name: '切换到对话' })).toBeVisible();
  await expect.poll(() => document.querySelector('.xterm-rows')?.textContent).toContain('Session mode onboarding fixture');
  await page.getByRole('button', { name: '切换到对话' }).click();
  await expect.element(page.elementLocator(editor)).toBeVisible();
  expect(editor.textContent).toContain('切换后保留这份草稿'); expect(backend.connect).toHaveBeenCalledOnce();
  expect(backend.input).not.toHaveBeenCalled();
});

it.each([320, 390, 1280])('anchors the bubble outside Swiper without changing terminal geometry or focus at width %i', async width => {
  await mount(width, 'terminal');
  await expect.element(page.getByRole('complementary', { name: '会话模式说明' })).toBeVisible();
  await frame();
  const hint = document.querySelector<HTMLElement>('[data-terminal-mode-hint]')!, terminal = document.querySelector<HTMLElement>('.terminal-viewport-container')!;
  const layer = document.querySelector<HTMLElement>('[data-terminal-mode-hint-layer]')!, anchor = document.querySelector<HTMLButtonElement>('[data-session-mode-switch]')!;
  const originalBox = terminal.getBoundingClientRect(), hintBox = hint.getBoundingClientRect();
  expect(getComputedStyle(layer).position).toBe('fixed');
  expect(getComputedStyle(layer).pointerEvents).toBe('none');
  expect(layer.parentElement).toBe(document.body);
  expect(hintBox.top).toBeGreaterThanOrEqual(anchor.getBoundingClientRect().bottom);
  expect(hintBox.bottom).toBeGreaterThan(originalBox.top);
  expect(originalBox.top).toBe(document.querySelector('[data-session-workspace]')!.getBoundingClientRect().top);
  expect(hintBox.left).toBeGreaterThanOrEqual(12); expect(hintBox.right).toBeLessThanOrEqual(width - 12);
  expect(hintBox.bottom).toBeLessThanOrEqual(844 - 12);
  expect(getComputedStyle(layer).zIndex).toBe(getComputedStyle(document.documentElement).getPropertyValue('--z-chrome-hint').trim());
  expect(backend.resize.mock.calls.length).toBeGreaterThan(0);
  const originalGrid = backend.resize.mock.calls.at(-1)![0];
  await page.screenshot({ path: `/tmp/termdock-session-mode-terminal-${width}-dpr${devicePixelRatio}.png` });
  if (width === 390) {
    document.documentElement.style.setProperty('--safe-left-inset', '32px');
    document.documentElement.style.setProperty('--safe-right-inset', '38px');
    await frame();
    expect(hint.getBoundingClientRect().left).toBeGreaterThanOrEqual(32);
    expect(hint.getBoundingClientRect().right).toBeLessThanOrEqual(width - 38);
    document.documentElement.style.removeProperty('--safe-left-inset');
    document.documentElement.style.removeProperty('--safe-right-inset');
    await frame();
  }
  const input = (document.querySelector<HTMLTextAreaElement>('textarea[data-terminal-input-anchor]') ?? document.querySelector<HTMLTextAreaElement>('textarea.xterm-helper-textarea'))!;
  input.focus(); const blur = vi.fn(); input.addEventListener('blur', blur);
  // Use a real browser key within the real Swiper/terminal ancestry.
  if (width === 390) await page.getByRole('button', { name: '关闭会话模式说明' }).click();
  else await userEvent.keyboard('x');
  await expect.element(page.getByRole('complementary', { name: '会话模式说明' })).not.toBeInTheDocument();
  await frame();
  const afterBox = terminal.getBoundingClientRect();
  expect(afterBox.top).toBe(originalBox.top); expect(afterBox.height).toBe(originalBox.height);
  const afterGrid = backend.resize.mock.calls.at(-1)![0];
  expect(afterGrid.cols).toBe(originalGrid.cols); expect(afterGrid.rows).toBe(originalGrid.rows);
  expect(document.activeElement).toBe(input); expect(blur).not.toHaveBeenCalled();
  expect((document.querySelector('textarea[data-terminal-input-anchor]') ?? document.querySelector('textarea.xterm-helper-textarea'))).toBe(input);
  await page.getByRole('button', { name: '切换到对话' }).click();
  await expect.element(page.getByRole('button', { name: '切换到终端' }).filter({ hasText: '终端' }).first()).toBeVisible();
  await page.getByRole('button', { name: '切换到终端' }).filter({ hasText: '终端' }).first().click();
  await frame(); expect(document.querySelector('[data-terminal-mode-hint]')).toBeNull();
  expect(backend.connect).toHaveBeenCalledOnce();
});
