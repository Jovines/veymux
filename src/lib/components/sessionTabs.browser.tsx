import { useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import { commands, page } from 'vitest/browser';
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd';
import { Swiper, SwiperSlide } from 'swiper/react';
import type { Swiper as SwiperInstance } from 'swiper';
import 'swiper/css';
import '../../index.css';
import { SessionTabStrip } from './SessionTabStrip';
import { SESSION_SWIPER_FOCUSABLE_ELEMENTS } from './chat/sessionSwipe';
declare module 'vitest/browser' { interface BrowserCommands { sessionTabsSwipe(selector: string, dx: number): Promise<void> } }
let root: Root | undefined;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
afterEach(() => { root?.unmount(); root = undefined; document.body.replaceChildren(); });
async function mount(width: number) {
  await page.viewport(width, 844);
  let change!: (id: number) => void, rename!: () => void, rerender!: () => void;
  function Fixture() {
    const [active, setActive] = useState(10), [long, setLong] = useState(false), [revision, setRevision] = useState(0);
    const swiper = useRef<SwiperInstance>();
    change = id => { setActive(id); swiper.current?.slideTo(id, 0); }; rename = () => setLong(true); rerender = () => setRevision(n => n + 1);
    return <div className="flex h-dvh flex-col"><header className="flex h-10 shrink-0 items-center gap-1 px-1"><button className="h-8 w-8 shrink-0">列表</button>
      <DragDropContext onDragEnd={() => {}}><Droppable droppableId="tabs" direction="horizontal">{provided => <SessionTabStrip ref={provided.innerRef} {...provided.droppableProps} activeSessionId={`tab-${active}`}>
        {Array.from({ length: 21 }, (_, i) => <Draggable key={i} draggableId={`tab-${i}`} index={i} disableInteractiveElementBlocking>{drag => <div ref={drag.innerRef} {...drag.draggableProps} className="flex h-full shrink-0 items-center">
          <div data-session-tab-id={`tab-${i}`} className={`inline-flex h-8 shrink-0 items-center rounded-md ${i === active ? 'bg-surface-elevated text-foreground' : 'text-muted-foreground'}`}><button {...drag.dragHandleProps} aria-current={i === active ? 'page' : undefined} className="flex min-w-0 items-center gap-1 overflow-hidden px-2 text-left text-[11px]" onClick={() => change(i)}><span className="shrink-0">◉</span><span className="truncate">{i === 10 ? long ? '这是异步更新后的很长会话名称，用于核对左右边界和字体变化' : '回复用户问候 | web-terminal' : `工作区 ${i}`}</span></button></div>
        </div>}</Draggable>)}{provided.placeholder}</SessionTabStrip>}</Droppable></DragDropContext>
      <button className="flex h-8 shrink-0 items-center gap-1.5 px-2 text-[11px]">▣ 切换</button><button className="h-11 w-11 shrink-0 sm:h-8 sm:w-8">待办</button><button className="h-8 w-8 shrink-0">工具</button></header>
      <output data-active={active} className="sr-only">{revision}</output>
      <Swiper data-test-pager className="min-h-0 w-full flex-1" initialSlide={10} onSwiper={s => { swiper.current = s; }} onSlideChange={s => setActive(s.activeIndex)} touchStartPreventDefault={false} focusableElements={SESSION_SWIPER_FOCUSABLE_ELEMENTS}>
        {Array.from({ length: 21 }, (_, i) => <SwiperSlide key={i}><main className="h-full p-6"><h1>会话 {i}</h1><textarea aria-label={`草稿 ${i}`} defaultValue={`会话 ${i} 的草稿`} /></main></SwiperSlide>)}
      </Swiper></div>;
  }
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host); root.render(<Fixture />);
  await expect.poll(() => document.querySelectorAll('[data-session-tab-id]').length).toBe(21); await pause(100);
  return { change: (id: number) => change(id), rename: () => rename(), rerender: () => rerender(), scroll: () => document.querySelector<HTMLElement>('[data-session-tab-scroll]')! };
}
function activeFits() {
  const scroll = document.querySelector('[data-session-tab-scroll]')!.getBoundingClientRect();
  const tab = document.querySelector('[aria-current="page"]')!.parentElement!.getBoundingClientRect();
  return tab.left >= scroll.left - 1 && tab.right <= scroll.right + 1;
}
it.each([320, 390, 844, 1280])('follows selection and label resizing without panning the page at width %i', async width => {
  const f = await mount(width);
  await expect.poll(activeFits).toBe(true);
  for (const id of [20, 0, 18, 2, 10]) { f.change(id); await expect.poll(activeFits).toBe(true); }
  f.rename(); await expect.poll(() => document.querySelector('[data-session-tab-id="tab-10"]')?.textContent?.includes('异步更新')).toBe(true);
  await expect.poll(activeFits).toBe(true); await pause(80);
  const widthAfter = document.querySelector('[data-session-tab-id="tab-10"]')!.getBoundingClientRect().width;
  if (width < 768) expect(widthAfter).toBeLessThanOrEqual(Math.min(width * .46, 192) + 1);
  expect(window.scrollX).toBe(0); expect(window.scrollY).toBe(0);
  expect(document.documentElement.scrollWidth).toBe(document.documentElement.clientWidth);
  expect(document.querySelector<HTMLInputElement>('[aria-label="草稿 10"]')!.value).toBe('会话 10 的草稿');
  f.scroll().scrollLeft = 0; f.scroll().dispatchEvent(new Event('scroll')); await pause(40);
  f.rerender(); await pause(40);
  expect(f.scroll().scrollLeft).toBe(0); // Background renders cannot undo manual browsing.
});
it('keeps the strip and real Session swipe gestures independent and shows overflow edges at the ends', async () => {
  const f = await mount(390);
  await commands.sessionTabsSwipe('[data-test-pager]', -240);
  await expect.poll(() => document.querySelector('[data-active]')?.getAttribute('data-active')).toBe('11');
  await expect.poll(activeFits).toBe(true);
  await commands.sessionTabsSwipe('[data-test-pager]', 240);
  await expect.poll(() => document.querySelector('[data-active]')?.getAttribute('data-active')).toBe('10');
  await expect.poll(activeFits).toBe(true);
  const before = f.scroll().scrollLeft;
  await commands.sessionTabsSwipe('[data-session-tab-scroll]', -120); await pause(150);
  expect(f.scroll().scrollLeft).toBeGreaterThan(before);
  expect(document.querySelector('[data-active]')?.getAttribute('data-active')).toBe('10');
  f.change(0); await expect.poll(() => f.scroll().hasAttribute('data-overflow-start')).toBe(false);
  expect(f.scroll().hasAttribute('data-overflow-end')).toBe(true);
  f.change(20); await expect.poll(() => f.scroll().hasAttribute('data-overflow-end')).toBe(false);
  expect(f.scroll().hasAttribute('data-overflow-start')).toBe(true);
});
it('positions a late restored selection inside folder groups and survives collapsing that group', async () => {
  await page.viewport(390, 844);
  let restore!: () => void, collapse!: () => void;
  function Grouped() {
    const [ready, setReady] = useState(false), [open, setOpen] = useState(true);
    restore = () => setReady(true); collapse = () => setOpen(value => !value);
    return <header className="flex h-10 w-full gap-1"><button className="w-10 shrink-0">列表</button><SessionTabStrip activeSessionId="restored" ready={ready}>
      {ready && ['项目 A', '项目 B'].map((name, index) => <div key={name} className="flex shrink-0 flex-col"><button onClick={collapse} className="text-[9px]">{name}</button><div className="flex gap-1">{open && Array.from({ length: 6 }, (_, i) => <div key={i} data-session-tab-id={index === 1 && i === 4 ? 'restored' : `${name}-${i}`} className="inline-flex h-5 shrink-0"><button aria-current={index === 1 && i === 4 ? 'page' : undefined} className="min-w-0 truncate px-2 text-[11px]">{name} 的会话 {i}</button></div>)}</div></div>)}
    </SessionTabStrip><button className="w-10 shrink-0">工具</button></header>;
  }
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host); root.render(<Grouped />);
  await pause(30); restore(); await expect.poll(activeFits).toBe(true);
  collapse(); await expect.poll(() => document.querySelector('[data-session-tab-id="restored"]')).toBeNull();
  collapse(); await expect.poll(() => !!document.querySelector('[data-session-tab-id="restored"]')).toBe(true); await expect.poll(activeFits).toBe(true);
});
