import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import '../../../index.css';
import { SessionModeSwitch } from './SessionModeSwitch';
import { SessionViewActions } from './SessionViewActions';
import { resetCsrfTokenCache } from '../../terminal/api';
import { SessionChatView } from './SessionChatView';
import { beginSessionChatStartup, finishSessionChatStartup } from './sessionChatStartup';
import { useTerminalStore } from '../../stores/useTerminalStore';
import { AgentSessionDot } from '../AgentIndicators';
import { SessionWorkspace } from './SessionWorkspace';

let root: Root | undefined;
const launches: string[] = [];
afterEach(() => { root?.unmount(); launches.splice(0).forEach(finishSessionChatStartup); useTerminalStore.getState().clearAllTerminalSessions(); document.body.replaceChildren(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it.each([390, 1280])('keeps explicit working consistent with the sidebar while an earlier result is unreviewed at width %i', async width => {
  await page.viewport(width, 844);
  const id = `working-review-${width}-${Date.now()}`;
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ agentAvailable: true, agent: { displayName: 'CustomAgent' },
    messages: [{ id: 'request', role: 'user', content: '继续检查', createdAt: 1, status: 'delivered' }] })));
  function Dot() {
    const session = useTerminalStore(state => state.sessions.get(id));
    return <span data-test-activity-dot className="relative block h-6 w-6"><AgentSessionDot status={session?.agentStatus ?? null}
      needsReview={session?.agentNeedsReview} chatAttention={session?.chatAttention} /></span>;
  }
  const host = document.createElement('div'); host.className = 'h-screen flex flex-col'; document.body.append(host); root = createRoot(host);
  root.render(<><Dot /><main className="min-h-0 flex-1"><SessionChatView sessionId={id} active={false} visible onTerminal={() => {}} /></main></>);
  await expect.element(page.getByText('继续检查')).toBeVisible();
  const store = useTerminalStore.getState();
  store.setTerminalSession(id, { sessionId: `backend-${id}`, cols: 80, rows: 24 });
  store.setSessionAgentStatus(id, { agentStatus: 'working', reviewed: false });
  await expect.poll(() => document.querySelector('[data-test-activity-dot] .bg-\\[var\\(--success\\)\\]')).not.toBeNull();
  await expect.element(page.getByRole('status', { name: 'CustomAgent处理中' })).toBeVisible();
  expect(document.querySelector('[data-chat-terminal-access] .td-loading-spinner')).not.toBeNull();
  expect(useTerminalStore.getState().sessions.get(id)?.agentNeedsReview).toBe(true);
  const entry = document.querySelector('[data-chat-terminal-access]')!, box = entry.getBoundingClientRect();
  expect(box.left).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(width);
  store.setSessionAgentStatus(id, { agentStatus: 'waiting', reviewed: false });
  await expect.element(page.getByRole('status', { name: 'CustomAgent等你处理' })).toBeVisible();
  expect(entry.querySelector('.td-loading-spinner')).toBeNull();
  store.setSessionAgentStatus(id, { agentStatus: 'done', reviewed: false });
  await expect.poll(() => entry.textContent).toBe('详情');
  store.setSessionAgentStatus(id, { agentStatus: 'working', reviewed: false });
  await expect.element(page.getByRole('status', { name: 'CustomAgent处理中' })).toBeVisible();
  expect(document.querySelector('[data-chat-terminal-access]')).toBe(entry);
});
it.each([390, 1280])('switches the complete chat activity policy with conversation presence and Terminal mode at width %i', async width => {
  await page.viewport(width, 844);
  // Concurrent DPR pages cannot both own the browser window focus.
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  const id = `chat-policy-${width}-${Date.now()}`, messages: object[] = [], checks: string[] = [];
  let mode = 'chat';
  vi.stubGlobal('fetch', vi.fn(async (url, init?: RequestInit) => {
    if (String(url).includes('/view-mode')) {
      if (init?.body) mode = JSON.parse(String(init.body)).mode;
      return Response.json({ mode, chatEligibility: { allowed: true, program: 'codex' } });
    }
    if (String(url).endsWith('/input-check')) { checks.push(String(url)); return Response.json({ status: 'ready' }); }
    if (init?.method === 'POST' && String(url).endsWith('/chat')) {
      messages.push({ id: 'request', role: 'user', content: '开始工作', createdAt: 1, status: 'delivered' });
      return Response.json({ id: 'request', status: 'delivered' });
    }
    return Response.json({ agentAvailable: true, agent: { slug: 'codex', displayName: 'Codex' }, messages });
  }));
  const host = document.createElement('div'); host.className = 'h-screen flex flex-col'; document.body.append(host); root = createRoot(host);
  function Dot() {
    const session = useTerminalStore(state => state.sessions.get(id));
    return <span data-test-activity-dot className="relative block h-6 w-6"><AgentSessionDot status={session?.agentStatus ?? null}
      progress={session?.tuiProgress} outputActive={session?.terminalOutputActive} chatAttention={session?.chatAttention} /></span>;
  }
  root.render(<><header className="flex h-12 shrink-0"><SessionModeSwitch sessionId={id} share={false} /><Dot /></header>
    <main className="min-h-0 flex-1"><SessionWorkspace sessionId={id} name="Codex" active>{() => <div>Terminal</div>}</SessionWorkspace></main></>);
  await expect.element(page.getByText('想一起完成什么？')).toBeVisible();
  const store = useTerminalStore.getState();
  store.setTerminalSession(id, { sessionId: 'policy-backend', cols: 80, rows: 24 });
  const dot = () => document.querySelector('[data-test-activity-dot]')!;
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  expect(checks).toHaveLength(0);
  store.setTerminalOutputActivity(id, true);
  store.setSessionTuiProgress(id, { source: 'osc7501', state: 'indeterminate', progress: null });
  await expect.poll(() => dot().childElementCount).toBe(0);
  await page.getByRole('textbox', { name: '给Codex的消息' }).fill('开始工作');
  expect(document.querySelector('[data-chat-terminal-access]')?.textContent).toBe('详情');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.element(page.getByText('已发送', { exact: true })).toBeVisible();
  await expect.poll(() => dot().querySelector('[data-terminal-output-activity]')).not.toBeNull();
  store.setTerminalOutputActivity(id, false);
  store.setSessionTuiProgress(id, { source: 'osc7501', state: 'remove', progress: null });
  await expect.poll(() => checks.length).toBe(1);
  store.setTerminalOutputActivity(id, true);
  await expect.poll(() => dot().querySelector('[data-terminal-output-activity]')).not.toBeNull();
  await page.getByRole('button', { name: '切换到终端', exact: true }).click();
  await expect.poll(() => useTerminalStore.getState().sessions.get(id)?.chatAttention?.mode).toBe(false);
  await expect.poll(() => dot().childElementCount).toBe(0);
  expect(checks).toHaveLength(1);
  store.setSessionAgentStatus(id, { agentStatus: 'working' });
  await expect.poll(() => dot().querySelector('.animate-pulse')).not.toBeNull();
  expect(dot().querySelector('[data-terminal-output-activity]')).toBeNull();
});
it.each([390, 1280])('recovers an earlier blocked delivery from the visible chat and removes its notice at width %i', async width => {
  await page.viewport(width, 844);
  const id = `chat-recovery-${width}-${Date.now()}`;
  const message = { id: 'queued-chat', role: 'user', content: '保留并发送这条消息', createdAt: 1, status: 'pending',
    delivery: { state: 'retrying', inputCheckFailed: true, blockedBy: { messageId: 'earlier-peer-reply', attemptCount: 2 } } as object | undefined };
  const attempts: object[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init?: RequestInit) => {
    if (String(url).endsWith('/queued-chat/delivery')) {
      attempts.push(JSON.parse(String(init?.body))); message.status = 'delivered'; message.delivery = undefined;
      return Response.json({ ok: true });
    }
    return Response.json({ agentAvailable: true, agent: { slug: 'codex', displayName: 'Codex' }, messages: [message] });
  }));
  const host = document.createElement('div'); host.className = 'h-screen'; document.body.append(host); root = createRoot(host);
  root.render(<SessionChatView sessionId={id} onTerminal={() => {}} />);
  await expect.element(page.getByText('前一条投递未确认，后续消息已暂停。请检查终端后重新投递。')).toBeVisible();
  const retry = page.getByRole('button', { name: '已检查并清理，重新投递', exact: true });
  await expect.element(retry).toBeVisible();
  await retry.click();
  await expect.poll(() => attempts).toEqual([{ action: 'retry', attempt: 2, blockingMessageId: 'earlier-peer-reply' }]);
  await expect.poll(() => document.querySelector('[data-chat-delivery-notice]')).toBeNull();
  await expect.element(page.getByText('保留并发送这条消息')).toBeVisible();
  await expect.element(page.getByText('已发送', { exact: true })).toBeVisible();
});
it.each([390, 1280])('keeps empty chat details during activity and drafting until the first message at width %i', async width => {
  await page.viewport(width, 844);
  const id = `empty-chat-details-${width}-${Date.now()}`, messages: object[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init?: RequestInit) => {
    if (init?.method === 'POST' && String(url).endsWith('/chat')) {
      messages.push({ id: 'first', role: 'user', content: '第一条消息', createdAt: 1, status: 'delivered' });
      return Response.json({ id: 'first', status: 'delivered' });
    }
    return Response.json({ agentAvailable: true, agent: { slug: 'customagent-status', displayName: 'CustomAgent' }, messages });
  }));
  const host = document.createElement('div'); host.className = 'h-screen'; document.body.append(host); root = createRoot(host);
  root.render(<SessionChatView sessionId={id} onTerminal={() => {}} />);
  await expect.element(page.getByText('想一起完成什么？')).toBeVisible();
  const store = useTerminalStore.getState();
  store.setTerminalSession(id, { sessionId: 'empty-chat-backend', cols: 80, rows: 24 });
  store.setTerminalOutputActivity(id, true);
  store.setSessionAgentStatus(id, { agentStatus: 'working' });
  await expect.poll(() => document.querySelector('[data-chat-terminal-access]')?.textContent).toBe('详情');
  expect(document.querySelector('[data-chat-terminal-access] .td-loading-spinner')).toBeNull();
  await page.getByRole('textbox', { name: '给CustomAgent的消息' }).fill('第一条消息');
  expect(document.querySelector('[data-chat-terminal-access]')?.textContent).toBe('详情');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.element(page.getByRole('status', { name: 'CustomAgent处理中' })).toBeVisible();
  expect(document.querySelector('[data-chat-terminal-access] .td-loading-spinner')).not.toBeNull();
  await expect.poll(() => messages.length).toBe(1);
});
it.each([390, 1280])('retries plugin recognition and switches both mode entries at width %i', async width => {
  await page.viewport(width, 844);
  const id = `plugin-mode-${width}-${Date.now()}`;
  let mode = 'terminal', fail = true;
  vi.stubGlobal('fetch', vi.fn(async (url, init?: RequestInit) => {
    if (String(url).includes('chatEligibility') && fail) return Response.json({ code: 'CHAT_PROGRAM_UNAVAILABLE' }, { status: 503 });
    if (init?.body) mode = JSON.parse(String(init.body)).mode;
    return Response.json({ mode, chatEligibility: { allowed: true, program: 'customagent-cli', agent: { slug: 'customagent-fixture', displayName: 'CustomAgent' } } });
  }));
  const host = document.createElement('div'); host.className = 'p-4'; document.body.append(host); root = createRoot(host);
  root.render(<><SessionModeSwitch sessionId={id} /><SessionViewActions sessionId={id} onDone={() => {}} /></>);
  await page.getByRole('button', { name: '切换到对话' }).click();
  await expect.element(page.getByRole('alert')).toHaveTextContent('当前程序识别失败（503）');
  expect(mode).toBe('terminal');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  fail = false;
  await page.getByRole('button', { name: '普通对话', exact: true }).click();
  await expect.element(page.getByRole('button', { name: '切换到终端' })).toBeVisible();
  await expect.poll(() => mode).toBe('chat');
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  await page.getByRole('button', { name: '切换到终端' }).click();
  await page.getByRole('button', { name: '切换到对话' }).click();
  await expect.element(page.getByRole('button', { name: '切换到终端' })).toBeVisible();
});
it.each([390, 1280])('configures an unknown program in place and retains both entry points at width %i', async width => {
  await page.viewport(width, 844); resetCsrfTokenCache();
  const id = `mode-browser-${width}-${Date.now()}`;
  let mode = 'terminal', fail = false, programs: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init?: RequestInit) => {
    if (String(url).includes('csrf-token')) return Response.json({ csrfToken: 'fixture' });
    if (String(url).includes('program-detection')) {
      if (init?.body) { if (fail) return Response.json({}, { status: 503 }); programs = JSON.parse(String(init.body)).chatProgramNames; }
      return Response.json({ shellNames: ['zsh'], genericProgramNames: ['node'], wrapperScriptNames: ['npx'], chatProgramNames: programs });
    }
    if (init?.body) mode = JSON.parse(String(init.body)).mode;
    return Response.json({ mode, chatEligibility: { allowed: programs.includes('my-agent'), program: 'my-agent' } });
  }));
  const host = document.createElement('div'); host.className = 'p-4'; document.body.append(host); root = createRoot(host);
  root.render(<><SessionModeSwitch sessionId={id} /><SessionViewActions sessionId={id} onDone={() => {}} /></>);
  await page.getByRole('button', { name: '切换到对话' }).click();
  await expect.element(page.getByRole('dialog', { name: '配置 Agent 程序识别' })).toBeVisible();
  expect(mode).toBe('terminal');
  const assertVisible = () => {
    for (const element of [document.querySelector('[role="dialog"]')!, document.querySelector('input')!, document.querySelector('button[type="submit"]')!]) {
      const box = element.getBoundingClientRect();
      expect(box.left).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(width);
      expect(box.top).toBeGreaterThanOrEqual(0); expect(box.bottom).toBeLessThanOrEqual(844);
    }
  };
  assertVisible();
  await userEvent.keyboard('{Escape}');
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument(); expect(programs).toEqual([]);
  await page.getByRole('button', { name: '普通对话', exact: true }).click();
  await expect.element(page.getByRole('textbox', { name: '程序名' })).toHaveValue('my-agent');
  fail = true; await page.getByRole('button', { name: '保存并进入对话' }).click();
  await expect.element(page.getByRole('alert')).toBeVisible(); expect(mode).toBe('terminal'); assertVisible();
  fail = false; await page.getByRole('button', { name: '保存并进入对话' }).click();
  await expect.element(page.getByRole('button', { name: '切换到终端' })).toBeVisible();
  await expect.poll(() => mode).toBe('chat');
  await page.getByRole('button', { name: '切换到终端' }).click();
  await page.getByRole('button', { name: '切换到对话' }).click();
  await expect.element(page.getByRole('button', { name: '切换到终端' })).toBeVisible();
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
});

