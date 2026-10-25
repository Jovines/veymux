// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useTerminalSettings } from './useTerminalSettings';
import { useNewSessionDefaults } from './useNewSessionDefaults';
import { TERMINAL_SETTINGS_STORAGE_KEY } from '../terminal/settings';

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });
it('preserves other settings owners on mount, typography edits, reset and reload', () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  const sibling = { newSessionMode: 'shell', newSessionModeUserSelected: true, newSessionTmuxName: 'chosen', futurePreference: { enabled: true } };
  localStorage.setItem(TERMINAL_SETTINGS_STORAGE_KEY, JSON.stringify(sibling));
  const { result, unmount } = renderHook(() => ({ typography: useTerminalSettings(), defaults: useNewSessionDefaults() }));
  const stored = () => JSON.parse(localStorage.getItem(TERMINAL_SETTINGS_STORAGE_KEY)!);
  expect(stored()).toMatchObject(sibling);
  act(() => result.current.typography.updateTerminalSettings({ fontSize: 22 }));
  expect(stored()).toMatchObject({ ...sibling, fontSize: 22 });
  act(() => result.current.defaults.setNewSessionMode('tmux'));
  act(() => result.current.typography.resetTerminalSettings());
  expect(stored()).toMatchObject({ ...sibling, newSessionMode: 'tmux' });
  unmount();
  const reload = renderHook(() => useNewSessionDefaults());
  expect(reload.result.current.userSelectedNewSessionMode).toBe('tmux');
});
