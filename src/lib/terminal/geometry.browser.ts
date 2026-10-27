import { afterEach, expect, it } from 'vitest';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { createBrowserTerminal, TerminalGeometry } from './geometry';
import { createResizePresentation } from './resizePresentation';

const fixtures: Array<{ terminal: Terminal; host: HTMLElement }> = [];
afterEach(() => { for (const { terminal, host } of fixtures.splice(0)) { terminal.dispose(); host.remove(); } });

it.each(['dom', 'webgl'])('uses the measured %s grid on the first visible browser frame after hidden initialization', async renderer => {
  await document.fonts.ready;
  const host = document.createElement('div');
  Object.assign(host.style, { width: '900px', height: '450px', visibility: 'hidden' });
  document.body.append(host);
  const terminal = (await createBrowserTerminal({ cols: 80, rows: 24, allowProposedApi: true, fontSize: 14, fontFamily: 'monospace' }))!;
  fixtures.push({ terminal, host });
  const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(host);
  if (renderer === 'webgl') terminal.loadAddon(new WebglAddon());
  const geometry = new TerminalGeometry(terminal, fit, host, { authority: 'viewport' });
  expect(geometry.dimensions).toBeNull();
  geometry.fit('initialize', false);
  const first = geometry.dimensions!;
  expect(first.cols).toBeGreaterThan(80);
  await new Promise<void>(resolve => terminal.write('FIRST SCREEN', resolve));
  host.style.width = '1100px';
  host.style.visibility = 'visible';
  geometry.fit('reveal', true);
  const visible = geometry.dimensions!;
  expect(visible.cols).toBeGreaterThan(first.cols);
  const screen = host.querySelector<HTMLElement>('.xterm-screen')!;
  const width = screen.offsetWidth;
  const samples: Array<{ cols: number; width: number }> = [];
  for (let n = 0; n < 3; n++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => { samples.push({ cols: terminal.cols, width: screen.offsetWidth }); resolve(); }));
  }
  expect(samples).toEqual(Array.from({ length: 3 }, () => ({ cols: visible.cols, width })));
  expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe('FIRST SCREEN');
  expect(host.querySelector<HTMLElement>('.xterm-screen')!.offsetWidth).toBeLessThanOrEqual(1100);
});

it.each(['dom', 'webgl'])('keeps intermediate resize history out of the %s renderer', async rendererMode => {
  const host = document.createElement('div');
  Object.assign(host.style, { width: '390px', height: '600px' });
  document.body.append(host);
  const terminal = (await createBrowserTerminal({ allowProposedApi: true, scrollback: 0, fontSize: 14, fontFamily: 'monospace' }))!;
  fixtures.push({ terminal, host });
  const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(host);
  if (rendererMode === 'webgl') terminal.loadAddon(new WebglAddon());
  const presentation = createResizePresentation(terminal);
  const geometry = new TerminalGeometry(terminal, fit, host, { authority: 'viewport', beforeLiveResize: () => presentation.begin() });
  const write = (data: string) => new Promise<void>(resolve => {
    presentation.writing();
    const generation = presentation.generation;
    terminal.write(data, () => { presentation.written(generation); resolve(); });
  });
  const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  geometry.fit('initialize', true);
  await write('CURRENT_PROMPT'); await frame();
  const renderer = (terminal as unknown as { _core: { _renderService: { _renderer: { value: { renderRows(start: number, end: number): void } } } } })._core._renderService._renderer.value;
  const renderRows = renderer.renderRows;
  const paints: string[] = [];
  renderer.renderRows = function(start, end) {
    paints.push(terminal.buffer.active.getLine(terminal.buffer.active.viewportY)?.translateToString(true) ?? '');
    renderRows.call(this, start, end);
  };
  try {
    for (const height of ['300px', '600px']) {
      paints.length = 0;
      host.style.height = height; geometry.fit('update', true, 'refresh:resize');
      await write('\x1b[?2026h\x1b[2J\x1b[HOLD_HISTORY\x1b[?2026l'); await frame();
      expect(paints).toEqual([]);
      await write('\x1b[?2026h\x1b[2J\x1b[HREFLOW_HISTORY\x1b[?2026l'); await frame();
      expect(paints).toEqual([]);
      await write('\x1b[?2026h\x1b[2J\x1b[HCURRENT_PROMPT\x1b[?2026l');
      await expect.poll(() => paints.length).toBeGreaterThan(0);
      expect(paints.every(line => line === 'CURRENT_PROMPT')).toBe(true);
    }
  } finally {
    presentation.dispose(); renderer.renderRows = renderRows;
  }
});
