// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { dismissPwaNotificationsForSession } from './pwaNotifications';

const worker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
const badge = Object.getOwnPropertyDescriptor(navigator, 'setAppBadge');
afterEach(() => {
  if (worker) Object.defineProperty(navigator, 'serviceWorker', worker); else Reflect.deleteProperty(navigator, 'serviceWorker');
  if (badge) Object.defineProperty(navigator, 'setAppBadge', badge); else Reflect.deleteProperty(navigator, 'setAppBadge');
  vi.restoreAllMocks();
});
it('dismisses every notification kind for the opened session and preserves other sessions', async () => {
  const notifications = ['agent:one', 'exit:one', 'agent:two'].map(tag => ({ tag, close: vi.fn() }));
  const remaining = () => notifications.filter(notification => !notification.close.mock.calls.length);
  const getNotifications = vi.fn(async (filter?: { tag?: string }) => remaining().filter(notification => !filter?.tag || filter.tag === notification.tag));
  const setAppBadge = vi.fn();
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration: async () => ({ active: {}, getNotifications }) } });
  Object.defineProperty(navigator, 'setAppBadge', { configurable: true, value: setAppBadge });
  await dismissPwaNotificationsForSession('one');
  expect(notifications[0].close).toHaveBeenCalledOnce();
  expect(notifications[1].close).toHaveBeenCalledOnce();
  expect(notifications[2].close).not.toHaveBeenCalled();
  expect(setAppBadge).toHaveBeenCalledWith(1);
});
