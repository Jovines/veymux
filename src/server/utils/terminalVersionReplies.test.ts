import { expect, it } from 'vitest';
import { TerminalVersionReplies } from './terminalVersionReplies.js';

const reply = '\x1bP>|xterm.js(6.1.0-beta.315)\x1b\\';

it('accepts one version reply per real query, even across output chunk boundaries', () => {
  for (const query of ['\x1b[>q', '\x1b[>0q', '\x9b>0q']) {
    for (let split = 0; split <= query.length; split++) {
      const guard = new TerminalVersionReplies();
      expect(guard.filter(reply)).toBe('');
      guard.observe(query.slice(0, split)); guard.observe(query.slice(split));
      expect(guard.filter(reply + reply)).toBe(reply);
      expect(guard.filter(reply)).toBe('');
      guard.observe(query);
      expect(guard.filter(reply)).toBe(reply);
    }
  }
});

it('does not mistake title, image or other control-string payloads for queries', () => {
  for (const [start, end] of [['\x1b]', '\x07'], ['\x1bP', '\x1b\\'], ['\x9d', '\x9c'], ['\x1b_', '\x1b\\']]) {
    const guard = new TerminalVersionReplies();
    for (const char of `${start}literal \x1b[>q${end}`) guard.observe(char);
    expect(guard.filter(reply)).toBe('');
    guard.observe('\x1b[>q');
    expect(guard.filter(reply)).toBe(reply);
  }
});

it('preserves keyboard, mouse, paste and other terminal replies', () => {
  const guard = new TerminalVersionReplies();
  for (const input of ['hello', '\r', '\x1b', '\x1b[<64;1;2M', '\x1b[1;2R', '\x1b[200~' + reply + '\x1b[201~', 'literal ' + reply]) {
    expect(guard.filter(input)).toBe(input);
  }
  guard.observe('\x1b[>1q\x1b[ q\x1b[>\x18q');
  expect(guard.filter(reply)).toBe('');
});
