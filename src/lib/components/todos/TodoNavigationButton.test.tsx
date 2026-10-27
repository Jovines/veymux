// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TodoNavigationButton } from './TodoNavigationButton';
const api = vi.hoisted(() => ({ count: vi.fn(), target: 'a' }));
vi.mock('../../todos/api', () => ({ todoCount: api.count }));
vi.mock('../../federation/browserIntegration', () => ({ savedConnection: () => ({ targetPeerId: api.target }), SECURE_STATE_EVENT: 'test:state' }));
vi.mock('../../federation/connectionRecovery', () => ({ SECURE_READY_EVENT: 'test:ready' }));
beforeEach(() => { api.target = 'a'; api.count.mockReset().mockResolvedValue({ count: 7 }); });
afterEach(cleanup);
it('shows the same unfinished count at both navigation entrances and opens the selected entrance', async () => {
  const open = vi.fn();
  render(<><TodoNavigationButton placement="toolbar" onOpen={open} /><TodoNavigationButton onOpen={() => {}} /></>);
  await waitFor(() => expect(screen.getAllByText('7')).toHaveLength(2));
  const toolbar = screen.getByRole('button', { name: '打开待办清单' });
  expect(toolbar.getAttribute('aria-description')).toBe('7 项未完成');
  expect(toolbar.title).toBe('待办清单 · 7 项未完成');
  fireEvent.click(toolbar); expect(open).toHaveBeenCalledOnce();
});
it('caps the visible badge while retaining the full count and refreshes after mutations', async () => {
  render(<TodoNavigationButton placement="toolbar" onOpen={() => {}} />);
  await screen.findByText('7');
  api.count.mockResolvedValue({ count: 137 }); fireEvent(window, new Event('veymux:todos-changed'));
  await screen.findByText('99+'); expect(screen.getByRole('button').title).toContain('137 项未完成');
  api.count.mockResolvedValue({ count: 0 }); fireEvent(window, new Event('veymux:todos-changed'));
  await waitFor(() => expect(screen.getByRole('button').getAttribute('aria-description')).toBe('0 项未完成'));
  expect(screen.queryByText('99+')).toBeNull(); expect(screen.queryByText('0')).toBeNull();
  expect(screen.getByRole('button').querySelector('[data-todo-count]')).toBeNull();
});
it('does not present an unknown count as zero or leak an old service response into the selected service', async () => {
  let finish!: (value: { count: number }) => void;
  api.count.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<TodoNavigationButton placement="toolbar" onOpen={() => {}} />);
  await waitFor(() => expect(api.count).toHaveBeenCalledOnce());
  expect(screen.getByRole('button').getAttribute('aria-description')).toBeNull();
  api.target = 'b'; fireEvent(window, new Event('test:state'));
  await act(async () => { finish({ count: 91 }); });
  expect(screen.queryByText('91')).toBeNull();
  fireEvent(window, new Event('test:ready')); await screen.findByText('7');
});
it('keeps the last confirmed count across a failed refresh and updates on reconnection', async () => {
  render(<TodoNavigationButton placement="toolbar" onOpen={() => {}} />); await screen.findByText('7');
  api.count.mockRejectedValueOnce(Error('offline')); fireEvent(window, new Event('veymux:todos-changed'));
  await act(async () => { await Promise.resolve(); }); expect(screen.getByText('7')).toBeTruthy();
  api.count.mockResolvedValue({ count: 3 }); fireEvent(window, new Event('test:ready')); await screen.findByText('3');
});
