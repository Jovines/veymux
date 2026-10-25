// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StrictMode, type ReactNode } from 'react';
import { useTerminalStore } from '../../stores/useTerminalStore';
import { useChatTerminalInputCheck } from './useChatTerminalInputCheck';
beforeEach(() => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  useTerminalStore.getState().setTerminalSession('probe', { sessionId: 'backend', cols: 80, rows: 24 });
});
afterEach(() => { cleanup(); useTerminalStore.getState().clearAllTerminalSessions(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('probes only an observed foreground output-to-idle edge, once per cycle, and exposes an uncertain result', async () => {
  const fetch = vi.fn(async () => Response.json({ status: 'unconfirmed' })); vi.stubGlobal('fetch', fetch);
  const view = renderHook(({ phase }: { phase: string | null }) => useChatTerminalInputCheck('probe', phase, true), { initialProps: { phase: 'sending' as string | null } });
  expect(fetch).not.toHaveBeenCalled();
  view.rerender({ phase: 'sending' }); view.rerender({ phase: null }); expect(fetch).not.toHaveBeenCalled();
  view.rerender({ phase: 'output' }); view.rerender({ phase: null });
  await waitFor(() => expect(view.result.current).toBe(true));
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0]).toMatchObject(['/api/terminal/probe/input-check', { method: 'POST', body: JSON.stringify({ backendSessionId: 'backend' }) }]);
  view.rerender({ phase: null }); expect(fetch).toHaveBeenCalledOnce();
  view.rerender({ phase: 'output' }); expect(view.result.current).toBe(false);
  view.rerender({ phase: null }); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
});
it('does not probe a hidden, unfocused, read-only or already open terminal view', () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const view = renderHook(({ phase, enabled }) => useChatTerminalInputCheck('probe', phase, enabled), { initialProps: { phase: 'output' as string | null, enabled: false } });
  view.rerender({ phase: null, enabled: false });
  vi.mocked(document.hasFocus).mockReturnValue(false);
  view.rerender({ phase: 'output', enabled: true }); view.rerender({ phase: null, enabled: true });
  vi.mocked(document.hasFocus).mockReturnValue(true);
  const trigger = document.createElement('button'); trigger.setAttribute('data-terminal-peek-trigger', ''); trigger.setAttribute('aria-expanded', 'true'); document.body.append(trigger);
  view.rerender({ phase: 'output', enabled: true }); view.rerender({ phase: null, enabled: true }); trigger.remove();
  expect(fetch).not.toHaveBeenCalled();
});
it('discards a late diagnostic result after leaving the conversation or replacing its runtime', async () => {
  let resolve!: (response: Response) => void;
  const fetch = vi.fn(() => new Promise<Response>(done => { resolve = done; })); vi.stubGlobal('fetch', fetch);
  const view = renderHook(({ phase, enabled }) => useChatTerminalInputCheck('probe', phase, enabled), { initialProps: { phase: 'output' as string | null, enabled: true } });
  view.rerender({ phase: null, enabled: true });
  await act(async () => {});
  act(() => useTerminalStore.getState().setTerminalSession('probe', { sessionId: 'replacement', cols: 80, rows: 24 }));
  await act(async () => resolve(Response.json({ status: 'unconfirmed' })));
  expect(view.result.current).toBe(false);
  view.rerender({ phase: 'output', enabled: true }); view.rerender({ phase: null, enabled: true });
  await act(async () => {});
  view.rerender({ phase: null, enabled: false });
  await act(async () => resolve(Response.json({ status: 'unconfirmed' })));
  expect(view.result.current).toBe(false);
});
it('checks an idle entry and each return to a retained conversation once with a new entry identity', async () => {
  const fetch = vi.fn(async () => Response.json({ status: 'ready' })); vi.stubGlobal('fetch', fetch);
  const view = renderHook(({ active }) => useChatTerminalInputCheck('probe', null, true, active), { initialProps: { active: true } });
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  const first = JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[0][1]?.body));
  expect(first).toMatchObject({ backendSessionId: 'backend', entryId: expect.any(String) });
  view.rerender({ active: true }); expect(fetch).toHaveBeenCalledOnce();
  view.rerender({ active: false }); view.rerender({ active: true });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  const second = JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[1][1]?.body));
  expect(second.entryId).not.toBe(first.entryId);
});
it('waits for eligibility and a backend while preserving the entry, without treating send eligibility as a new visit', async () => {
  const fetch = vi.fn(async () => Response.json({ status: 'ready' })); vi.stubGlobal('fetch', fetch);
  const view = renderHook(({ enabled }) => useChatTerminalInputCheck('late-backend', null, enabled, true), { initialProps: { enabled: false } });
  view.rerender({ enabled: true }); await act(async () => {}); expect(fetch).not.toHaveBeenCalled();
  act(() => useTerminalStore.getState().setTerminalSession('late-backend', { sessionId: 'arrived', cols: 80, rows: 24 }));
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  view.rerender({ enabled: false }); view.rerender({ enabled: true });
  await act(async () => {}); expect(fetch).toHaveBeenCalledOnce();
});
it('checks the newly selected idle session when a mounted view changes session identity', async () => {
  const fetch = vi.fn(async () => Response.json({ status: 'ready' })); vi.stubGlobal('fetch', fetch);
  useTerminalStore.getState().setTerminalSession('other', { sessionId: 'other-backend', cols: 80, rows: 24 });
  const view = renderHook(({ id }) => useChatTerminalInputCheck(id, null, true, true), { initialProps: { id: 'probe' } });
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce()); view.rerender({ id: 'other' });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(vi.mocked(globalThis.fetch).mock.calls[1]).toMatchObject(['/api/terminal/other/input-check', { body: expect.stringContaining('other-backend') }]);
});
it('does not swallow or duplicate an idle entry when StrictMode replays mount effects', async () => {
  const fetch = vi.fn(async () => Response.json({ status: 'ready' })); vi.stubGlobal('fetch', fetch);
  renderHook(() => useChatTerminalInputCheck('probe', null, true, true), { wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode> });
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
});
it('does not let the previous session terminal preview swallow a new idle selection', async () => {
  const fetch = vi.fn(async () => Response.json({ status: 'ready' })); vi.stubGlobal('fetch', fetch);
  const old = document.createElement('div'); old.setAttribute('data-session-workspace', 'previous');
  old.innerHTML = '<button data-terminal-peek-trigger aria-expanded="true"></button>'; document.body.append(old);
  try {
    renderHook(() => useChatTerminalInputCheck('probe', null, true, true));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  } finally { old.remove(); }
});
it('skips a hidden page and makes no plaintext fallback or retry after a network failure', async () => {
  const fetch = vi.fn().mockRejectedValue(new TypeError('connection lost')); vi.stubGlobal('fetch', fetch);
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  const view = renderHook(({ phase }) => useChatTerminalInputCheck('probe', phase, true), { initialProps: { phase: 'output' as string | null } });
  view.rerender({ phase: null }); expect(fetch).not.toHaveBeenCalled();
  visibility.mockReturnValue('visible');
  view.rerender({ phase: 'output' }); view.rerender({ phase: null });
  await waitFor(() => expect(view.result.current).toBe(true));
  view.rerender({ phase: null }); expect(fetch).toHaveBeenCalledOnce();
});
