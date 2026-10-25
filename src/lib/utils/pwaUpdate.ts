import { useSyncExternalStore } from 'react';

const SW_UPDATE_CHECK_INTERVAL_MS = 5 * 60_000;
let waitingRegistration: ServiceWorkerRegistration | undefined;
let updateAvailable = false;
let accepted = false;
let initialized = false;
const listeners = new Set<() => void>();

/** Flush every retained workspace, not just the iframe initiating the update. */
export function flushApplicationDrafts(view: Window = window): void {
  const event = view.document.createEvent('Event');
  event.initEvent('termdock:before-update', false, false);
  view.dispatchEvent(event);
  for (const frame of view.document.querySelectorAll('iframe[data-workspace-key]')) {
    const child = (frame as HTMLIFrameElement).contentWindow;
    if (child) flushApplicationDrafts(child);
  }
}

/** A service restart does not activate a waiting PWA worker. Fetch the new
 * manifest, await installation, activate it, then reload the whole application. */
export async function reloadApplicationAfterServiceUpdate(): Promise<void> {
  const view = window.top && window.top.location.origin === location.origin ? window.top : window;
  flushApplicationDrafts(view);
  const workers = view.navigator.serviceWorker;
  const registration = await workers?.getRegistration('/');
  if (registration) {
    await registration.update();
    const installing = registration.installing;
    if (installing && installing.state !== 'installed' && installing.state !== 'activated') {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); installing.removeEventListener('statechange', changed); };
        const changed = () => {
          if (installing.state === 'installed' || installing.state === 'activated') { cleanup(); resolve(); }
          else if (installing.state === 'redundant') { cleanup(); reject(new Error('Interface update installation failed')); }
        };
        const timer = setTimeout(() => { cleanup(); reject(new Error('Interface update installation timed out')); }, 60_000);
        installing.addEventListener('statechange', changed); changed();
      });
    }
    const waiting = registration.waiting;
    if (waiting) {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); workers.removeEventListener('controllerchange', changed); };
        const changed = () => { cleanup(); resolve(); };
        const timer = setTimeout(() => { cleanup(); reject(new Error('Interface update activation timed out')); }, 30_000);
        workers.addEventListener('controllerchange', changed);
        waiting.postMessage({ type: 'SKIP_WAITING' });
      });
    }
  }
  // Changes made while installation was finishing must also survive the reload.
  flushApplicationDrafts(view);
  view.location.reload();
}
function notifyUpdate(): void {
  updateAvailable = true;
  listeners.forEach((listener) => listener());
}
export function usePwaUpdateAvailable(): boolean {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, () => updateAvailable, () => false);
}

export function applyPwaUpdate(): void {
  // Synchronous draft flush hooks run before activation or a manual reload.
  window.dispatchEvent(new Event('termdock:before-update'));
  accepted = true;
  if (waitingRegistration?.waiting) {
    waitingRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
  } else window.location.reload();
}

export function createControllerChangeHandler(
  controlledAtStartup: boolean,
  onUpdate: () => void,
): () => void {
  let hasSeenController = controlledAtStartup;
  return () => {
    if (!hasSeenController) { hasSeenController = true; return; }
    onUpdate();
  };
}

export function setupPwaUpdateReload(): void {
  if (initialized || typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  initialized = true;
  navigator.serviceWorker.addEventListener('controllerchange', createControllerChangeHandler(
    Boolean(navigator.serviceWorker.controller),
    () => { if (accepted) window.location.reload(); else notifyUpdate(); },
  ));

  const register = () => {
    void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((registration) => {
        waitingRegistration = registration;
        const inspect = () => { if (registration.waiting) notifyUpdate(); };
        const watch = () => {
          const worker = registration.installing;
          worker?.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) inspect();
          });
        };
        registration.addEventListener('updatefound', watch);
        watch();
        inspect();
        let lastCheck = 0;
        const check = () => {
          if (document.visibilityState !== 'visible' || Date.now() - lastCheck < SW_UPDATE_CHECK_INTERVAL_MS) return;
          lastCheck = Date.now();
          void registration.update().then(inspect).catch(() => undefined);
        };
        check();
        window.setInterval(check, SW_UPDATE_CHECK_INTERVAL_MS);
        document.addEventListener('visibilitychange', check);
      }).catch(() => undefined);
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
