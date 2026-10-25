// @vitest-environment jsdom
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SessionCapabilitiesContext } from '../../federation/ShareAccessContext';
import { sharedSessionCapabilities } from '../../federation/sessionCapabilities';
import { TerminalPeekContext, TerminalPeekTrigger, terminalPeekPosition, useSessionTerminalPeek } from './SessionTerminalPeek';
const mounted = vi.fn(), unmounted = vi.fn(), expand = vi.fn();
function Terminal() { useEffect(() => { mounted(); return unmounted; }, []); return <textarea aria-label="terminal" defaultValue="retained" />; }
function Harness({ enabled = true, secondary = false }: { enabled?: boolean; secondary?: boolean }) {
  const peek = useSessionTerminalPeek({ enabled, name: '构建检查', expand });
  return <TerminalPeekContext.Provider value={peek.context}>
    <input aria-label="chat" /><div ref={peek.attachNormal} data-normal-slot />
    {createPortal(<Terminal />, peek.host)}
    <TerminalPeekTrigger className="">工作中…</TerminalPeekTrigger>
    {secondary && <TerminalPeekTrigger label="查看头像终端" className="">头像</TerminalPeekTrigger>}
    <output data-interactive>{String(peek.interactive)}</output>{peek.popover}
  </TerminalPeekContext.Provider>;
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerType = 'mouse'; });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(32, 32, 120, 32));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('moves the retained terminal without stealing chat focus or creating another terminal', () => {
  const view = render(<Harness />), chat = screen.getByLabelText('chat'), terminal = screen.getByLabelText('terminal'); chat.focus();
  fireEvent.click(screen.getByRole('button', { name: '查看会话终端' }));
  expect(screen.getByRole('dialog', { name: '会话终端预览' }).contains(terminal)).toBe(true);
  expect(document.activeElement).toBe(chat);
  expect(view.container.querySelector('[data-interactive]')?.textContent).toBe('false');
  fireEvent.pointerDown(terminal);
  expect(view.container.querySelector('[data-interactive]')?.textContent).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '关闭终端预览' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(view.container.querySelector('[data-normal-slot]')?.contains(terminal)).toBe(true);
  expect(mounted).toHaveBeenCalledOnce(); expect(unmounted).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '查看会话终端' }));
  fireEvent.click(screen.getByRole('button', { name: '在完整会话中打开终端' }));
  expect(expand).toHaveBeenCalledOnce(); expect(unmounted).not.toHaveBeenCalled();
});
it('closes when the workspace becomes inactive and never grants shared input from hover', () => {
  const view = render(<SessionCapabilitiesContext.Provider value={sharedSessionCapabilities({ canWrite: false })}><Harness /></SessionCapabilitiesContext.Provider>);
  fireEvent.click(screen.getByRole('button', { name: '查看会话终端' }));
  fireEvent.pointerDown(screen.getByLabelText('terminal'));
  expect(view.container.querySelector('[data-interactive]')?.textContent).toBe('false');
  view.rerender(<SessionCapabilitiesContext.Provider value={sharedSessionCapabilities({ canWrite: false })}><Harness enabled={false} /></SessionCapabilitiesContext.Provider>);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('button', { name: '查看会话终端' })).toBeNull();
});
it('does not offer a preview without an authenticated session view capability', () => {
  render(<SessionCapabilitiesContext.Provider value={new Set()}><Harness /></SessionCapabilitiesContext.Provider>);
  expect(screen.queryByRole('button', { name: '查看会话终端' })).toBeNull();
});
it.each([{ x: 32, y: 650, width: 180, height: 36 }, { x: 1100, y: 40, width: 160, height: 36 }])('keeps the bubble within the viewport beside its trigger: $y', rect => {
  const result = terminalPeekPosition(new DOMRect(rect.x, rect.y, rect.width, rect.height), 1280, 900);
  expect(result.left).toBeGreaterThanOrEqual(12); expect(result.top).toBeGreaterThanOrEqual(12);
  expect(result.left + result.width).toBeLessThanOrEqual(1268);
  expect(result.top + result.height).toBeLessThanOrEqual(888);
});

it('waits 200 ms for hover, cancels a pass-through and opens immediately on an early click', () => {
  vi.useFakeTimers(); render(<Harness />);
  const trigger = screen.getByRole('button', { name: '查看会话终端' });
  fireEvent.pointerEnter(trigger); vi.advanceTimersByTime(199);
  expect(screen.queryByRole('dialog')).toBeNull();
  act(() => vi.advanceTimersByTime(1)); expect(screen.getByRole('dialog')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '关闭终端预览' }));
  fireEvent.pointerEnter(trigger); vi.advanceTimersByTime(100); fireEvent.pointerLeave(trigger);
  vi.advanceTimersByTime(200); expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.pointerEnter(trigger); vi.advanceTimersByTime(100); fireEvent.pointerDown(trigger); fireEvent.click(trigger);
  expect(screen.getByRole('dialog')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '关闭终端预览' }));
  vi.advanceTimersByTime(200); expect(screen.queryByRole('dialog')).toBeNull();
});

