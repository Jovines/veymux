// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TmuxRecoveryNotice } from './TmuxRecoveryNotice';
import type { SessionInventory } from '../terminal/types';

afterEach(cleanup);
const recovery: NonNullable<SessionInventory['tmuxRecovery']> = { id: 'incident', detectedAt: 1,
  sessions: [{ sessionId: 'opaque-id', name: '修复侧栏布局', tmuxSessionName: 'internal-name', cwd: '/work', agentSlug: 'codex', agentDisplayName: 'Codex' }] };
const callbacks = () => ({ pending: null, error: null, onRestore: vi.fn(), onPause: vi.fn(), onDismiss: vi.fn() });
it('keeps the original conversation name and one clear restore action visible', () => {
  localStorage.setItem('veymux:locale', 'en');
  const props = callbacks(); render(<TmuxRecoveryNotice recovery={recovery} {...props} />);
  expect(screen.getByText('修复侧栏布局')).toBeTruthy();
  expect(screen.queryByText('opaque-id')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Restore all' }));
  expect(props.onRestore).toHaveBeenCalledOnce();
});
it('shows verified progress, allows pause, and keeps diagnostics behind disclosure', () => {
  const operation = { id: 'op', state: 'running' as const, total: 1, queued: 0, paused_count: 0, resource_wait: 0, running: 1,
    succeeded: 0, failed: 0, paused: false, counts: { total: 1, queued: 0, running: 1, succeeded: 0, failed: 0, paused: 0 },
    items: [{ sessionId: 'opaque-id', state: 'running', phase: 'verifying_agent' }] };
  const props = callbacks(); render(<TmuxRecoveryNotice recovery={{ ...recovery, operation }} {...props} />);
  expect(screen.getByRole('progressbar').getAttribute('value')).toBe('0');
  expect(screen.getByRole('button', { name: 'Recovery in progress' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Pause' })); expect(props.onPause).toHaveBeenCalledOnce();
  expect(screen.getByText('Recovery details').closest('details')?.open).toBe(false);
});
it('keeps a failed recovery actionable with its diagnostic reason available', () => {
  const props = callbacks(); render(<TmuxRecoveryNotice recovery={recovery} {...props} error="Recovery failed. Check the terminals and try again." />);
  expect(screen.getByRole('button', { name: 'Restore all' }).hasAttribute('disabled')).toBe(false);
  expect(screen.getAllByRole('alert').length).toBe(2);
});

it('acknowledges verified recovery without offering to launch the conversations again', () => {
  const props = callbacks();
  const operation = { id: 'op', state: 'succeeded' as const, total: 1, queued: 0, paused_count: 0, resource_wait: 0, running: 0,
    succeeded: 1, failed: 0, paused: false, counts: { total: 1, queued: 0, running: 0, succeeded: 1, failed: 0, paused: 0 },
    items: [{ sessionId: 'opaque-id', state: 'succeeded', phase: 'completed' }] };
  render(<TmuxRecoveryNotice recovery={{ ...recovery, operation }} {...props} />);
  expect(screen.getByRole('status').getAttribute('aria-label')).toBe('1 original conversations reconnected');
  expect(screen.queryByRole('button', { name: 'Restore all' })).toBeNull();
  expect(screen.getByText('Affected conversations').closest('details')?.open).toBe(false);
});

it('opens the exact failed terminal and presents retry as an action', () => {
  const props = callbacks(), open = vi.fn();
  const operation = { id: 'op', state: 'partial_failure' as const, total: 1, queued: 0, paused_count: 0, resource_wait: 0, running: 0,
    succeeded: 0, failed: 1, paused: false, counts: { total: 1, queued: 0, running: 0, succeeded: 0, failed: 1, paused: 0 },
    items: [{ sessionId: 'opaque-id', state: 'failed', phase: 'verifying_agent', errorCode: 'RECOVERY_AGENT_UNCONFIRMED' }] };
  render(<TmuxRecoveryNotice recovery={{ ...recovery, operation }} {...props} onOpenSession={open} />);
  fireEvent.click(screen.getByRole('button', { name: 'View terminal' }));
  expect(open).toHaveBeenCalledWith('opaque-id');
  expect(screen.queryByRole('button', { name: 'Retry failed sessions' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Return to recovery' }));
  fireEvent.click(screen.getByRole('button', { name: 'Retry failed sessions' }));
  expect(props.onRestore).toHaveBeenCalledOnce();
});
