import { expect, it } from 'vitest';
import { isTerminalResponse } from './terminalResponse';
it('recognizes parser replies but never keys, paste, focus or mouse reports', () => {
  for (const reply of ['\x1b[1;2R', '\x1b[?1;2R', '\x1b[0n', '\x1b[?1;2c', '\x1b[>0;276;0c', '\x1b[8;24;80t', '\x1b[?1;1$y', '\x1b[?3u', '\x1bP1$r0m\x1b\\', '\x1b]11;rgb:ffff/ffff/ffff\x1b\\']) expect(isTerminalResponse(reply)).toBe(true);
  for (const input of ['', 'hello', '\r', '\x1b', '\x1b[I', '\x1b[O', '\x1b[<64;1;2M', '\x1b[200~hello\x1b[201~', '\x1b[1;2Rhello']) expect(isTerminalResponse(input)).toBe(false);
});
