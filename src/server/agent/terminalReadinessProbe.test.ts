import { afterEach, expect, it, vi } from 'vitest';
import { probeTerminalReadiness, type InputFrame } from './terminalReadinessProbe.js';

afterEach(() => vi.useRealTimers());
function editor() {
  let frame: InputFrame = { lines: ['output', '> Ask Codex to do anything', ''], cols: 80, x: 2, y: 1 };
  let text = '';
  const original = structuredClone(frame);
  const render = () => { frame.lines[frame.y] = '> ' + (text || 'Ask Codex to do anything'); frame.x = 2 + text.length; };
  const input = { read: vi.fn(async () => structuredClone(frame)), assertCurrent: vi.fn(),
    paste: vi.fn(async (marker: string) => { text += marker; render(); }),
    erase: vi.fn(async (count: number) => { text = text.slice(0, -count); render(); }) };
  return { input, original, get frame() { return frame; }, set frame(value) { frame = value; } };
}
it('pastes exactly two symbols and deletes them despite the empty-input placeholder disappearing', async () => {
  const e = editor();
  expect(await probeTerminalReadiness(e.input)).toEqual({ status: 'ready', echoOnly: true });
  expect(e.input.paste.mock.calls[0][0]).toMatch(/^[~^|%&@#]{2}$/);
  expect(e.input.erase).toHaveBeenCalledExactlyOnceWith(2);
  expect(e.frame).toEqual(e.original);
});
it('still sends its two cleanup backspaces when input echo times out', async () => {
  vi.useFakeTimers(); const e = editor(); e.input.paste.mockImplementation(async () => {});
  const result = probeTerminalReadiness(e.input); await vi.advanceTimersByTimeAsync(800);
  expect(await result).toEqual({ status: 'unconfirmed' });
  expect(e.input.paste).toHaveBeenCalledOnce(); expect(e.input.erase).toHaveBeenCalledExactlyOnceWith(2);
});
it('does not gate cleanup on the cursor, row, terminal width or other rendered content', async () => {
  const e = editor(); const paste = e.input.paste.getMockImplementation()!;
  e.input.paste.mockImplementation(async marker => {
    e.frame.lines.splice(1, 0, 'new output'); e.frame.y++; e.frame.cols = 60;
    await paste(marker); e.frame.x = 0;
  });
  expect(await probeTerminalReadiness(e.input)).toEqual({ status: 'ready', echoOnly: false });
  expect(e.input.erase).toHaveBeenCalledExactlyOnceWith(2);
  expect(e.frame.lines[e.frame.y]).toBe(e.original.lines[1]);
  expect(e.frame.lines).toContain('new output');
});
it('reports an unconfirmed cleanup without retrying or submitting if the symbols remain', async () => {
  vi.useFakeTimers(); const e = editor(); e.input.erase.mockImplementation(async () => {});
  const result = probeTerminalReadiness(e.input); await vi.advanceTimersByTimeAsync(800);
  expect(await result).toMatchObject({ status: 'unconfirmed', residual: e.input.paste.mock.calls[0][0] });
  expect(e.input.paste).toHaveBeenCalledOnce(); expect(e.input.erase).toHaveBeenCalledExactlyOnceWith(2);
});
it('keeps unrelated output as real activity after successful cleanup', async () => {
  vi.useFakeTimers(); const e = editor(); const erase = e.input.erase.getMockImplementation()!;
  e.input.erase.mockImplementation(async count => { await erase(count); setTimeout(() => { e.frame.lines[0] += 'new output'; }, 30); });
  const result = probeTerminalReadiness(e.input); await vi.advanceTimersByTimeAsync(100);
  expect(await result).toEqual({ status: 'ready', echoOnly: false });
});
it('bounds a stalled initial snapshot before writing anything', async () => {
  vi.useFakeTimers(); const e = editor(); e.input.read.mockImplementation(() => new Promise(() => {}));
  const result = probeTerminalReadiness(e.input); await vi.advanceTimersByTimeAsync(800);
  expect(await result).toEqual({ status: 'skipped' });
  expect(e.input.paste).not.toHaveBeenCalled(); expect(e.input.erase).not.toHaveBeenCalled();
});
it('cleans an attempted paste even if later capture fails or the paste reports an error', async () => {
  const e = editor(); e.input.read.mockRejectedValueOnce(new Error('disconnected'));
  expect(await probeTerminalReadiness(e.input)).toEqual({ status: 'skipped' });
  e.input.read.mockImplementation(async () => {
    if (e.input.paste.mock.calls.length) throw new Error('capture failed after paste');
    return structuredClone(e.frame);
  });
  expect(await probeTerminalReadiness(e.input)).toMatchObject({ status: 'unconfirmed' });
  expect(e.input.erase).toHaveBeenCalledExactlyOnceWith(2);
  const next = editor(); next.input.paste.mockRejectedValueOnce(new Error('write uncertain'));
  expect(await probeTerminalReadiness(next.input)).toMatchObject({ status: 'unconfirmed' });
  expect(next.input.erase).toHaveBeenCalledExactlyOnceWith(2);
});
it('does not write cleanup keys to a replacement runtime', async () => {
  const e = editor();
  e.input.assertCurrent.mockImplementation(() => { if (e.input.paste.mock.calls.length) throw new Error('changed'); });
  expect(await probeTerminalReadiness(e.input)).toMatchObject({ status: 'unconfirmed' });
  expect(e.input.erase).not.toHaveBeenCalled();
});
it('does not begin an edit after eligibility or the foreground request is cancelled', async () => {
  const e = editor();
  expect(await probeTerminalReadiness({ ...e.input, shouldStart: () => false })).toEqual({ status: 'skipped' });
  expect(e.input.paste).not.toHaveBeenCalled(); expect(e.input.erase).not.toHaveBeenCalled();
});
