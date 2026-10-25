// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { probeTerminalEcho } from './terminalEchoProbe.js';

it.each([2, 8, 16])('verifies a horizontally clipped input showing only its last %i cells', async cells => {
  const original = 'ready';
  let screen = original;
  let marker = '';
  const writes: string[] = [], erases: number[] = [];
  await probeTerminalEcho({
    read: async () => screen,
    write: async value => { marker = value; writes.push(value); screen = value.slice(-cells); },
    erase: async count => { erases.push(count); screen = original; },
  });
  expect(marker.length).toBeLessThanOrEqual(2);
  expect(writes).toEqual([marker]);
  expect(erases).toEqual([marker.length]);
  expect(screen).toBe(original);
  expect(writes.join('')).not.toMatch(/[\r\n\x1b]/);
});

it('rejects unavailable capture before touching any terminal input', async () => {
  const write = vi.fn(), erase = vi.fn();
  await expect(probeTerminalEcho({ read: async () => { throw new Error('capture unavailable'); }, write, erase })).rejects.toThrow();
  expect(write).not.toHaveBeenCalled(); expect(erase).not.toHaveBeenCalled();
});
