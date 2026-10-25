// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('../../terminal/factory', () => ({ createTermdockAPI: () => ({}) }));
const viewport = vi.hoisted(() => ({ focus: vi.fn(), refresh: vi.fn() }));
vi.mock('../terminal/TerminalViewport', () => ({
  TerminalViewport: React.forwardRef(function Viewport(_props, ref) {
    const input = React.useRef<HTMLTextAreaElement>(null);
    React.useImperativeHandle(ref, () => ({
      focus: () => { viewport.focus(); input.current?.focus(); },
      blur: () => input.current?.blur(), requestRefresh: viewport.refresh,
      serializeSnapshot: () => null,
    }));
    return <textarea ref={input} data-terminal-input-anchor="true" aria-label="终端输入" />;
  }),
}));
import { TerminalView } from './TerminalView';

beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers();
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.stubGlobal('matchMedia', vi.fn((media: string) => ({ media, matches: false, addEventListener() {}, removeEventListener() {} })));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function mount() {
  return render(<><button>普通工具按钮</button><input aria-label="搜索" /><TerminalView sessionId="focus-audit" initialConnectEnabled={false} /></>);
}

it('does not reclaim terminal focus after a pointer gesture elsewhere in the page', () => {
  mount();
  const button = screen.getByRole('button', { name: '普通工具按钮' });
  button.focus(); fireEvent.pointerUp(button);
  act(() => vi.advanceTimersByTime(100));
  expect(document.activeElement).toBe(button);
  expect(viewport.focus).not.toHaveBeenCalled();
});
it('never echoes native window focus back into an already focused terminal input', () => {
  mount(); screen.getByLabelText('终端输入').focus();
  fireEvent.focus(window);
  act(() => vi.advanceTimersByTime(60));
  expect(viewport.refresh).toHaveBeenCalled();
  expect(viewport.focus).not.toHaveBeenCalled();
});
it('cancels passive focus restoration when the window loses focus before the timer fires', () => {
  mount(); fireEvent.focus(window);
  vi.mocked(document.hasFocus).mockReturnValue(false);
  fireEvent.blur(window);
  act(() => vi.advanceTimersByTime(60));
  expect(viewport.focus).not.toHaveBeenCalled();
});
it('keeps a newer button or editor choice made during window restoration', () => {
  mount();
  for (const control of [screen.getByRole('button', { name: '普通工具按钮' }), screen.getByLabelText('搜索')]) {
    fireEvent.focus(window); control.focus();
    act(() => vi.advanceTimersByTime(60));
    expect(document.activeElement).toBe(control);
  }
  expect(viewport.focus).not.toHaveBeenCalled();
});
