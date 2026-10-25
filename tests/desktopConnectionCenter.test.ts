// @vitest-environment node
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopSnapshot, LocalServiceSetup } from '../desktop/types.js';

const html = readFileSync(new URL('../desktop/renderer/index.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../desktop/renderer/app.js', import.meta.url), 'utf8');
const windows: JSDOM[] = [];
afterEach(() => { for (const dom of windows.splice(0)) dom.window.close(); });

function snapshot(phase: LocalServiceSetup['phase'] = 'needs-node', running = false): DesktopSnapshot {
  return {
    appVersion: '1.0.0', connections: [], lastConnectionUrl: null,
    desktopPreferences: { menuBarStatusEnabled: false, floatingWidgetEnabled: false, floatingWidgetPosition: null },
    localService: {
      running, state: null,
      probe: running ? { ok: true, url: 'http://localhost:9834' } : null,
      setup: { phase, message: '请检查网络后重试。', ...(phase === 'error' ? { details: 'download failed' } : {}) },
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function mount(initial = snapshot(), hash = '') {
  const dom = new JSDOM(html, { url: `http://center.test/${hash}`, runScripts: 'outside-only', pretendToBeVisual: true });
  windows.push(dom);
  let notify!: (setup: LocalServiceSetup) => void;
  const api = {
    snapshot: vi.fn(async () => structuredClone(initial)),
    onLocalServiceSetup: (callback: typeof notify) => { notify = callback; },
    onDesktopStatus: vi.fn(), desktopStatus: vi.fn(async () => ({ text: '服务0', tooltip: '' })),
    prepareLocalService: vi.fn(async () => snapshot('ready', true)),
    downloadNode: vi.fn(async () => {}), connect: vi.fn(async () => ({ ok: true, error: '' })),
    updateDesktopPreferences: vi.fn(async () => structuredClone(initial)),
  };
  Object.assign(dom.window, { termdockDesktop: api, setInterval: () => 0 });
  dom.window.eval(script);
  const doc = dom.window.document;
  const element = <T extends Element = HTMLElement>(selector: string) => doc.querySelector<T>(selector)!;
  await vi.waitFor(() => expect(element('#version').textContent).toContain('1.0.0'));
  const navigate = async (page: string) => {
    dom.window.location.hash = page;
    await vi.waitFor(() => expect(element(`#${page}`).hidden).toBe(false));
  };
  return { api, dom, doc, element, navigate, notify: (setup: LocalServiceSetup) => notify(setup) };
}

describe('connection center journeys', () => {
  it('opens one destination at a time, restores navigation, and preserves a remote draft', async () => {
    const f = await mount(snapshot(), '#remote');
    expect(f.element('#local').hidden).toBe(true);
    expect(f.element('[aria-current="page"]').getAttribute('href')).toBe('#remote');
    const draft = f.doc.createElement('input');
    draft.value = 'my-computer.example';
    f.element('#service-manager').append(draft);
    await f.navigate('guide');
    expect(f.element('#remote').hidden).toBe(true);
    expect(f.element('#refresh').hidden).toBe(true);
    expect(f.doc.activeElement).toBe(f.element('#page-title'));
    await f.navigate('remote');
    expect(draft.isConnected).toBe(true);
    expect(draft.value).toBe('my-computer.example');
    expect(f.doc.querySelectorAll('.center-panel:not([hidden])')).toHaveLength(1);
  });

  it('offers optional guides with a relevant next action, without starting an installation', async () => {
    const f = await mount(snapshot(), '#guide');
    f.element('[data-guide="remote"]').click();
    expect(f.element('[data-guide="remote"]').getAttribute('aria-pressed')).toBe('true');
    expect(f.element('[data-guide-content="terminal"]').hidden).toBe(true);
    expect(f.element('[data-guide-content="remote"]').hidden).toBe(false);
    expect(f.element('#guide-next').getAttribute('href')).toBe('#remote');
    f.element('[data-guide="agent"]').click();
    expect(f.element('#guide-next').getAttribute('href')).toBe('#local');
    expect(f.api.prepareLocalService).not.toHaveBeenCalled();
    expect(f.api.downloadNode).not.toHaveBeenCalled();
  });

  it.each([
    ['checking', 0, true], ['needs-node', 0, false], ['needs-install', 1, false],
    ['installing', 1, true], ['starting', 1, true], ['ready', 1, false], ['error', 0, false],
  ] as const)('shows the current step and available action for %s', async (phase, step, pending) => {
    const f = await mount(snapshot(phase));
    expect(f.element('.setup-steps [aria-current="step"]').getAttribute('data-setup-step')).toBe(String(step));
    expect(f.element<HTMLButtonElement>('#prepare-local').disabled).toBe(pending);
    expect(f.element('#connect-local').hidden).toBe(true);
    expect(f.element<HTMLDetailsElement>('#local-diagnostics').open).toBe(false);
    if (phase === 'error') expect(f.element('#local-diagnostics-content').textContent).toContain('download failed');
  });

  it('explains how to resume after downloading Node and keeps installation explicit', async () => {
    const f = await mount();
    f.element('#prepare-local').click();
    await vi.waitFor(() => expect(f.element('#visual-status').textContent).toContain('安装完成后'));
    expect(f.api.downloadNode).toHaveBeenCalledOnce();
    expect(f.api.prepareLocalService).not.toHaveBeenCalled();
    f.api.prepareLocalService.mockResolvedValue(snapshot('needs-install'));
    f.element('#refresh').click();
    await vi.waitFor(() => expect(f.element('#prepare-local').textContent).toBe('安装并启动'));
    expect(f.api.prepareLocalService).toHaveBeenCalledExactlyOnceWith(false);
    f.api.prepareLocalService.mockResolvedValue(snapshot('ready', true));
    f.element('#prepare-local').click();
    await vi.waitFor(() => expect(f.element('#connect-local').hidden).toBe(false));
    expect(f.api.prepareLocalService).toHaveBeenLastCalledWith(true);
    expect(f.element('.setup-steps [aria-current="step"]').getAttribute('data-setup-step')).toBe('2');
  });

  it('preserves a newer setup status when the download-page request completes late', async () => {
    const f = await mount();
    const download = deferred<void>();
    f.api.downloadNode.mockReturnValue(download.promise);
    f.element('#prepare-local').click();
    f.notify({ phase: 'needs-install', message: '' });
    expect(f.element<HTMLButtonElement>('#prepare-local').disabled).toBe(true);
    download.resolve();
    await vi.waitFor(() => expect(f.element<HTMLButtonElement>('#prepare-local').disabled).toBe(false));
    expect(f.element('#prepare-local').textContent).toBe('安装并启动');
    expect(f.element('#visual-status').textContent).toBe('为你的工作准备一个空间');
  });

  it('lets the user retry a failed download-page launch and failed environment preparation', async () => {
    const f = await mount();
    f.api.downloadNode.mockRejectedValueOnce(new Error('无法打开浏览器'));
    f.element('#prepare-local').click();
    await vi.waitFor(() => expect(f.element('#notice').textContent).toContain('无法打开浏览器'));
    expect(f.element<HTMLButtonElement>('#prepare-local').disabled).toBe(false);
    f.api.prepareLocalService.mockRejectedValueOnce(new Error('连接中断'));
    f.element('#refresh').click();
    await vi.waitFor(() => expect(f.element('#notice').textContent).toContain('连接中断'));
    expect(f.element<HTMLButtonElement>('#refresh').disabled).toBe(false);
  });

  it('prevents duplicate opens and restores a usable action after connection failure', async () => {
    const f = await mount(snapshot('ready', true));
    const connection = deferred<{ ok: boolean; error: string }>();
    f.api.connect.mockReturnValueOnce(connection.promise);
    f.element('#connect-local').click();
    f.element('#connect-local').click();
    expect(f.api.connect).toHaveBeenCalledExactlyOnceWith('http://localhost:9834');
    expect(f.element<HTMLButtonElement>('#connect-local').disabled).toBe(true);
    f.notify({ phase: 'ready', message: '' });
    expect(f.element<HTMLButtonElement>('#connect-local').disabled).toBe(true);
    connection.resolve({ ok: false, error: '工作空间暂时无法连接' });
    await vi.waitFor(() => expect(f.element('#notice').textContent).toBe('工作空间暂时无法连接'));
    expect(f.element<HTMLButtonElement>('#connect-local').disabled).toBe(false);
    expect(f.element('#connect-local span').textContent).toBe('打开工作空间');
  });
});
