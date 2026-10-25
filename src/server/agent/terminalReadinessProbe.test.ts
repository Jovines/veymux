import { afterEach, expect, it, vi } from 'vitest';
import { probeTerminalReadiness, type InputFrame } from './terminalReadinessProbe.js';
import { RenderedTerminalContext } from './renderedTerminalContext.js';
afterEach(() => vi.useRealTimers());
function editor() {
  let frame: InputFrame = { lines: ['output', '> draft', ''], cols: 80, x: 7, y: 1 };
  const original = structuredClone(frame);
  const input = { read: vi.fn(async () => structuredClone(frame)), assertCurrent: vi.fn(),
    paste: vi.fn(async (text: string) => { frame.lines[1] += text; frame.x += text.length; }),
    erase: vi.fn(async (count: number) => { frame.lines[1] = frame.lines[1].slice(0, -count); frame.x -= count; }) };
  return { input, original, get frame() { return frame; }, set frame(value) { frame = value; } };
}
it('verifies an insertion and its removal while retaining the existing draft; never submits', async () => {
  const e = editor();
  expect(await probeTerminalReadiness(e.input)).toEqual({ status: 'ready', echoOnly: true });
  expect(e.frame).toEqual(e.original);
  expect(e.input.paste).toHaveBeenCalledOnce();
  const marker = e.input.paste.mock.calls[0][0];
  expect(marker).toMatch(/^td[a-f0-9]{8}$/);
  expect(e.input.erase).toHaveBeenCalledWith(marker.length);
});
it('does not send a deletion key when a menu ignores the input', async () => {
  vi.useFakeTimers(); const e = editor(); e.input.paste.mockImplementation(async () => {});
  const result = probeTerminalReadiness(e.input);
  await vi.advanceTimersByTimeAsync(800);
  expect(await result).toMatchObject({ status: 'unconfirmed' });
  expect(e.input.paste).toHaveBeenCalledOnce(); expect(e.input.erase).not.toHaveBeenCalled();
});
it('never erases a logged marker or an externally edited input with another cursor', async () => {
  vi.useFakeTimers(); const e = editor();
  e.input.paste.mockImplementation(async marker => { e.frame.lines[0] += marker; });
  const result = probeTerminalReadiness(e.input); await vi.advanceTimersByTimeAsync(800);
  expect((await result).status).toBe('unconfirmed'); expect(e.input.erase).not.toHaveBeenCalled();
});
it('skips a full row without injecting input and stops after a runtime change', async () => {
  const e = editor(); e.frame.cols = 12;
  expect((await probeTerminalReadiness(e.input)).status).toBe('skipped'); expect(e.input.paste).not.toHaveBeenCalled();
  e.frame.cols = 80;
  e.input.assertCurrent.mockImplementation(() => { if (e.input.paste.mock.calls.length) throw new Error('changed'); });
  expect((await probeTerminalReadiness(e.input)).status).toBe('unconfirmed'); expect(e.input.erase).not.toHaveBeenCalled();
});
it('requires cleanup confirmation and preserves unrelated new output as real activity', async () => {
  vi.useFakeTimers(); const e = editor(); e.input.erase.mockImplementation(async () => {});
  const result = probeTerminalReadiness(e.input); await vi.advanceTimersByTimeAsync(800);
  expect(await result).toMatchObject({ status: 'unconfirmed' });
  const next = editor(); const erase = next.input.erase.getMockImplementation()!;
  next.input.erase.mockImplementation(async count => { await erase(count); setTimeout(() => { next.frame.lines[0] += 'new output'; }, 30); });
  const resumed = probeTerminalReadiness(next.input); await vi.advanceTimersByTimeAsync(100);
  expect(await resumed).toEqual({ status: 'ready', echoOnly: false });
});
it('can clean its own input while unrelated output changes a different row', async () => {
  const e = editor(); const paste = e.input.paste.getMockImplementation()!;
  e.input.paste.mockImplementation(async marker => { await paste(marker); e.frame.lines[0] = 'real progress'; });
  expect(await probeTerminalReadiness(e.input)).toEqual({ status: 'ready', echoOnly: false });
  expect(e.frame.lines[1]).toBe('> draft'); expect(e.input.erase).toHaveBeenCalledOnce();
});
it('bounds a stalled snapshot before writing anything', async () => {
  vi.useFakeTimers(); const e = editor(); e.input.read.mockImplementation(() => new Promise(() => {}));
  const result = probeTerminalReadiness(e.input); await vi.advanceTimersByTimeAsync(800);
  expect(await result).toEqual({ status: 'skipped' }); expect(e.input.paste).not.toHaveBeenCalled();
});
it('does not begin an edit after the foreground request has been cancelled', async () => {
  const e = editor();
  expect(await probeTerminalReadiness({ ...e.input, shouldStart: () => false })).toEqual({ status: 'skipped' });
  expect(e.input.paste).not.toHaveBeenCalled();
});
it('uses rendered cells to preserve a CJK draft instead of slicing by JS character indices', async () => {
  const context = new RenderedTerminalContext(80, 10); context.write('> 草稿');
  try {
    expect(await probeTerminalReadiness({ read: () => context.inputFrame(),
      paste: async marker => { context.write(marker); },
      erase: async count => { context.write('\b \b'.repeat(count)); }, assertCurrent() {} })).toEqual({ status: 'ready', echoOnly: true });
    expect(await context.snapshot(true)).toBe('> 草稿');
  } finally { context.dispose(); }
});
