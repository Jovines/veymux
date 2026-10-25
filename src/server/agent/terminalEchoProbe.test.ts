import { afterEach, expect, it, vi } from 'vitest';
import { probeTerminalEcho } from './terminalEchoProbe.js';
import { writeBracketedPrompt } from './promptDelivery.js';

afterEach(() => vi.useRealTimers());
it('bounds a stuck capture before sending any input', async () => {
  vi.useFakeTimers();
  const write = vi.fn();
  const result = expect(probeTerminalEcho({ read: () => new Promise(() => {}), write })).rejects.toThrow('TERMINAL_INPUT_ECHO_UNCONFIRMED');
  await vi.advanceTimersByTimeAsync(1500); await result;
  expect(write).not.toHaveBeenCalled();
});
it('uses a fresh printable header, accepts wrapped echo and sends no editing or submit keys', async () => {
  let screen = 'old td.0123456789ab';
  const writes: string[] = [];
  await probeTerminalEcho({ read: async () => screen, write: async header => {
    writes.push(header); screen = header.slice(0, 8) + '\n' + header.slice(8);
  } });
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatch(/^\[td\.[a-f0-9]{12}\] $/);
  expect(writes[0]).not.toMatch(/[\x00-\x1f\x7f]/);
});
it('stops without pasting the body or Enter when the PTY does not echo the header', async () => {
  vi.useFakeTimers();
  const target = { write: vi.fn() }, stages: string[] = [];
  const result = expect(writeBracketedPrompt(target, 'PRIVATE BODY', undefined, stage => stages.push(stage), async () => 'unchanged')).rejects.toThrow('TERMINAL_INPUT_ECHO_UNCONFIRMED');
  await vi.advanceTimersByTimeAsync(1500); await result;
  expect(target.write).toHaveBeenCalledOnce();
  expect(target.write.mock.calls[0]![0]).not.toContain('PRIVATE BODY');
  expect(stages.at(-1)).toBe('paste_attempted');
});
it('keeps the probe, body and single Enter in one serialized PTY operation', async () => {
  vi.useFakeTimers();
  let screen = '';
  const target = { write: vi.fn((text: string) => { screen += text; }) };
  const first = writeBracketedPrompt(target, 'ONE', undefined, undefined, async () => screen);
  const second = writeBracketedPrompt(target, 'TWO', undefined, undefined, async () => screen);
  await vi.advanceTimersByTimeAsync(100); await Promise.all([first, second]);
  const writes = target.write.mock.calls.map(([text]) => text);
  expect(writes).toHaveLength(6);
  expect(writes[0]).toMatch(/td\.[a-f0-9]{12}/);
  expect(writes[1]).toContain('ONE'); expect(writes[2]).toBe('\r');
  expect(writes[3]).toMatch(/td\.[a-f0-9]{12}/);
  expect(writes[4]).toContain('TWO'); expect(writes[5]).toBe('\r');
  expect(writes[0]).not.toBe(writes[3]);
});
it('fails before input when capture is unavailable and rejects a changed target after echo', async () => {
  const write = vi.fn();
  await expect(probeTerminalEcho({ read: async () => { throw new Error('capture disconnected'); }, write })).rejects.toThrow('capture disconnected');
  expect(write).not.toHaveBeenCalled();
  let changed = false;
  await expect(probeTerminalEcho({ read: async () => '', write: async () => { changed = true; }, assertCurrent: () => {
    if (changed) throw new Error('target changed');
  } })).rejects.toThrow('target changed');
});
