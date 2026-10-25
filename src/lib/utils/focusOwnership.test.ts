// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { canRestoreFocus, isFocusTargetAvailable, restoreFocusIfUnclaimed } from './focusOwnership';

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });
it.each(['hidden', 'inert', 'aria-hidden', 'display', 'visibility'])('rejects focus within an unavailable %s ancestor', reason => {
  const root = document.createElement('div'), target = document.createElement('input'); root.append(target); document.body.append(root);
  if (reason === 'display') root.style.display = 'none';
  else if (reason === 'visibility') root.style.visibility = 'hidden';
  else root.setAttribute(reason, reason === 'aria-hidden' ? 'true' : '');
  expect(isFocusTargetAvailable(target)).toBe(false);
});
it('also checks visibility/inert state across a same-origin workspace frame', () => {
  const frame = document.createElement('iframe'); document.body.append(frame);
  const target = frame.contentDocument!.createElement('input'); frame.contentDocument!.body.append(target);
  expect(isFocusTargetAvailable(target)).toBe(true);
  frame.setAttribute('inert', ''); expect(isFocusTargetAvailable(target)).toBe(false);
});
it('never restores focus after a native window blur or over a newer owner', () => {
  const target = document.createElement('input'), next = document.createElement('button'); document.body.append(target, next);
  const focused = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  expect(canRestoreFocus(target)).toBe(false);
  focused.mockReturnValue(true); next.focus();
  expect(canRestoreFocus(target)).toBe(false);
});
it('can restore unclaimed focus without calling focus again for the same editor', () => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  const target = document.createElement('input'); document.body.append(target);
  const focus = vi.spyOn(target, 'focus');
  restoreFocusIfUnclaimed(target); restoreFocusIfUnclaimed(target);
  expect(focus).toHaveBeenCalledTimes(1);
});
