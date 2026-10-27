// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../../i18n';
import type { VeymuxUpdateState } from '../../terminal/api';
import type { DesktopAppUpdateState } from '../../desktop/nativeBridge';
import { VeymuxUpdateSettings } from './VeymuxUpdateSettings';
import { summarizeServiceUpdates } from '../../terminal/serviceUpdateOverview';

const plan = { targetId: 'target', interfaceId: 'entry', nodes: [
  { intent: { url: 'https://target.example', targetPeerId: 'target' }, label: 'Work', role: 'target' as const },
  { intent: { url: 'https://entry.example', targetPeerId: 'entry' }, label: 'Home', role: 'interface' as const },
] };
const current: VeymuxUpdateState = { status: 'current', currentVersion: '1.0.1', latestVersion: '1.0.1', source: 'official', checkedAt: 1, error: null };
const context = (entry: VeymuxUpdateState | undefined, retry = false) => ({
  ...summarizeServiceUpdates(plan, { target: { state: current }, entry: { state: entry } }, false, retry), check: vi.fn(async () => undefined),
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderSettings(state: VeymuxUpdateState, desktopState?: DesktopAppUpdateState) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ locale: 'en' }) })));
  const onCheck = vi.fn();
  const onConfirmRestart = vi.fn();
  const onCheckDesktop = vi.fn();
  const onInstallDesktop = vi.fn();
  render(
    <I18nProvider>
      <VeymuxUpdateSettings
        state={state}
        pending={false}
        onCheck={onCheck}
        onConfirmRestart={onConfirmRestart}
        desktopState={desktopState}
        onCheckDesktop={onCheckDesktop}
        onInstallDesktop={onInstallDesktop}
      />
    </I18nProvider>,
  );
  return { onCheck, onConfirmRestart, onCheckDesktop, onInstallDesktop };
}

describe('VeymuxUpdateSettings', () => {
  it('keeps the combined action available after the target is current so a failed relay update can be retried', () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ locale: 'en' })));
    const restart = vi.fn();
    const props = {
      state: { status: 'current' as const, currentVersion: '1.0.1', latestVersion: null, source: null, checkedAt: null, error: null },
      pending: false, onCheck: vi.fn(), onConfirmRestart: restart,
      updateContext: context({ ...current, status: 'ready', currentVersion: '1.0.0' }, true),
      updateProgress: 'Home relay: restart failed',
    };
    const view = render(<I18nProvider><VeymuxUpdateSettings {...props} /></I18nProvider>);
    expect(screen.getByRole('status').textContent).toContain('restart failed');
    fireEvent.click(screen.getByRole('button', { name: 'Retry update' }));
    expect(restart).toHaveBeenCalledOnce();
    view.rerender(<I18nProvider><VeymuxUpdateSettings {...props} pending updateProgress="Home relay: installing update…" /></I18nProvider>);
    expect(screen.getByRole('status').textContent).toContain('installing');
    expect((screen.getByRole('button', { name: 'Retry update' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it.each([current, undefined])('offers a check instead of a restart when the entry is current or unknown (%j)', entry => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ locale: 'en' })));
    const onCheck = vi.fn(), onConfirmRestart = vi.fn();
    render(<I18nProvider><VeymuxUpdateSettings state={current} pending={false} onCheck={onCheck} onConfirmRestart={onConfirmRestart} updateContext={context(entry)} /></I18nProvider>);
    expect(screen.queryByRole('button', { name: /restart/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(onCheck).toHaveBeenCalledOnce(); expect(onConfirmRestart).not.toHaveBeenCalled();
    expect(screen.getByText('Version details')).toBeTruthy();
  });
  it('does not let the target ready state bypass an unresolved entry status', () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ locale: 'en' })));
    render(<I18nProvider><VeymuxUpdateSettings state={{ ...current, status: 'ready', currentVersion: '1.0.0' }} pending={false} onCheck={vi.fn()} onConfirmRestart={vi.fn()} updateContext={context(undefined)} /></I18nProvider>);
    expect(screen.queryByRole('button', { name: /restart/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeTruthy();
  });
  it('offers an explicit manual update check', () => {
    const actions = renderSettings({
      status: 'current', currentVersion: '1.4.76', latestVersion: '1.4.76',
      source: 'official', checkedAt: Date.now(), error: null,
    });
    expect(screen.getByText('This service is up to date.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(actions.onCheck).toHaveBeenCalledOnce();
    expect(actions.onConfirmRestart).not.toHaveBeenCalled();
  });

  it('requires a separate restart confirmation after installation', () => {
    const actions = renderSettings({
      status: 'ready', currentVersion: '1.4.76', latestVersion: '1.4.77',
      source: 'official', checkedAt: Date.now(), error: null,
    });
    expect(screen.getByText('The update is installed and ready for a confirmed restart.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restart and finish update' }));
    expect(actions.onConfirmRestart).toHaveBeenCalledOnce();
    expect(actions.onCheck).not.toHaveBeenCalled();
  });

  it('keeps installation errors visible in Settings even when the versions match', () => {
    const actions = renderSettings({
      status: 'error', currentVersion: '1.4.322', latestVersion: '1.4.322',
      source: 'official', checkedAt: Date.now(), error: 'Install verification failed.',
    });
    expect(screen.getByText('Install verification failed.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(actions.onCheck).toHaveBeenCalledOnce();
  });

  it('checks the desktop app independently from the CLI runtime', () => {
    const actions = renderSettings(
      {
        status: 'current', currentVersion: '1.4.81', latestVersion: '1.4.81',
        source: 'official', checkedAt: Date.now(), error: null,
      },
      {
        status: 'current', currentVersion: '1.4.80', latestVersion: null,
        releaseName: null, checkedAt: Date.now(), error: null,
      },
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Check again' })[1]);
    expect(actions.onCheckDesktop).toHaveBeenCalledOnce();
    expect(actions.onCheck).not.toHaveBeenCalled();
  });

  it('offers restart and install after the desktop download finishes', () => {
    const actions = renderSettings(
      {
        status: 'current', currentVersion: '1.4.81', latestVersion: '1.4.81',
        source: 'official', checkedAt: Date.now(), error: null,
      },
      {
        status: 'ready', currentVersion: '1.4.80', latestVersion: '1.4.81',
        releaseName: 'v1.4.81', checkedAt: Date.now(), error: null,
      },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Restart and install' }));
    expect(actions.onInstallDesktop).toHaveBeenCalledOnce();
  });
});
