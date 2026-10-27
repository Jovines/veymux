// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushApplicationDrafts, reloadApplicationAfterServiceUpdate } from './pwaUpdate';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
describe('reload after coordinated service update', () => {
  it('flushes drafts in all retained workspaces before replacing the application shell', () => {
    const rootFlush = vi.fn(); window.addEventListener('veymux:before-update', rootFlush);
    const frame = document.createElement('iframe'); frame.dataset.workspaceKey = 'other'; document.body.append(frame);
    const childFlush = vi.fn(); frame.contentWindow!.addEventListener('veymux:before-update', childFlush);
    flushApplicationDrafts();
    expect(rootFlush).toHaveBeenCalledOnce(); expect(childFlush).toHaveBeenCalledOnce();
    window.removeEventListener('veymux:before-update', rootFlush);
  });
  it.each([false, true])('updates and activates a waiting worker even when controller-at-start is %s', async controlled => {
    const workers = new EventTarget();
    const waiting = { postMessage: vi.fn(() => workers.dispatchEvent(new Event('controllerchange'))) };
    const registration = { update: vi.fn(async () => {}), waiting, installing: undefined };
    Object.assign(workers, { controller: controlled ? {} : null, getRegistration: vi.fn(async () => registration) });
    vi.stubGlobal('navigator', { serviceWorker: workers });
    const flush = vi.fn(); window.addEventListener('veymux:before-update', flush);
    // jsdom reports navigation as unimplemented; completion here still proves
    // the real activation protocol and draft flush sequence before navigation.
    await reloadApplicationAfterServiceUpdate();
    expect(registration.update).toHaveBeenCalledOnce(); expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(flush).toHaveBeenCalledTimes(2);
    expect(flush.mock.invocationCallOrder[0]).toBeLessThan(waiting.postMessage.mock.invocationCallOrder[0]);
    window.removeEventListener('veymux:before-update', flush);
  });
  it('does not treat failed resource installation as a completed interface update', async () => {
    const installing = Object.assign(new EventTarget(), { state: 'installing' });
    const registration = { update: vi.fn(async () => {}), installing, waiting: null };
    const getRegistration = vi.fn(async () => registration);
    vi.stubGlobal('navigator', { serviceWorker: { getRegistration } });
    const pending = reloadApplicationAfterServiceUpdate();
    await vi.waitFor(() => expect(registration.update).toHaveBeenCalled());
    installing.state = 'redundant'; installing.dispatchEvent(new Event('statechange'));
    await expect(pending).rejects.toThrow('installation failed');
  });
});
