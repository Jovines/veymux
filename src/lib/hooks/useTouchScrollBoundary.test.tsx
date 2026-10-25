// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useTouchScrollBoundary } from './useTouchScrollBoundary';

afterEach(() => { cleanup(); window.getSelection()?.removeAllRanges(); document.body.replaceChildren(); });
function setup(enabled = true) {
  const root = document.createElement('div'), input = document.createElement('textarea');
  root.append(input); document.body.append(root); input.style.overflowY = 'auto';
  Object.defineProperties(input, { clientHeight: { value: 100 }, scrollHeight: { value: 400 } });
  const hook = renderHook(() => useTouchScrollBoundary({ current: root }, enabled));
  const touch = (type: string, x: number, y: number, count = 1) => {
    const event = new TouchEvent(type, { bubbles: true, cancelable: true, touches: Array.from({ length: count }, (_, identifier) => ({ identifier, clientX: x, clientY: y }) as Touch) });
    input.dispatchEvent(event); return event;
  };
  return { root, input, touch, ...hook };
}

it('blocks only outward vertical drags at each textarea edge', () => {
  const { input, touch } = setup();
  expect(touch('touchstart', 50, 100).defaultPrevented).toBe(false);
  expect(touch('touchmove', 50, 130).defaultPrevented).toBe(true);
  touch('touchend', 50, 130, 0);
  input.scrollTop = 300;
  touch('touchstart', 50, 100);
  expect(touch('touchmove', 50, 70).defaultPrevented).toBe(true);
  touch('touchcancel', 50, 70, 0);
  input.scrollTop = 100;
  touch('touchstart', 50, 100);
  expect(touch('touchmove', 50, 70).defaultPrevented).toBe(false);
  expect(touch('touchmove', 50, 110).defaultPrevented).toBe(false);
});

it('preserves taps, small movements, horizontal selection gestures and multi-touch', () => {
  const { touch } = setup();
  expect(touch('touchstart', 50, 100).defaultPrevented).toBe(false);
  expect(touch('touchmove', 52, 102).defaultPrevented).toBe(false);
  expect(touch('touchmove', 100, 105).defaultPrevented).toBe(false);
  expect(touch('touchmove', 100, 120, 2).defaultPrevented).toBe(false);
  expect(touch('touchmove', 100, 150).defaultPrevented).toBe(false);
});

it('leaves live text selection drags to the browser before a parent pager can cancel them', () => {
  const { root, touch } = setup();
  const paragraph = document.createElement('p'); paragraph.textContent = '选中文字后拖动选区'; root.append(paragraph);
  touch('touchstart', 50, 100);
  const range = document.createRange(); range.selectNodeContents(paragraph); window.getSelection()!.addRange(range);
  let reachedParent = false;
  const parent = () => { reachedParent = true; };
  document.addEventListener('touchmove', parent);
  try {
    expect(touch('touchmove', 50, 140).defaultPrevented).toBe(false);
    expect(reachedParent).toBe(false);
  } finally { document.removeEventListener('touchmove', parent); }
  window.getSelection()!.removeAllRanges();
  touch('touchend', 50, 140, 0); touch('touchstart', 50, 100);
  expect(touch('touchmove', 50, 140).defaultPrevented).toBe(true);
});

it.each([false, true])('does not leave handlers on inactive or unmounted panels (enabled=%s)', enabled => {
  const { touch, unmount } = setup(enabled);
  unmount(); touch('touchstart', 50, 100);
  expect(touch('touchmove', 50, 130).defaultPrevented).toBe(false);
});
