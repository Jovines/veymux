import { describe, expect, it, vi } from 'vitest';
import { boundedLines } from './boundedLines.js';

describe('bounded child-process lines', () => {
  it('frames chunk boundaries and accepts the exact limit', () => {
    const line = vi.fn(), limit = vi.fn();
    const consume = boundedLines(4, line, limit);
    consume('ab'); consume('cd'); consume('\nx\ny'); consume('z\n');
    expect(line.mock.calls.flat()).toEqual(['abcd', 'x', 'yz']);
    expect(limit).not.toHaveBeenCalled();
  });
  it('stops before parsing an oversized partial or complete record', () => {
    for (const chunks of [['ok\n12345\nend\n'], ['ok\n12', '34', '5', '\nend\n']]) {
      const line = vi.fn(), limit = vi.fn();
      const consume = boundedLines(4, line, limit);
      chunks.forEach(consume);
      consume('later\n');
      expect(line.mock.calls.flat()).toEqual(['ok']);
      expect(limit).toHaveBeenCalledOnce();
    }
  });
});
