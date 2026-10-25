import { expect, it } from 'vitest';
import { hasUniqueForegroundResumeGroup } from './foregroundResumeIdentity';
it('distinguishes a wrapper in one foreground group from a second resumed terminal', () => {
  const binary = { pid: 10, tty: 'pts/1', pgid: 8, tpgid: 8 };
  expect(hasUniqueForegroundResumeGroup([{ ...binary, pid: 8 }, binary], 10)).toBe(true);
  expect(hasUniqueForegroundResumeGroup([binary, { ...binary, pid: 20, tty: 'pts/2', pgid: 20, tpgid: 20 }], 10)).toBe(false);
  expect(hasUniqueForegroundResumeGroup([binary], 99)).toBe(false);
  expect(hasUniqueForegroundResumeGroup([{ ...binary, tpgid: 20 }], 10)).toBe(false);
});