it.each([
  { left: 320, top: 48, width: 550, height: 760 },
  { left: 12, top: 0, width: 500, height: 300 },
])('contains the entire preview within explicit visual viewport bounds: $width × $height', bounds => {
  for (const y of [bounds.top + 20, bounds.top + bounds.height / 2, bounds.top + bounds.height - 40]) {
    const result = terminalPeekPosition(new DOMRect(bounds.left + 30, y, 120, 24), 1280, 900, bounds);
    expect(result.left).toBeGreaterThanOrEqual(bounds.left + 12);
    expect(result.top).toBeGreaterThanOrEqual(bounds.top + 12);
    expect(result.left + result.width).toBeLessThanOrEqual(bounds.left + bounds.width - 12);
    expect(result.top + result.height).toBeLessThanOrEqual(bounds.top + bounds.height - 12);
    expect(result.height).toBeLessThanOrEqual(648);
  }
});

it('opens a touch preview without changing modes, survives touch leave and dismisses outside', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerType = 'touch'; });
  const view = render(<Harness />), chat = screen.getByLabelText('chat'); chat.focus();
  const trigger = screen.getByRole('button', { name: '查看会话终端' });
  fireEvent.pointerDown(trigger); fireEvent.click(trigger);
  const panel = screen.getByRole('dialog', { name: '会话终端预览' });
  expect(expand).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(chat);
  expect(view.container.querySelector('[data-interactive]')?.textContent).toBe('false');
  fireEvent.pointerOut(trigger, { relatedTarget: null });
  fireEvent.pointerLeave(trigger, { relatedTarget: null });
  fireEvent.pointerOut(panel, { relatedTarget: null });
  fireEvent.pointerLeave(panel, { relatedTarget: null });
  expect(screen.getByRole('dialog')).toBe(panel);
  fireEvent.pointerDown(chat);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('button', { name: '在完整会话中打开终端' }));
  expect(expand).toHaveBeenCalledOnce();
});

it('uses a more spacious default while respecting manual size preferences and window margins', () => {
  const anchor = new DOMRect(420, 900, 110, 24);
  const wide = terminalPeekPosition(anchor, 1600, 1100);
  expect(wide.width).toBe(1120); expect(wide.height).toBe(648);
  const saved = terminalPeekPosition(anchor, 1600, 1100, undefined, { width: 700, height: 380 });
  expect(saved.width).toBe(700); expect(saved.height).toBe(388);
  const small = terminalPeekPosition(new DOMRect(16, 600, 110, 24), 390, 844);
  expect(small.width).toBe(366);
  expect(small.left + small.width).toBeLessThanOrEqual(378);
  expect(small.top + small.height).toBeLessThanOrEqual(832);
});

it('toggles the same touch or keyboard trigger and reanchors when a different trigger is used', () => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerType = 'touch'; });
  render(<Harness secondary />);
  const trigger = screen.getByRole('button', { name: '查看会话终端' });
  const secondary = screen.getByRole('button', { name: '查看头像终端' });
  const tap = (element: HTMLElement) => { fireEvent.pointerDown(element); fireEvent.click(element, { detail: 1 }); };
  tap(trigger); expect(trigger.getAttribute('aria-expanded')).toBe('true');
  tap(trigger); expect(screen.queryByRole('dialog')).toBeNull();
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  act(() => vi.advanceTimersByTime(250)); expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(trigger, { detail: 0 }); expect(screen.getByRole('dialog')).toBeTruthy();
  fireEvent.click(trigger, { detail: 0 }); expect(screen.queryByRole('dialog')).toBeNull();
  tap(trigger); tap(secondary); expect(screen.getByRole('dialog')).toBeTruthy();
  tap(secondary); expect(screen.queryByRole('dialog')).toBeNull();
  expect(mounted).toHaveBeenCalledOnce(); expect(unmounted).not.toHaveBeenCalled();
  expect(expand).not.toHaveBeenCalled();
});
it('keeps a mouse click open after the hover delay has already revealed the preview', () => {
  vi.useFakeTimers(); render(<Harness />);
  const trigger = screen.getByRole('button', { name: '查看会话终端' });
  fireEvent.pointerEnter(trigger); act(() => vi.advanceTimersByTime(200));
  const panel = screen.getByRole('dialog');
  fireEvent.pointerDown(trigger); fireEvent.click(trigger, { detail: 1 });
  expect(screen.getByRole('dialog')).toBe(panel);
});
