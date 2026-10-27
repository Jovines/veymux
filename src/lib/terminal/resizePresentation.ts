import type { Terminal } from '@xterm/xterm';

interface Renderer {
  handleResize(cols: number, rows: number): void;
  renderRows(start: number, end: number): void;
  clear(): void;
}

type RenderInternals = {
  _core?: { _renderService?: { _renderer?: { value?: Renderer } } };
};
export const RESIZE_PRESENTATION_TIMEOUT_MS = 500;
export const RESIZE_PRESENTATION_SETTLE_MS = 100;

/**
 * xterm's synchronized output protects row painting, but not handleResize:
 * WebGL clears its canvas and DOM removes rows immediately. Keep the existing
 * surface until the resize output has settled, then resize and repaint together.
 * The first tmux frame may still show the old pane before the application has
 * handled SIGWINCH; releasing there exposes its history/reflow redraws.
 * This only fences local reflow; a tmux frame is not an application-ready signal.
 * All model resizes and PTY requests still happen at their original time.
 * Keep the dependency on xterm's renderer slot isolated here and fail open if
 * an upgraded xterm changes that interface.
 */
export function createResizePresentation(terminal: Terminal) {
  let restore: (() => void) | undefined;
  let geometry: [number, number] | undefined;
  let frameEnded = false;
  let generation = 0;
  let fallback: ReturnType<typeof setTimeout> | undefined;
  let settled: ReturnType<typeof setTimeout> | undefined;
  const clearSettle = () => {
    if (settled !== undefined) { clearTimeout(settled); settled = undefined; }
  };
  const endFrame = terminal.parser.registerCsiHandler({ prefix: '?', final: 'l' }, params => {
    if (restore && params.some(value => value === 2026)) frameEnded = true;
    return false;
  });

  const finish = (paint: boolean) => {
    clearSettle();
    if (fallback !== undefined) { clearTimeout(fallback); fallback = undefined; }
    const undo = restore;
    if (!undo) return;
    const size = geometry;
    restore = undefined;
    geometry = undefined;
    frameEnded = false;
    undo();
    if (paint) {
      const renderer = (terminal as unknown as RenderInternals)._core?._renderService?._renderer?.value;
      // Resizing WebGL can request an immediate redraw itself. Restore all
      // methods first so that redraw uses the newly parsed model in this task.
      if (size) renderer?.handleResize(...size);
      renderer?.renderRows(0, terminal.rows - 1);
      terminal.refresh(0, terminal.rows - 1);
    }
  };

  return {
    begin() {
      generation++;
      frameEnded = false;
      clearSettle();
      if (restore) return;
      const renderer = (terminal as unknown as RenderInternals)._core?._renderService?._renderer?.value;
      if (!renderer || typeof renderer.handleResize !== 'function'
        || typeof renderer.renderRows !== 'function' || typeof renderer.clear !== 'function') return;
      const resize = renderer.handleResize;
      const render = renderer.renderRows;
      const clear = renderer.clear;
      renderer.handleResize = (cols, rows) => { geometry = [cols, rows]; };
      renderer.renderRows = () => {};
      renderer.clear = () => {};
      restore = () => {
        renderer.handleResize = resize;
        renderer.renderRows = render;
        renderer.clear = clear;
      };
      // A passive client, older tmux, or a lost frame may never send ?2026l.
      // Keep the fence bounded, including during continuous resize bursts.
      fallback = setTimeout(() => finish(true), RESIZE_PRESENTATION_TIMEOUT_MS);
    },
    get generation() { return generation; },
    writing() { clearSettle(); },
    written(writeGeneration: number) {
      clearSettle();
      if (writeGeneration !== generation) { frameEnded = false; return; }
      if (writeGeneration === generation && frameEnded && !terminal.modes.synchronizedOutputMode) {
        // A complete frame is a parser boundary, not application readiness.
        // Coalesce the following redraw burst, bounded by the original deadline.
        settled = setTimeout(() => finish(true), RESIZE_PRESENTATION_SETTLE_MS);
      }
    },
    cancel() { finish(true); },
    dispose() { finish(false); endFrame.dispose(); },
  };
}
