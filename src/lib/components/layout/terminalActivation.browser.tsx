import { createRef, useLayoutEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { Swiper, SwiperSlide } from 'swiper/react';
import type { Swiper as SwiperInstance } from 'swiper';
import 'swiper/css';
import '../../../index.css';
import { TerminalViewport, type TerminalController } from '../terminal/TerminalViewport';
import { getDefaultTerminalSettings } from '../../terminal/settings';
import { FLEXOKI_DARK } from '../../terminal/theme';
import { SESSION_SWIPER_FOCUSABLE_ELEMENTS } from '../chat/sessionSwipe';

let root: Root | undefined;
afterEach(() => { root?.unmount(); root = undefined; document.body.replaceChildren(); vi.unstubAllGlobals(); });

it('uses the same measured activation for sidebar, keyboard and Swiper navigation, then sends the current grid after sidebar resizing', async () => {
  await page.viewport(1440, 900);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ locale: 'en' }))));
  const refs = { a: createRef<TerminalController>(), b: createRef<TerminalController>() };
  const sent = { a: vi.fn(), b: vi.fn() };
  const server = { a: { cols: 50, rows: 20 }, b: { cols: 50, rows: 20 } };
  let swiper: SwiperInstance;
  const settings = { ...getDefaultTerminalSettings(), rendererMode: 'canvas' as const, enableImages: false, fontLigatures: false };
  function Fixture() {
    const [active, setActive] = useState<'a' | 'b'>('a'), [rightOpen, setRightOpen] = useState(true);
    useLayoutEffect(() => { swiper?.slideTo(active === 'a' ? 0 : 1, 0); }, [active]);
    useLayoutEffect(() => {
      const keyboard = (event: KeyboardEvent) => { if (event.altKey && event.key === 'ArrowRight') setActive('b'); };
      document.addEventListener('keydown', keyboard); return () => document.removeEventListener('keydown', keyboard);
    }, []);
    return <div className="h-dvh flex flex-col">
      <header className="flex h-10 shrink-0 gap-4">
        <button onClick={() => setActive('a')}>进入 A</button><button onClick={() => setActive('b')}>侧栏进入 B</button>
        <button onClick={() => setRightOpen(!rightOpen)}>{rightOpen ? '收起右侧栏' : '展开右侧栏'}</button>
      </header>
      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1"><Swiper className="h-full" speed={0} onSwiper={instance => { swiper = instance; }}
          onSlideChange={instance => setActive(instance.activeIndex === 0 ? 'a' : 'b')}
          touchStartPreventDefault={false} focusableElements={SESSION_SWIPER_FOCUSABLE_ELEMENTS} simulateTouch={false}>
          {(['a', 'b'] as const).map(id => <SwiperSlide key={id}><TerminalViewport ref={refs[id]} sessionKey={`activation-${id}`} sessionId={`activation-${id}`}
            isActive={active === id} isLayoutVisible={active === id} terminalSettings={settings} theme={FLEXOKI_DARK}
            autoFocus={false} chunks={[]} onInput={vi.fn()} onResize={(cols, rows, seq) => {
              sent[id](cols, rows, seq); server[id] = { cols, rows };
              queueMicrotask(() => refs[id].current?.acknowledgeResize({ seq, ok: true, cols, rows }));
            }} /></SwiperSlide>)}
        </Swiper></main>
        <aside style={{ width: rightOpen ? 360 : 0, flexShrink: 0 }} />
      </div>
    </div>;
  }
  const host = document.createElement('div'); host.id = 'root'; document.body.append(host);
  root = createRoot(host); flushSync(() => root!.render(<Fixture />));
  await expect.poll(() => refs.a.current?.getDimensions()?.cols).toBeGreaterThan(50);
  await expect.poll(() => refs.b.current?.getDimensions()?.cols).toBeGreaterThan(50);
  for (const id of ['a', 'b'] as const) refs[id].current!.setSessionReady(true, refs[id].current!.getDimensions()!);

  const takeOverB = () => { server.b = { cols: 50, rows: 20 }; refs.b.current!.notifyServerSize(50, 20, 'ws-resize:phone'); sent.b.mockClear(); };
  const check = async () => {
    await expect.poll(() => sent.b.mock.calls.length).toBe(1);
    expect(server.b).toEqual(refs.b.current!.getDimensions());
    expect(sent.b).toHaveBeenLastCalledWith(server.b.cols, server.b.rows, expect.any(Number));
  };
  takeOverB();
  await page.getByRole('button', { name: '侧栏进入 B', exact: true }).click();
  await check();
  await page.getByRole('button', { name: '进入 A', exact: true }).click();
  takeOverB();
  await userEvent.keyboard('{Alt>}{ArrowRight}{/Alt}');
  await check();
  await page.getByRole('button', { name: '进入 A', exact: true }).click();
  takeOverB();
  swiper!.slideTo(1, 0);
  await check();

  const narrow = refs.b.current!.getDimensions()!;
  sent.b.mockClear(); sent.a.mockClear();
  await page.getByRole('button', { name: '收起右侧栏', exact: true }).click();
  await expect.poll(() => refs.b.current!.getDimensions()!.cols).toBeGreaterThan(narrow.cols);
  await check();
  sent.b.mockClear();
  await page.getByRole('button', { name: '展开右侧栏', exact: true }).click();
  await expect.poll(() => refs.b.current!.getDimensions()!.cols).toBe(narrow.cols);
  await check();
  expect(sent.a).not.toHaveBeenCalled();
});
