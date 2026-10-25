// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useViewportKeyboardState } from './useViewportKeyboardState';

afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  document.body.replaceChildren(); document.documentElement.removeAttribute('style');
});

it.each([true, false])('honors explicit keyboard dismissal with stale viewport data (controller initialized %s)', initialized => {
  const input = document.createElement('textarea'); document.body.append(input); input.focus();
  const focus = vi.spyOn(input, 'focus');
  vi.stubGlobal('visualViewport', Object.assign(new EventTarget(), { height: 430, width: 390, offsetTop: 0 }));
  document.documentElement.style.setProperty('--app-base-vh', '844px');
  if (initialized) document.documentElement.style.setProperty('--kb-height', '0px');
  const frames = new Map<number, FrameRequestCallback>(); let id = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key));
  const flush = () => act(() => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(performance.now())); });
  const { result } = renderHook(() => useViewportKeyboardState({ enabled: true }));
  flush();
  expect(result.current.isOpen).toBe(!initialized);
  const report = (height: number) => {
    act(() => {
      document.documentElement.style.setProperty('--kb-height', `${height}px`);
      document.dispatchEvent(new CustomEvent('termdock:viewport-keyboard-change'));
    });
    flush();
  };
  report(414); expect(result.current.isOpen).toBe(true);
  report(0); expect(result.current.isOpen).toBe(false);
  expect(result.current.keyboardHeight).toBe(0);
  expect(document.activeElement).toBe(input); expect(focus).not.toHaveBeenCalled();
});
