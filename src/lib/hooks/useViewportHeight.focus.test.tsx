// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useViewportHeight } from './useViewportHeight';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); document.documentElement.removeAttribute('style'); });
it.each(['Macintosh', 'iPhone'])('does not end native text input when viewport state resets on %s', agent => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(agent);
  vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', () => {});
  let hidden = false;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => hidden ? 'hidden' : 'visible');
  const input = document.createElement('textarea'); document.body.append(input); input.focus();
  const blur = vi.spyOn(input, 'blur');
  renderHook(() => useViewportHeight());
  act(() => { hidden = true; document.dispatchEvent(new Event('visibilitychange')); });
  expect(blur).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(input);
  act(() => window.dispatchEvent(new Event('pagehide')));
  expect(blur).not.toHaveBeenCalled();
});
