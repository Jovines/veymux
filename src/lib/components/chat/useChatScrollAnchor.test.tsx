// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { useChatScrollAnchor } from './useChatScrollAnchor';
afterEach(() => { cleanup(); document.body.replaceChildren(); });
it('compensates above the visible block against live scrolling, ignoring changes below it', () => {
  const root = document.createElement('div'); document.body.append(root);
  root.innerHTML = '<div data-chat-viewport-row="old"><p>Old</p></div><div data-chat-viewport-row="reading"><p>Reading</p></div>';
  Object.defineProperty(root, 'clientHeight', { value: 500 });
  root.getBoundingClientRect = () => ({ top: 20, bottom: 520 } as DOMRect);
  let inserted = 0;
  for (const [index, row] of [...root.children].entries()) {
    const rect = () => ({ top: index * 100 + inserted - root.scrollTop + 20, bottom: (index + 1) * 100 + inserted - root.scrollTop + 20, height: 100 } as DOMRect);
    (row as HTMLElement).getBoundingClientRect = rect;
    row.firstElementChild!.getBoundingClientRect = rect;
  }
  root.scrollTop = 120;
  const { result } = renderHook(() => useChatScrollAnchor({ current: root }));
  result.current.capture();
  // A new scroll while the network request is pending must become the anchor.
  root.scrollTop = 145; result.current.capture();
  inserted = 320; result.current.restore();
  expect(root.scrollTop).toBe(465);
  result.current.capture(); result.current.restore();
  expect(root.scrollTop).toBe(465);
  // Removing an anchor (e.g. navigating to a different page) cannot restore a
  // stale absolute scroll offset into the new page.
  root.replaceChildren(); root.scrollTop = 50; result.current.restore();
  expect(root.scrollTop).toBe(50);
});
