// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { showPwaNotification } from './pwaNotifications';
import type { VeymuxDesktopBridge } from '../desktop/nativeBridge';

describe('showPwaNotification foreground suppression', () => {
  const showNotification = vi.fn(async () => true);

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.localStorage.setItem('veymux-pwa-notifications-enabled', 'true');
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    window.veymuxDesktop = {
      platform: 'darwin',
      notificationDeliveryConfirmation: true,
      showNotification,
    } as unknown as VeymuxDesktopBridge;
  });

  it('does not send an automatic native notification while Veymux is focused', async () => {
    const handled = await showPwaNotification({
      title: 'Agent finished',
      body: 'Done',
      tag: 'agent:session-1',
    });

    expect(handled).toBe(true);
    expect(showNotification).not.toHaveBeenCalled();
  });

  it('keeps the explicit foreground override for the manual settings test', async () => {
    const delivered = await showPwaNotification({
      title: 'Veymux',
      body: 'Test notification',
      tag: 'veymux-notification-test',
      requireHidden: false,
    });

    expect(delivered).toBe(true);
    expect(showNotification).toHaveBeenCalledOnce();
  });
});