it.each([390, 1280])('retains the same welcome, named editor and draft from launch through readiness at width %i', async width => {
  await page.viewport(width, 844);
  const id = `startup-flow-${width}-${Date.now()}`; launches.push(id);
  beginSessionChatStartup(id, { slug: 'codex', displayName: 'Codex' });
  let release!: (response: Response) => void, available = false, first = true;
  vi.stubGlobal('fetch', vi.fn(async url => {
    if (!String(url).includes('/chat')) return Response.json({});
    if (first) { first = false; return new Promise<Response>(resolve => { release = resolve; }); }
    return Response.json({ agentAvailable: available, agent: available ? { slug: 'codex', displayName: 'Codex' } : null, messages: [] });
  }));
  const host = document.createElement('div'); host.className = 'h-screen'; document.body.append(host); root = createRoot(host);
  root.render(<SessionChatView sessionId={id} onTerminal={() => {}} />);
  await expect.element(page.getByText('想一起完成什么？')).toBeVisible();
  await expect.element(page.getByText('正在启动 Codex，可以先写下需求…')).toBeVisible();
  const editor = document.querySelector('[role="textbox"]')!, welcome = document.querySelector('.session-chat-welcome')!;
  await page.getByRole('textbox', { name: '给Codex的消息' }).fill('先写好需求，等启动完成');
  const before = editor.getBoundingClientRect();
  expect(document.querySelector('[data-chat-loading]')).toBeNull();
  expect(document.querySelector('[data-chat-reply-feedback]')).toBeNull();
  release(Response.json({ agentAvailable: false, messages: [] }));
  useTerminalStore.getState().setTerminalSession(id, { sessionId: 'test-backend', cols: 80, rows: 24 });
  useTerminalStore.getState().setTerminalOutputActivity(id, true);
  await expect.element(page.getByRole('button', { name: '发送消息' })).toBeDisabled();
  await expect.element(page.getByText('当前对话暂不可用。')).not.toBeInTheDocument();
  available = true; window.dispatchEvent(new Event('online'));
  await expect.element(page.getByRole('button', { name: '发送消息' })).toBeEnabled();
  expect(document.querySelector('[role="textbox"]')).toBe(editor); expect(document.querySelector('.session-chat-welcome')).toBe(welcome);
  expect(editor.textContent).toContain('先写好需求，等启动完成'); expect(document.activeElement).toBe(editor);
  const after = editor.getBoundingClientRect(); expect(after.y).toBe(before.y); expect(after.height).toBe(before.height);
  expect(after.bottom).toBeLessThanOrEqual(844); expect(after.right).toBeLessThanOrEqual(width);
  expect(document.querySelector('[data-chat-reply-feedback]')).toBeNull();
});
