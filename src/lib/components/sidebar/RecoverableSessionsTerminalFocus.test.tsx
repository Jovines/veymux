// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../../terminal/factory', () => ({ createTermdockAPI: () => ({}) }));
vi.mock('../terminal/TerminalViewport', () => ({
  TerminalViewport: React.forwardRef(function Viewport(_props, ref) {
    const input = React.useRef<HTMLTextAreaElement>(null);
    React.useImperativeHandle(ref, () => ({
      focus: () => input.current?.focus(), blur: () => input.current?.blur(),
      requestRefresh() {}, ensureSizeMatches() {}, serializeSnapshot: () => null,
    }));
    return <textarea ref={input} data-terminal-input-anchor="true" aria-label="Terminal input" />;
  }),
}));
import { I18nProvider } from '../../i18n';
import { isKeyboardLayerOpen } from '../../hooks/useKeyboardLayer';
import { TerminalView } from '../views/TerminalView';
import { RecoverableSessions } from './RecoverableSessions';

beforeEach(() => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ locale: 'en' }) })));
  vi.stubGlobal('matchMedia', vi.fn((media: string) => ({ media, matches: false, addEventListener() {}, removeEventListener() {} })));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('keeps the recovery panel open when the real desktop TerminalView handles pointerup', async () => {
  const user = userEvent.setup(), onRestore = vi.fn();
  render(<I18nProvider>
    <RecoverableSessions sessions={[{ name: 'wt-profile', friendlyName: 'profile', windows: 1, attached: 0 }]}
      loading={false} attachingName={null} onRestore={onRestore} />
    <TerminalView sessionId="recovery-focus" initialConnectEnabled={false} />
  </I18nProvider>);
  const input = screen.getByRole('textbox', { name: 'Terminal input' });
  act(() => input.focus());
  const trigger = screen.getByRole('button', { name: 'Recoverable sessions' });
  act(() => trigger.focus());
  // The native pointerup and click run before TerminalView's deferred focus.
  fireEvent.pointerUp(trigger);
  fireEvent.click(trigger);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(screen.getByRole('dialog', { name: 'Recoverable sessions' })).toBeTruthy();
  expect(isKeyboardLayerOpen()).toBe(true);
  expect(document.activeElement).not.toBe(input);
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(isKeyboardLayerOpen()).toBe(false);
  // Closing returns pointer interactions to the active terminal.
  await user.click(input);
  await waitFor(() => expect(document.activeElement).toBe(input));
  await user.click(trigger);
  await user.click(screen.getByRole('button', { name: 'Restore profile' }));
  expect(onRestore).toHaveBeenCalledOnce();
  // The parent changes inventory after attachment; invoking its callback alone
  // keeps the panel available while that operation is pending.
  expect(screen.getByRole('dialog')).toBeTruthy();
});
