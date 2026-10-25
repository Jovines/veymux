// @vitest-environment jsdom
import { useRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useTerminalPeekIdleClose } from './useTerminalPeekIdleClose';
const close = vi.fn();
function Harness({ enabled = true }: { enabled?: boolean }) {
  const panel = useRef<HTMLDivElement>(null), seconds = useTerminalPeekIdleClose(panel, enabled, close);
  return <div ref={panel}><output>{seconds}</output><input aria-label="终端输入" /></div>;
}
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
it('counts down by seconds and expires only at three seconds', () => {
  render(<Harness />); expect(screen.getByRole('status').textContent).toBe('3');
  advance(1000); expect(screen.getByRole('status').textContent).toBe('2');
  advance(1999); expect(close).not.toHaveBeenCalled();
  advance(1); expect(close).toHaveBeenCalledOnce();
});
it('hides the countdown after interaction and keeps the preview open until dismissed', () => {
  const view = render(<Harness />); advance(2000);
  fireEvent.pointerDown(screen.getByLabelText('终端输入'));
  fireEvent.pointerUp(document);
  expect(screen.getByRole('status').textContent).toBe('');
  advance(10000); expect(close).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  view.rerender(<Harness enabled={false} />); view.rerender(<Harness />);
  expect(screen.getByRole('status').textContent).toBe('3');
  advance(3000); expect(close).toHaveBeenCalledOnce();
});
it.each(['touchMove', 'wheel', 'keyDown', 'input', 'focusIn', 'compositionStart'] as const)('hides after %s without rearming the timer', event => {
  render(<Harness />); advance(2000);
  fireEvent[event](screen.getByLabelText('终端输入'));
  expect(screen.getByRole('status').textContent).toBe('');
  advance(10000); expect(close).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});
it('does not mistake output-driven scrolling for a user operation', () => {
  render(<Harness />); advance(2000); fireEvent.scroll(screen.getByLabelText('终端输入'));
  expect(screen.getByRole('status').textContent).toBe('1'); advance(1000); expect(close).toHaveBeenCalledOnce();
});
it('stays open after a long press, resize or IME composition finishes', () => {
  render(<Harness />); const input = screen.getByLabelText('终端输入');
  fireEvent.pointerDown(input); advance(6000); fireEvent.pointerUp(document);
  fireEvent.compositionStart(input); advance(6000); fireEvent.compositionEnd(input);
  advance(10000); expect(close).not.toHaveBeenCalled(); expect(screen.getByRole('status').textContent).toBe('');
});
it('cleans up on close/unmount and starts a full new countdown on reopening', () => {
  const view = render(<Harness />); advance(2000); view.rerender(<Harness enabled={false} />);
  expect(screen.getByRole('status').textContent).toBe(''); advance(8000); expect(close).not.toHaveBeenCalled();
  view.rerender(<Harness />); expect(screen.getByRole('status').textContent).toBe('3');
  advance(2999); expect(close).not.toHaveBeenCalled(); view.unmount();
  advance(5000); expect(close).not.toHaveBeenCalled();
});
it('does not schedule auto-close for desktop previews', () => {
  render(<Harness enabled={false} />); advance(20000); expect(close).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});
