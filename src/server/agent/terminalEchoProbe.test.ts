import { afterEach, expect, it, vi } from 'vitest';
import { probeTerminalEcho } from './terminalEchoProbe.js';
import { writeBracketedPrompt } from './promptDelivery.js';

afterEach(() => vi.useRealTimers());
it('bounds a stuck capture before sending any input', async () => {
  vi.useFakeTimers(); const write = vi.fn(), erase = vi.fn();
  const result = expect(probeTerminalEcho({ read: () => new Promise(() => {}), write, erase })).rejects.toThrow('TERMINAL_INPUT_ECHO_UNCONFIRMED');
  await vi.advanceTimersByTimeAsync(1500); await result;
  expect(write).not.toHaveBeenCalled(); expect(erase).not.toHaveBeenCalled();
});
it('uses two symbols, accepts wrapped echo, and deletes the probe without submitting', async () => {
  let screen = 'old td.0123456789ab';
  const before = screen, writes: string[] = [], erase = vi.fn(async () => { screen = before; });
  await probeTerminalEcho({ read: async () => screen, write: async marker => {
    writes.push(marker); screen = marker[0] + '\n' + marker[1];
  }, erase });
  expect(writes).toHaveLength(1); expect(writes[0]).toMatch(/^[~^|%&@#]{2}$/);
  expect(erase).toHaveBeenCalledExactlyOnceWith(2); expect(screen).toBe(before);
});
it('cleans a missing echo without pasting the message body or Enter', async () => {
  vi.useFakeTimers(); const target = { write: vi.fn() }, stages: string[] = [];
  const result = expect(writeBracketedPrompt(target, 'PRIVATE BODY', undefined, stage => stages.push(stage), async () => 'unchanged')).rejects.toThrow('TERMINAL_INPUT_ECHO_UNCONFIRMED');
  await vi.advanceTimersByTimeAsync(1600); await result;
  expect(target.write.mock.calls.map(([text]) => text)).toEqual([expect.stringMatching(/^\x1b\[200~[~^|%&@#]{2}\x1b\[201~$/), '\x7f\x7f']);
  expect(stages.at(-1)).toBe('probe_attempted');
});
it('keeps probe, cleanup, body and a single Enter together in each serialized PTY operation', async () => {
  vi.useFakeTimers(); let screen = ''; const stages: string[] = [];
  const target = { write: vi.fn((text: string) => {
    if (text === '\r') screen = '';
    else if (text === '\x7f\x7f') screen = screen.slice(0, -2);
    else screen += text.replace(/\x1b\[(?:200|201)~/g, '');
  }) };
  const first = writeBracketedPrompt(target, 'ONE', undefined, stage => stages.push(stage), async () => screen);
  const second = writeBracketedPrompt(target, 'TWO', undefined, undefined, async () => screen);
  await vi.advanceTimersByTimeAsync(500); await Promise.all([first, second]);
  const writes = target.write.mock.calls.map(([text]) => text);
  expect(writes).toHaveLength(8);
  expect(stages).toEqual(['queue_wait', 'queue_acquired', 'probe_attempted', 'probe_completed', 'paste_attempted', 'paste_written', 'submit_attempted', 'submit_written']);
  for (const offset of [0, 4]) {
    expect(writes[offset]).toMatch(/^\x1b\[200~[~^|%&@#]{2}\x1b\[201~$/);
    expect(writes[offset + 1]).toBe('\x7f\x7f');
    expect(writes[offset + 2]).toContain(offset ? 'TWO' : 'ONE'); expect(writes[offset + 3]).toBe('\r');
  }
});
it('does not continue to the body while cleanup remains unconfirmed', async () => {
  vi.useFakeTimers(); let screen = '';
  const target = { write: vi.fn((text: string) => { if (text !== '\x7f\x7f') screen += text; }) };
  const result = expect(writeBracketedPrompt(target, 'PRIVATE BODY', undefined, undefined, async () => screen)).rejects.toThrow('TERMINAL_INPUT_ECHO_UNCONFIRMED');
  await vi.advanceTimersByTimeAsync(1600); await result;
  expect(target.write).toHaveBeenCalledTimes(2);
  expect(target.write.mock.calls[1][0]).toBe('\x7f\x7f');
});
it('fails without input when capture is unavailable and refuses cleanup on a replaced target', async () => {
  const write = vi.fn(), erase = vi.fn();
  await expect(probeTerminalEcho({ read: async () => { throw new Error('capture disconnected'); }, write, erase })).rejects.toThrow('TERMINAL_INPUT_ECHO_UNCONFIRMED');
  expect(write).not.toHaveBeenCalled(); expect(erase).not.toHaveBeenCalled();
  let changed = false;
  await expect(probeTerminalEcho({ read: async () => '', write: async () => { changed = true; }, erase, assertCurrent: () => {
    if (changed) throw new Error('target changed');
  } })).rejects.toThrow('TERMINAL_INPUT_ECHO_UNCONFIRMED');
  expect(erase).not.toHaveBeenCalled();
});
