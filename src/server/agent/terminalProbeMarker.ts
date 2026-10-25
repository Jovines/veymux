import { randomInt } from 'node:crypto';

// Two printable single-cell ASCII symbols: no control keys, combining marks
// or locale-dependent Unicode widths. Check the screen rather than relying
// on a long random identity to distinguish a fresh echo from old output.
const symbols = '~^|%&@#';

export function createTerminalProbeMarker(screen: string): string | null {
  const existing = screen.replace(/\r?\n/g, '');
  const candidates = [...symbols].flatMap(first => [...symbols].map(second => first + second))
    .filter(candidate => !existing.includes(candidate));
  return candidates.length ? candidates[randomInt(candidates.length)] : null;
}
