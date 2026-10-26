import { useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import { Swiper, SwiperSlide } from 'swiper/react';
import type { Swiper as SwiperInstance } from 'swiper';
import 'swiper/css';
import '../../index.css';
import { SessionCurrentTitle } from './SessionCurrentTitle';
import { AgentTabIcon, AgentCompactStatusOverlay } from './AgentIndicators';
import { SidebarVisibilityButton } from './sidebar/SidebarVisibilityButton';
import { TodoNavigationButton } from './todos/TodoNavigationButton';
import { CodexQuotaBadge } from './sidebar/CodexQuotaBadge';
import { SessionModeSwitch } from './chat/SessionModeSwitch';
import { SESSION_SWIPER_FOCUSABLE_ELEMENTS } from './chat/sessionSwipe';
import type { QuotaResult } from '../terminal/api';
let root: Root | undefined;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const pagerSettled = () => expect.poll(() => (document.querySelector('[data-test-pager]') as HTMLElement & { swiper?: SwiperInstance })?.swiper?.animating).toBe(false);
const quota = (usagePercent: number): QuotaResult => ({ slug: 'codex', displayName: 'Codex', usagePercent, entitlement: 100, remaining: 100 - usagePercent, windows: [], fetchedAt: Date.now() });
afterEach(() => { root?.unmount(); root = undefined; document.body.replaceChildren(); document.documentElement.style.removeProperty('--safe-top-inset'); vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear(); });
const sessions = [{ id: 'codex-first', name: '回复用户问候 | web-terminal', codex: true }, { id: 'claude-second', name: 'Claude 检查终端连接', codex: false }, { id: 'codex-last', name: '核对长会话名称与 Agent 用量并确认顶部按钮不会被挤出屏幕的工作区', codex: true }];
async function mount(width: number, delayedQuota?: Promise<Response>, workspaceWidth?: number) {
  await page.viewport(width, 844);
  let todos = 7;
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => String(url).endsWith('/quota') ? delayedQuota ?? Response.json({ providers: [quota(30)], updatedAt: Date.now() }) : String(url).endsWith('/todos/summary') ? Response.json({ count: todos }) : Response.json({ mode: 'chat', chatEligibility: { allowed: true }, locale: 'zh' })));
  let change!: (id: number) => void;
  const openQuota = vi.fn();
  function Fixture() {
    const [active, setActive] = useState(0), swiper = useRef<SwiperInstance>();
    const session = sessions[active], mobile = width < 1024;
    change = index => { setActive(index); swiper.current?.slideTo(index, 0); };
    return <div className="flex h-full flex-col" style={{ width: workspaceWidth }}><header data-test-current-header className={`relative flex h-11 shrink-0 items-center gap-1 px-1 lg:h-10 ${mobile ? '' : 'justify-end'}`}>
      {mobile && <SidebarVisibilityButton side="left" expanded={false} onClick={() => {}} className="relative h-8 w-8"><AgentCompactStatusOverlay runningCount={2} reviewCount={3} className="sm:hidden" /></SidebarVisibilityButton>}
      <SessionCurrentTitle sessionId={session.id} name={session.name} mobile={mobile} icon={<AgentTabIcon sessionMode="shell" state={{ agent: { slug: session.codex ? 'codex' : 'claude', displayName: 'Agent', accentColor: 'var(--primary)', icon: null }, agentStatus: 'waiting' }} />}
        quota={session.codex && <CodexQuotaBadge compact={mobile} onOpen={openQuota} />} status={<span aria-label="Agent 工作中" className="shrink-0">◌</span>} />
      <div data-test-current-actions className="flex shrink-0 items-center gap-1.5"><SessionModeSwitch sessionId={session.id} share={false} /><TodoNavigationButton placement="toolbar" onOpen={() => {}} /><button className="h-8 w-8 shrink-0" aria-label="工具">☰</button></div>
    </header><Swiper data-test-pager className="min-h-0 w-full flex-1" onSwiper={value => { swiper.current = value; }} onSlideChange={value => setActive(value.activeIndex)} touchStartPreventDefault={false} focusableElements={SESSION_SWIPER_FOCUSABLE_ELEMENTS}>
      {sessions.map(session => <SwiperSlide key={session.id}><main className="h-full p-6"><p>{session.name}</p><textarea aria-label={`草稿 ${session.id}`} defaultValue="保留我的草稿" /></main></SwiperSlide>)}
    </Swiper></div>;
  }
  const host = document.createElement('div'); host.id = 'root'; document.documentElement.style.setProperty('--safe-top-inset', width < 1024 ? '44px' : '0px'); document.body.append(host); root = createRoot(host); root.render(<Fixture />);
  await expect.poll(() => document.querySelector('[data-session-current-title]')?.getAttribute('data-session-current-title')).toBe(sessions[0].id);
  return { change: (id: number) => change(id), openQuota, setTodos: (count: number) => { todos = count; window.dispatchEvent(new Event('termdock:todos-changed')); } };
}
it.each([320, 390, 844, 1280])('shows one current name and desktop quota without moving the content at width %i', async width => {
  const f = await mount(width);
  await expect.poll(() => document.querySelector('[data-session-current-quota]')?.textContent).toContain('70%');
  expect(document.querySelectorAll('[data-session-current-title]')).toHaveLength(1);
  expect(document.querySelector('[data-session-tab-scroll]')).toBeNull();
  const header = document.querySelector<HTMLElement>('[data-test-current-header]')!, actions = document.querySelector<HTMLElement>('[data-test-current-actions]')!;
  const before = document.querySelector('[data-test-pager]')!.getBoundingClientRect().top;
  await expect.poll(() => document.querySelector('[data-todo-count]')?.textContent).toBe('7');
  const headerBounds = header.getBoundingClientRect();
  if (width < 1024) expect(headerBounds.top).toBeGreaterThanOrEqual(44);
  for (const badge of header.querySelectorAll<HTMLElement>('[data-todo-count], [aria-hidden="true"] > span')) {
    const rect = badge.getBoundingClientRect();
    if (rect.height > 0) { expect(rect.top).toBeGreaterThanOrEqual(headerBounds.top); expect(rect.bottom).toBeLessThanOrEqual(headerBounds.bottom); }
  }
  f.setTodos(0); await expect.poll(() => document.querySelector('[data-todo-count]')).toBeNull();
  f.setTodos(137); await expect.poll(() => document.querySelector('[data-todo-count]')?.textContent).toBe('99+');
  window.dispatchEvent(new CustomEvent('termdock:quota-update', { detail: [quota(80)] }));
  await expect.poll(() => document.querySelector('[data-session-current-quota]')?.textContent).toContain('20%');
  await page.getByRole('button', { name: /^Codex ·/ }).click(); expect(f.openQuota).toHaveBeenCalledOnce();
  f.change(2);
  await expect.poll(() => document.querySelector('[data-session-current-label]')?.textContent).toContain(sessions[2].name);
  const label = document.querySelector('[data-session-current-label]')!.getBoundingClientRect(), control = actions.getBoundingClientRect();
  expect(label.right).toBeLessThanOrEqual(control.left + 1);
  expect(actions.getBoundingClientRect().right).toBeLessThanOrEqual(innerWidth);
  expect(header.scrollWidth).toBeLessThanOrEqual(header.clientWidth);
  expect(document.querySelector('[data-test-pager]')!.getBoundingClientRect().top).toBe(before);
  if (width < 1024) expect(document.querySelector('[data-session-current-quota]')!.getBoundingClientRect().bottom).toBeLessThanOrEqual(header.getBoundingClientRect().bottom + 1);
  await page.screenshot({ path: `/tmp/termdock-current-title-${width}.png` });
});
it.each([480, 680, 900])('keeps the long title, status and full quota inside a %i px desktop workspace', async workspaceWidth => {
  const f = await mount(1440, undefined, workspaceWidth);
  f.change(2);
  await expect.poll(() => document.querySelector('[data-session-current-title]')?.getAttribute('data-session-current-title')).toBe(sessions[2].id);
  await expect.poll(() => document.querySelector('[data-session-current-quota]')?.textContent).toContain('70%');
  const title = document.querySelector<HTMLElement>('[data-session-current-title]')!;
  const label = document.querySelector<HTMLElement>('[data-session-current-label]')!;
  const quota = document.querySelector<HTMLElement>('[data-session-current-quota]')!;
  const bounds = title.getBoundingClientRect();
  for (const element of [label, ...label.children, quota, ...quota.querySelectorAll('button, button > span')]) {
    const rect = element.getBoundingClientRect();
    expect(rect.left).toBeGreaterThanOrEqual(bounds.left - 1);
    expect(rect.right).toBeLessThanOrEqual(bounds.right + 1);
  }
  expect(label.getBoundingClientRect().right).toBeLessThanOrEqual(quota.getBoundingClientRect().left);
  const text = label.querySelector<HTMLElement>('span.truncate')!;
  expect(text.clientWidth).toBeGreaterThan(12);
  expect(text.scrollWidth).toBeGreaterThan(text.clientWidth);
  await page.getByRole('button', { name: /^Codex ·/ }).click();
  expect(f.openQuota).toHaveBeenCalledOnce();
  await page.screenshot({ path: `/tmp/termdock-current-title-desktop-${workspaceWidth}.png` });
});
it('updates the sole title and quota availability with real left/right Session swipes', async () => {
  await mount(390);
  await expect.poll(() => document.querySelector('[data-session-current-quota]')?.textContent).toContain('70%');
  await commands.sessionTabsSwipe('[data-test-pager]', -240);
  await expect.poll(() => document.querySelector('[data-session-current-title]')?.getAttribute('data-session-current-title')).toBe(sessions[1].id);
  expect(document.querySelector('[data-session-current-quota]')).toBeNull(); await pagerSettled();
  await commands.sessionTabsSwipe('[data-test-pager]', -240);
  await expect.poll(() => document.querySelector('[data-session-current-title]')?.getAttribute('data-session-current-title')).toBe(sessions[2].id);
  await expect.poll(() => document.querySelector('[data-session-current-quota]')?.textContent).toContain('70%');
  await pagerSettled(); await commands.sessionTabsSwipe('[data-test-pager]', 240); await pagerSettled();
  await commands.sessionTabsSwipe('[data-test-pager]', 240);
  await expect.poll(() => document.querySelector('[data-session-current-title]')?.getAttribute('data-session-current-title')).toBe(sessions[0].id);
  expect((document.querySelector('[aria-label="草稿 codex-first"]') as HTMLTextAreaElement).value).toBe('保留我的草稿');
});
it('cannot attach an old quota response to the next Agent after a switch', async () => {
  let resolve!: (response: Response) => void;
  const f = await mount(390, new Promise<Response>(done => { resolve = done; }));
  f.change(1); await expect.poll(() => document.querySelector('[data-session-current-title]')?.getAttribute('data-session-current-title')).toBe(sessions[1].id);
  resolve(Response.json({ providers: [quota(90)], updatedAt: Date.now() })); await pause(60);
  expect(document.querySelector('[data-session-current-quota]')).toBeNull();
});
