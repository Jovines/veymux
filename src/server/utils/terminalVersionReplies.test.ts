import { expect, it, vi } from 'vitest';
import { TERMINAL_VERSION_REPLY, TerminalVersionReplies } from './terminalVersionReplies.js';

const reply = '\x1bP>|xterm.js(6.1.0-beta.315)\x1b\\';

it('answers queries locally across output chunk boundaries and discards all browser versions', () => {
  for (const query of ['\x1b[>q', '\x1b[>0q', '\x9b>0q']) {
    for (let split = 0; split <= query.length; split++) {
      const write = vi.fn();
      const guard = new TerminalVersionReplies(write);
      expect(guard.filter(reply)).toBe('');
      guard.observe(query.slice(0, split)); guard.observe(query.slice(split));
      expect(write.mock.calls).toEqual([[TERMINAL_VERSION_REPLY]]);
      expect(guard.filter(reply + reply)).toBe('');
      expect(guard.filter(reply)).toBe('');
      guard.observe(query);
      expect(write.mock.calls).toEqual([[TERMINAL_VERSION_REPLY], [TERMINAL_VERSION_REPLY]]);
      expect(guard.filter(reply)).toBe('');
      expect(guard.filter('\x90>|old-client\x9c')).toBe('');
    }
  }
});

it('does not mistake title, image or other control-string payloads for queries', () => {
  for (const [start, end] of [['\x1b]', '\x07'], ['\x1bP', '\x1b\\'], ['\x9d', '\x9c'], ['\x1b_', '\x1b\\']]) {
    const write = vi.fn();
    const guard = new TerminalVersionReplies(write);
    for (const char of `${start}literal \x1b[>q${end}`) guard.observe(char);
    expect(guard.filter(reply)).toBe('');
    expect(write).not.toHaveBeenCalled();
    guard.observe('\x1b[>q');
    expect(write).toHaveBeenCalledExactlyOnceWith(TERMINAL_VERSION_REPLY);
  }
});

it('preserves keyboard, mouse, paste and other terminal replies', () => {
  const write = vi.fn();
  const guard = new TerminalVersionReplies(write);
  for (const input of ['hello', '\r', '\x1b', '\x1b[<64;1;2M', '\x1b[1;2R', '\x1b[200~' + reply + '\x1b[201~', 'literal ' + reply]) {
    expect(guard.filter(input)).toBe(input);
  }
  guard.observe('\x1b[>1q\x1b[ q\x1b[>\x18q');
  expect(write).not.toHaveBeenCalled();
  expect(guard.filter(reply)).toBe('');
});
