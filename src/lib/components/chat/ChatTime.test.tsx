// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { ChatTime, chatTime } from './ChatTime';

afterEach(() => { cleanup(); vi.useRealTimers(); });
const local = (year: number, month: number, day: number, hour = 9, minute = 5) => new Date(year, month - 1, day, hour, minute).getTime();

it('labels calendar dates in the viewer timezone, including yesterday across month and year boundaries', () => {
  const now = local(2026, 10, 26, 0, 1);
  expect(chatTime(local(2026, 10, 26, 0, 0), now)).toBe('00:00');
  expect(chatTime(local(2026, 10, 25, 23, 59), now)).toBe('昨天 23:59');
  expect(chatTime(local(2026, 10, 24), now)).toBe('10月24日 09:05');
  expect(chatTime(local(2025, 10, 26), now)).toBe('2025年10月26日 09:05');
  expect(chatTime(local(2026, 9, 30), local(2026, 10, 1))).toBe('昨天 09:05');
  expect(chatTime(local(2025, 12, 31), local(2026, 1, 1))).toBe('昨天 09:05');
});

it('updates mounted messages at local midnight and after a suspended page resumes', () => {
  vi.useFakeTimers();
  vi.setSystemTime(local(2026, 10, 26, 23, 59));
  const at = local(2026, 10, 26);
  const view = render(<ChatTime at={at} />);
  const time = view.container.querySelector('time')!;
  expect(time.textContent).toBe('09:05');
  expect(time.dateTime).toBe(new Date(at).toISOString());
  act(() => vi.advanceTimersByTime(60_000));
  expect(time.textContent).toBe('昨天 09:05');
  act(() => { vi.setSystemTime(local(2027, 1, 2)); document.dispatchEvent(new Event('visibilitychange')); });
  expect(time.textContent).toBe('2026年10月26日 09:05');
});
