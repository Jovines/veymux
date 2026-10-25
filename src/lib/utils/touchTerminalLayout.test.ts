// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPhoneDevice, usesTouchTerminalLayout } from './touchTerminalLayout';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('phone-only input UI', () => {
  it.each([
    ['iPhone', true], ['iPod', true], ['Mozilla/5.0 (Linux; Android 15) Mobile Safari/537.36', true],
    ['Mozilla/5.0 (Linux; Android 15) Safari/537.36', false], ['iPad', false],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', false], ['Mozilla/5.0 (Macintosh; Intel Mac OS X)', false],
  ])('recognizes %s independently of a narrow touch viewport', (userAgent, expected) => {
    vi.stubGlobal('navigator', { userAgent, platform: 'MacIntel', maxTouchPoints: 10 });
    vi.stubGlobal('innerWidth', 390); vi.stubGlobal('innerHeight', 300);
    expect(isPhoneDevice()).toBe(expected);
  });
});

describe('touch terminal layout', () => {
  it.each([[1180, 820], [820, 1180], [1366, 1024], [768, 1024]])(
    'keeps desktop-UA iPads in touch mode at %i × %i', (width, height) => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', platform: 'MacIntel', maxTouchPoints: 5,
      });
      vi.stubGlobal('innerWidth', width);
      vi.stubGlobal('innerHeight', height);
      expect(usesTouchTerminalLayout()).toBe(true);
    },
  );

  it('keeps a landscape phone in touch mode when its long side exceeds the breakpoint', () => {
    vi.stubGlobal('navigator', { userAgent: 'Android', platform: 'Linux', maxTouchPoints: 5 });
    vi.stubGlobal('innerWidth', 932);
    vi.stubGlobal('innerHeight', 430);
    expect(usesTouchTerminalLayout()).toBe(true);
  });

  it('preserves desktop controls on a wide touchscreen laptop', () => {
    vi.stubGlobal('navigator', { userAgent: 'Windows', platform: 'Win32', maxTouchPoints: 10 });
    vi.stubGlobal('innerWidth', 1440);
    vi.stubGlobal('innerHeight', 900);
    expect(usesTouchTerminalLayout()).toBe(false);
  });
});
