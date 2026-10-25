import { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { page, commands } from 'vitest/browser';
import '../../../index.css';
import { LeftSidebar } from './LeftSidebar';
import { I18nProvider } from '../../i18n';
import { useSidebarStore } from '../../stores/useSidebarStore';
import { SIDEBAR_SCROLL_POSITION_KEY } from './useSidebarScrollPosition';

let root: Root;
const sessions = Array.from({ length: 30 }, (_, i) => ({ id: `session-${i}`, name: `Session ${i + 1}`, mode: 'shell' as const }));
let setOpen: (open: boolean) => void;
const list = () => document.querySelector<HTMLElement>('.sidebar-session-primary')!.closest<HTMLElement>('.overflow-y-auto')!;
function Harness({ pinned = false }: { pinned?: boolean }) {
  const [open, updateOpen] = useState(pinned);
  setOpen = updateOpen;
  return <div style={{ height: '100dvh', display: pinned && !open ? 'none' : 'flex', width: 320 }}><I18nProvider><LeftSidebar
    isOpen={open} pinned={pinned} drawerWidthPx={320} sessions={sessions} activeSessionId="session-29"
    sessionStates={new Map()} splitWorkspaces={[]}
    onOpen={() => updateOpen(true)} onClose={() => updateOpen(false)}
    onNewSession={vi.fn()} onCloseSession={vi.fn()} onSplitSession={vi.fn()} onCloseSplit={vi.fn()}
    onRemoveFromSplit={vi.fn()} onSetSplitLayout={vi.fn()} onReorderSplitWorkspace={vi.fn()} onRenameSplitWorkspace={vi.fn()}
    onCombineSplitSessions={vi.fn()} onReorderSessions={vi.fn()} onOpenSettings={vi.fn()}
  /></I18nProvider></div>;
}
beforeEach(() => {
  localStorage.clear();
  useSidebarStore.setState({ groupByFolder: false, collapsedGroups: new Set() });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ groups: [], agents: [], tasks: [], locale: 'en' }), { headers: { 'Content-Type': 'application/json' } })));
});
afterEach(() => { root?.unmount(); document.body.replaceChildren(); vi.unstubAllGlobals(); });
async function mount(pinned = false) {
  await page.viewport(pinned ? 1440 : 402, pinned ? 900 : 874);
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  flushSync(() => root.render(<Harness pinned={pinned} />));
  await expect.poll(() => document.querySelectorAll('.sidebar-session-primary').length).toBe(30);
}
it('positions the selected session before the first visible edge-swipe frame, including reopening', async () => {
  localStorage.setItem(SIDEBAR_SCROLL_POSITION_KEY, '180');
  await mount();
  expect(list().scrollTop).toBe(180);
  for (let attempt = 0; attempt < 2; attempt++) {
    const samples: number[] = [];
    let sampling = true;
    const sample = () => {
      const panel = document.querySelector<HTMLElement>('[data-sidebar="left"]')!;
      if (panel?.getBoundingClientRect().right > 20) samples.push(list().scrollTop);
      if (sampling) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    await (commands as unknown as { swipeSidebar(dx: number): Promise<void> }).swipeSidebar(280);
    await expect.poll(() => document.querySelector<HTMLElement>('[data-sidebar="left"]')!.style.pointerEvents).toBe('auto');
    sampling = false;
    expect(samples.length).toBeGreaterThan(0);
    expect(Math.min(...samples)).toBeGreaterThan(100);
    expect(Math.max(...samples) - Math.min(...samples)).toBeLessThanOrEqual(1);
    list().scrollTop = 0;
    flushSync(() => setOpen(false));
    await expect.poll(() => document.querySelector('[data-sidebar="left"]')!.getBoundingClientRect().right).toBeLessThan(1);
  }
});
it('keeps a cancelled edge swipe closed and can open again with the selected row in view', async () => {
  await mount();
  const swipe = (dx: number) => (commands as unknown as { swipeSidebar(dx: number): Promise<void> }).swipeSidebar(dx);
  await swipe(24);
  await expect.poll(() => document.querySelector('[data-sidebar="left"]')!.getBoundingClientRect().right).toBeLessThan(1);
  expect(document.querySelector<HTMLElement>('[data-sidebar="left"]')!.style.pointerEvents).toBe('none');
  await swipe(280);
  await expect.poll(() => document.querySelector<HTMLElement>('[data-sidebar="left"]')!.style.pointerEvents).toBe('auto');
  const selected = Array.from(document.querySelectorAll('.sidebar-session-primary')).at(-1)!.getBoundingClientRect();
  expect(selected.top).toBeGreaterThanOrEqual(list().getBoundingClientRect().top);
  expect(selected.bottom).toBeLessThanOrEqual(list().getBoundingClientRect().bottom);
});
it('keeps manual desktop scrolling across hide and show', async () => {
  await mount(true);
  list().scrollTop = 100;
  flushSync(() => setOpen(false)); flushSync(() => setOpen(true));
  expect(list().scrollTop).toBe(100);
});
