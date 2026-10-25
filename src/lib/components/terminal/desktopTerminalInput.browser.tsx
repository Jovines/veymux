import { createRef, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { Swiper, SwiperSlide } from 'swiper/react';
import 'swiper/css';
import '../../../index.css';
import { I18nProvider } from '../../i18n';
import { getDefaultTerminalSettings } from '../../terminal/settings';
import { FLEXOKI_DARK } from '../../terminal/theme';
import { SESSION_NO_SWIPE, SESSION_SWIPER_FOCUSABLE_ELEMENTS } from '../chat/sessionSwipe';
import { TerminalViewport, type TerminalController } from './TerminalViewport';
import { TerminalView } from '../views/TerminalView';
import { getActiveKeyboardLayer, useKeyboardLayer, useKeyboardLayerOpen } from '../../hooks/useKeyboardLayer';

vi.mock('../../terminal/factory', () => ({ createTermdockAPI: () => ({}) }));

declare module 'vitest/browser' {
  interface BrowserCommands {
    desktopTerminalPointer(action: 'click' | 'right-click' | 'drag' | 'wheel'): Promise<void>;
    desktopTerminalComposition(text: string, commit?: boolean): Promise<void>;
  }
}

let root: Root | undefined;
afterEach(async () => {
  root?.unmount(); root = undefined;
  document.body.replaceChildren(); vi.restoreAllMocks();
  await page.viewport(390, 844);
});
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

it('keeps one editable focus target through desktop clicks, composition, selection and refocus', async () => {
  await page.viewport(1280, 900);
  const host = document.createElement('div'); host.style.height = '700px'; document.body.append(host);
  const controller = createRef<TerminalController>(), onInput = vi.fn(), onTmuxScroll = vi.fn();
  const settings = { ...getDefaultTerminalSettings(), rendererMode: 'canvas' as const, enableImages: false, fontLigatures: false };
  root = createRoot(host);
  root.render(<I18nProvider><input aria-label="搜索" /><Swiper style={{ height: 650 }} simulateTouch={false}
    touchStartPreventDefault={false} noSwipingSelector={SESSION_NO_SWIPE} focusableElements={SESSION_SWIPER_FOCUSABLE_ELEMENTS}>
    <SwiperSlide><TerminalViewport ref={controller} sessionKey="desktop-ime" sessionId="desktop-ime"
      chunks={[{ id: 1, data: 'select this terminal text\r\n$ ' }]} onInput={onInput} onResize={vi.fn()}
      onTmuxScroll={onTmuxScroll} terminalSettings={settings} theme={FLEXOKI_DARK} autoFocus={false} /></SwiperSlide>
    <SwiperSlide>另一个会话</SwiperSlide>
  </Swiper></I18nProvider>);
  await expect.poll(() => document.querySelector('.xterm-rows')?.textContent).toContain('select this terminal text');
  const input = document.querySelector<HTMLTextAreaElement>('textarea[data-terminal-input-anchor]')!;
  const helper = document.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')!;
  const writeClipboard = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  const helperFocus = vi.fn(), blur = vi.fn();
  helper.addEventListener('focus', helperFocus); input.addEventListener('blur', blur);
  controller.current!.focus();
  await userEvent.keyboard('abc');
  expect(onInput.mock.calls.map(call => call[0]).join('')).toBe('abc');
  onInput.mockClear();
  await commands.desktopTerminalComposition('ni');
  await expect.poll(() => document.querySelector('[data-terminal-ime-composition]')?.textContent).toBe('ni');
  for (let i = 0; i < 5; i++) {
    await commands.desktopTerminalPointer('click'); await frame();
    expect(document.activeElement).toBe(input);
  }
  expect(helperFocus).not.toHaveBeenCalled();
  expect(blur).not.toHaveBeenCalled();
  expect(document.querySelector('[data-terminal-ime-composition]')?.textContent).toBe('ni');
  expect(onInput).not.toHaveBeenCalled();
  await commands.desktopTerminalComposition('你', true);
  await expect.poll(() => onInput.mock.calls.map(call => call[0]).join('')).toBe('你');
  // Native/programmatic attempts to focus the unused helper must be harmless.
  helper.focus();
  await commands.desktopTerminalPointer('right-click');
  expect(document.activeElement).toBe(input);
  expect(helperFocus).not.toHaveBeenCalled();
  await commands.desktopTerminalPointer('drag');
  const selection = await controller.current!.copySelectionOrViewport();
  expect(selection).toBe(true);
  expect(writeClipboard).toHaveBeenCalledWith(expect.stringMatching(/^[^\r\n]*this term[^\r\n]*$/));
  expect(blur).not.toHaveBeenCalled();
  onInput.mockClear();
  await commands.desktopTerminalPointer('wheel');
  await expect.poll(() => onInput.mock.calls.map(call => call[0]).join('')).toMatch(/\x1b\[<64;\d+;\d+M/);
  expect(document.activeElement).toBe(input);
  await page.getByRole('textbox', { name: '搜索' }).click();
  expect(document.activeElement).not.toBe(input);
  blur.mockClear(); helperFocus.mockClear(); onInput.mockClear();
  await commands.desktopTerminalPointer('click');
  await commands.desktopTerminalComposition('zhong');
  await commands.desktopTerminalComposition('中', true);
  await expect.poll(() => onInput.mock.calls.map(call => call[0]).join('')).toBe('中');
  expect(helperFocus).not.toHaveBeenCalled(); expect(blur).not.toHaveBeenCalled();
});

it('keeps real TerminalView, Swiper, dialog and search focus owners from competing', async () => {
  await page.viewport(1280, 900);
  const host = document.createElement('div'); host.style.height = '700px'; document.body.append(host);
  const settings = { ...getDefaultTerminalSettings(), rendererMode: 'canvas' as const, enableImages: false, fontLigatures: false };
  function Dialog({ close }: { close: () => void }) {
    const ref = useRef<HTMLDivElement>(null); useKeyboardLayer(ref, true, close);
    return <div ref={ref} role="dialog" tabIndex={-1} className="fixed inset-x-8 top-8 z-modal-panel bg-surface p-4">
      <input aria-label="弹层搜索" /><button onClick={close}>关闭弹层</button>
    </div>;
  }
  function App() {
    const [open, setOpen] = useState(false);
    return <I18nProvider><button onClick={() => setOpen(true)}>打开弹层</button><button>普通工具按钮</button><input aria-label="页面搜索" />
      <Swiper style={{ height: 600 }} simulateTouch={false} touchStartPreventDefault={false}
        noSwipingSelector={SESSION_NO_SWIPE} focusableElements={SESSION_SWIPER_FOCUSABLE_ELEMENTS}>
        <SwiperSlide><TerminalView sessionId="focus-browser" initialConnectEnabled={false} terminalSettings={settings} /></SwiperSlide>
        <SwiperSlide>另一个会话</SwiperSlide>
      </Swiper>{open && <Dialog close={() => setOpen(false)} />}</I18nProvider>;
  }
  root = createRoot(host); root.render(<App />);
  await expect.poll(() => document.querySelector('textarea[data-terminal-input-anchor]')).toBeTruthy();
  const input = document.querySelector<HTMLTextAreaElement>('textarea[data-terminal-input-anchor]')!;
  await commands.desktopTerminalPointer('click');
  await expect.poll(() => document.activeElement).toBe(input);
  const focus = vi.spyOn(input, 'focus'), blur = vi.fn(); input.addEventListener('blur', blur);
  window.dispatchEvent(new Event('focus'));
  await new Promise(resolve => setTimeout(resolve, 80));
  expect(focus).not.toHaveBeenCalled(); expect(blur).not.toHaveBeenCalled();
  await page.getByRole('button', { name: '普通工具按钮' }).click();
  await frame();
  expect(document.activeElement?.textContent).toBe('普通工具按钮');
  await page.getByRole('button', { name: '打开弹层' }).click();
  const editor = page.getByRole('textbox', { name: '弹层搜索' });
  await expect.element(editor).toHaveFocus();
  await commands.desktopTerminalComposition('zhong');
  await commands.desktopTerminalComposition('中', true);
  await expect.element(editor).toHaveValue('中');
  await userEvent.keyboard('{Escape}');
  await expect.element(page.getByRole('button', { name: '打开弹层' })).toHaveFocus();
  await page.getByRole('textbox', { name: '页面搜索' }).click();
  await commands.desktopTerminalComposition('wen');
  await commands.desktopTerminalComposition('文', true);
  await expect.element(page.getByRole('textbox', { name: '页面搜索' })).toHaveValue('文');
  expect(focus).not.toHaveBeenCalled();
});

it('ignores a retained hidden layer and yields to the desktop confirmation without hidden focus requests', async () => {
  const host = document.createElement('div'); document.body.append(host);
  function Retained() {
    const ref = useRef<HTMLDivElement>(null);
    useKeyboardLayer(ref, true, () => {});
    const open = useKeyboardLayerOpen();
    return <><input aria-label="前台搜索" /><output data-layer-open>{String(open)}</output>
      <div ref={ref} data-retained-layer tabIndex={-1}><input aria-label="保留的弹层输入" /></div></>;
  }
  root = createRoot(host); root.render(<Retained />);
  await expect.poll(() => document.querySelector('[data-layer-open]')?.textContent).toBe('true');
  const layer = document.querySelector<HTMLElement>('[data-retained-layer]')!;
  const input = layer.querySelector('input')!, focus = vi.spyOn(input, 'focus');
  layer.setAttribute('inert', ''); layer.style.visibility = 'hidden';
  await expect.poll(() => document.querySelector('[data-layer-open]')?.textContent).toBe('false');
  await page.getByRole('textbox', { name: '前台搜索' }).click();
  expect(focus).not.toHaveBeenCalled();
  const confirmation = document.createElement('section'), cancel = document.createElement('button');
  confirmation.dataset.desktopConfirmation = 'true'; confirmation.append(cancel); document.body.append(confirmation);
  try {
    cancel.focus();
    expect(document.activeElement).toBe(cancel);
    expect(getActiveKeyboardLayer()?.element).toBe(confirmation);
    await expect.poll(() => document.querySelector('[data-layer-open]')?.textContent).toBe('true');
    expect(focus).not.toHaveBeenCalled();
  } finally { confirmation.remove(); }
});

it('keeps background output out of IME layout and freezes composition through a busy session', async () => {
  await page.viewport(1280, 900);
  const host = document.createElement('div'); host.style.height = '700px'; document.body.append(host);
  const controller = createRef<TerminalController>(), onInput = vi.fn();
  const settings = { ...getDefaultTerminalSettings(), rendererMode: 'canvas' as const, enableImages: false, fontLigatures: false };
  let publish!: (id: number) => void;
  let written = 0;
  function BusySession() {
    const [chunks, setChunks] = useState([{ id: 1, data: '$ ' }]);
    publish = id => setChunks(previous => [...previous, { id, data: `\r\x1b[2Kworking ${id} $ ` }]);
    return <I18nProvider><input aria-label="其他输入框" /><Swiper style={{ height: 650 }} simulateTouch={false}
      touchStartPreventDefault={false} noSwipingSelector={SESSION_NO_SWIPE} focusableElements={SESSION_SWIPER_FOCUSABLE_ELEMENTS}>
      <SwiperSlide><TerminalViewport ref={controller} sessionKey="busy-ime" sessionId="busy-ime"
        chunks={chunks} onInput={onInput} onResize={vi.fn()} onWriteProgress={id => { written = id; }}
        terminalSettings={settings} theme={FLEXOKI_DARK} autoFocus={false} /></SwiperSlide>
      <SwiperSlide>另一个会话</SwiperSlide>
    </Swiper></I18nProvider>;
  }
  root = createRoot(host); root.render(<BusySession />);
  await expect.poll(() => written).toBe(1);
  await page.getByRole('textbox', { name: '其他输入框' }).click();
  await frame(); await frame();
  const screen = document.querySelector<HTMLElement>('.xterm-screen')!;
  const measure = vi.spyOn(screen, 'getBoundingClientRect');
  for (let id = 2; id <= 9; id++) {
    publish(id);
    await expect.poll(() => written).toBe(id);
    await frame();
  }
  // An unfocused session has no candidate window to position. Its parser and
  // renderer must not force DOM measurements for each output update.
  expect(measure).not.toHaveBeenCalled();

  controller.current!.focus();
  const input = document.querySelector<HTMLTextAreaElement>('textarea[data-terminal-input-anchor]')!;
  const blur = vi.fn(); input.addEventListener('blur', blur);
  await commands.desktopTerminalComposition('zhong');
  await expect.poll(() => document.querySelector('[data-terminal-ime-composition]')?.textContent).toBe('zhong');
  const anchor = { left: input.style.left, top: input.style.top };
  measure.mockClear();
  for (let id = 10; id <= 17; id++) {
    publish(id);
    await expect.poll(() => written).toBe(id);
    await frame();
  }
  expect(measure).not.toHaveBeenCalled();
  expect({ left: input.style.left, top: input.style.top }).toEqual(anchor);
  expect(document.activeElement).toBe(input);
  expect(blur).not.toHaveBeenCalled();
  expect(onInput).not.toHaveBeenCalled();
  await commands.desktopTerminalComposition('中文', true);
  await expect.poll(() => onInput.mock.calls.map(call => call[0]).join('')).toBe('中文');
});
