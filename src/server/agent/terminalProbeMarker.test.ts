import { expect, it } from 'vitest';
import { createTerminalProbeMarker } from './terminalProbeMarker.js';

it('uses exactly two printable symbols absent from the screen, including wrapped history', () => {
  let screen = '~\n^';
  const markers = new Set<string>();
  for (;;) {
    const marker = createTerminalProbeMarker(screen);
    if (marker === null) break;
    expect(marker).toMatch(/^[~^|%&@#]{2}$/);
    expect(screen.replace(/\r?\n/g, '')).not.toContain(marker);
    expect(markers.has(marker)).toBe(false);
    markers.add(marker); screen += '\n' + marker + '\n';
  }
  expect(markers.size).toBeGreaterThan(0);
  expect(createTerminalProbeMarker(screen)).toBeNull();
});
