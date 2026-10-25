import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import '../../../index.css';
import { ServiceWorkspaceHost } from '../../services/ServiceWorkspaceHost';
import { installWorkspaceHost } from '../../services/workspaceHost';

let root: Root | undefined;
afterEach(async () => {
  root?.unmount(); root = undefined;
  vi.restoreAllMocks();
  document.body.replaceChildren();
  document.body.removeAttribute('style');
  document.documentElement.removeAttribute('style');
  delete document.documentElement.dataset.termdockNativeKeyboard;
  delete document.documentElement.dataset.termdockTouchViewport;
  delete document.documentElement.dataset.termdockIpadPwa;
  delete window.__termdockWorkspaceHost;
  localStorage.clear(); sessionStorage.clear();
  await page.viewport(390, 844);
});

it.each([
  { mode: 'iPhone PWA', native: true, width: 390, height: 844, top: 47, bottom: 34, ipad: false },
  { mode: 'iPad PWA', native: true, width: 820, height: 1180, top: 0, bottom: 20, ipad: true },
  { mode: 'landscape iPhone', native: true, width: 844, height: 390, top: 0, bottom: 0, ipad: false },
  { mode: 'Android', native: false, width: 390, height: 844, top: 24, bottom: 24, ipad: false },
  { mode: 'desktop', native: false, width: 1280, height: 900, top: 0, bottom: 0, ipad: false },
])('keeps retained $mode workspaces at the physical viewport origin', async ({ native, width, height, top, bottom, ipad }) => {
  await page.viewport(width, height);
  // Vitest itself runs inside a frame. Make this document the application
  // entry, while keeping the retained workspace a real nested browser frame.
  vi.spyOn(window, 'parent', 'get').mockReturnValue(window);
  const html = document.documentElement;
  html.dataset.termdockNativeKeyboard = String(native);
  html.dataset.termdockTouchViewport = String(width <= 820);
  html.dataset.termdockIpadPwa = String(ipad);
  html.style.setProperty('--safe-top-inset', `${top}px`);
  html.style.setProperty('--safe-bottom-inset', `${bottom}px`);
  html.style.setProperty('--app-base-vh', `${height}px`);
  html.style.setProperty('--app-vh', `${height}px`);

  // No authentication or business traffic: only replace the frame document,
  // retaining the production host, positioning rules and safe-area CSS.
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag, options) => {
    const element = createElement(tag, options);
    if (element instanceof HTMLIFrameElement) element.srcdoc = '<!doctype html><html><head></head><body></body></html>';
    return element;
  });
  const entry = { id: 'entry', targetPeerId: 'entry', url: 'https://entry.example', label: 'Entry' };
  const remote = { id: 'remote', targetPeerId: 'remote', url: 'https://remote.example', label: 'Remote' };
  const host = installWorkspaceHost(entry)!;
  host.report('root', { rendered: true, phase: 'ready' });
  const container = createElement('div'); container.id = 'root'; document.body.append(container);
  root = createRoot(container);
  flushSync(() => root!.render(<ServiceWorkspaceHost><div>Entry terminal</div></ServiceWorkspaceHost>));
  flushSync(() => { host.activate(remote); });
  const frame = document.querySelector<HTMLIFrameElement>('iframe[data-workspace-key]')!;
  await expect.poll(() => frame.contentDocument?.readyState).toBe('complete');
  const child = frame.contentDocument!;
  const css = child.createElement('style');
  css.textContent = Array.from(document.styleSheets).flatMap(sheet => Array.from(sheet.cssRules, rule => rule.cssText)).join('\n');
  child.head.append(css);
  child.documentElement.dataset.termdockNativeKeyboard = String(native);
  child.documentElement.dataset.termdockTouchViewport = String(width <= 820);
  child.documentElement.dataset.termdockIpadPwa = String(ipad);
  child.documentElement.style.cssText = html.style.cssText;
  child.body.innerHTML = '<div id="root"><div class="flex h-full flex-col"><header class="h-11 shrink-0">Terminal</header><main class="min-h-0 flex-1">Terminal content</main><footer class="h-14 shrink-0">Input</footer></div></div><aside class="fixed inset-y-0" style="padding-top:var(--safe-top-inset);padding-bottom:var(--safe-bottom-inset)"><header>Sessions</header></aside>';
  const assertGeometry = (pan = 0) => {
    const bounds = frame.getBoundingClientRect();
    expect(bounds.top).toBe(0 - pan);
    expect(bounds.height).toBe(height);
    expect(bounds.width).toBe(width);
    expect(child.querySelector('#root header')!.getBoundingClientRect().top).toBe(top + (ipad ? 32 : 0));
    expect(child.querySelector('aside header')!.getBoundingClientRect().top).toBe(top);
    expect(child.querySelector('footer')!.getBoundingClientRect().bottom).toBe(height - bottom);
    expect(child.querySelector('main')!.getBoundingClientRect().height).toBe(height - top - bottom - (ipad ? 32 : 0) - 44 - 56);
  };
  // Hidden initialization and presentation must use the same full frame.
  expect(frame.style.visibility).toBe('hidden');
  assertGeometry();
  flushSync(() => { host.report('remote', { rendered: true, phase: 'ready' }); });
  expect(frame.style.visibility).toBe('visible');
  assertGeometry();
  flushSync(() => { host.activate(entry, false); });
  expect(frame.style.visibility).toBe('hidden');
  flushSync(() => { host.activate(remote, false); });
  expect(document.querySelector('iframe[data-workspace-key]')).toBe(frame);
  assertGeometry();
  if (native) {
    // Native scrolling moves the document; the frame must follow that pan.
    document.body.style.top = '-120px';
    assertGeometry(120);
    document.body.style.top = '0px';
    assertGeometry();
  }
});
