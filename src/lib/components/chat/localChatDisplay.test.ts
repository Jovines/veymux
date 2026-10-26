// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { chatDisplayCutoff, readChatDisplayCutoff, visibleChatMessages } from './localChatDisplay';
afterEach(() => localStorage.clear());
it('hides loaded and paged older records without changing history, and keeps new same-time messages visible', () => {
  const history = [{ id: 'older', createdAt: 10 }, { id: 'last', createdAt: 20 }];
  const original = structuredClone(history), cutoff = chatDisplayCutoff(history);
  expect(visibleChatMessages(history, cutoff)).toEqual([]);
  const refreshed = [{ id: 'paged', createdAt: 1 }, ...history, { id: 'new-same-time', createdAt: 20 }, { id: 'new', createdAt: 21 }];
  expect(visibleChatMessages(refreshed, cutoff).map(m => m.id)).toEqual(['new-same-time', 'new']);
  expect(history).toEqual(original);
  expect(visibleChatMessages(refreshed, null)).toEqual(refreshed);
});
it('persists the local display boundary per service/session and tolerates invalid storage', () => {
  localStorage.setItem('service-A:session:display-cutoff', JSON.stringify({ at: 20, ids: ['last'] }));
  expect(readChatDisplayCutoff('service-A:session')).toEqual({ at: 20, ids: ['last'] });
  expect(readChatDisplayCutoff('service-B:session')).toBeNull();
  localStorage.setItem('bad:display-cutoff', '{');
  expect(readChatDisplayCutoff('bad')).toBeNull();
  expect(chatDisplayCutoff([])).toBeNull();
});
