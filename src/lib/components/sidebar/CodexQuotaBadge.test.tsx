// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CodexQuotaBadge } from './CodexQuotaBadge';
import { fetchQuota, type QuotaResult, type QuotaStatus } from '../../terminal/api';

vi.mock('../../terminal/api', () => ({ fetchQuota: vi.fn() }));
vi.mock('../../i18n', () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) =>
    key === 'quota.left' ? `${params?.n} left` : key }),
}));

const codex = (usagePercent: number): QuotaResult => ({
  slug: 'codex', displayName: 'Codex', usagePercent, entitlement: 100,
  remaining: 100 - usagePercent, windows: [], fetchedAt: Date.now(),
});
const status = (provider: QuotaResult): QuotaStatus => ({ providers: [provider], updatedAt: Date.now() });
const broadcast = (providers: QuotaResult[]) => act(() => {
  window.dispatchEvent(new CustomEvent('termdock:quota-update', { detail: providers }));
});

beforeEach(() => { vi.mocked(fetchQuota).mockReset(); });
afterEach(cleanup);

describe('CodexQuotaBadge', () => {
  it('shows remaining percentage rather than usage and opens the existing quota panel', async () => {
    vi.mocked(fetchQuota).mockResolvedValue(status(codex(30)));
    const onOpen = vi.fn();
    render(<CodexQuotaBadge onOpen={onOpen} />);
    const badge = await screen.findByRole('button', { name: /70% left/ });
    expect(badge.textContent).toBe('70% left');
    fireEvent.click(badge);
    expect(onOpen).toHaveBeenCalledOnce();
    broadcast([codex(100)]);
    expect(screen.getByRole('button', { name: /0% left/ }).textContent).toBe('0% left');
  });

  it('keeps a live update when an older initial request finishes later', async () => {
    let resolve!: (value: QuotaStatus) => void;
    vi.mocked(fetchQuota).mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<CodexQuotaBadge onOpen={vi.fn()} />);
    broadcast([codex(40)]);
    await act(async () => { resolve(status(codex(10))); });
    expect(screen.getByRole('button').textContent).toBe('60% left');
  });

  it('retains the last observed value on connection failure and hides unavailable providers', async () => {
    vi.mocked(fetchQuota).mockResolvedValue(status(codex(30)));
    render(<CodexQuotaBadge onOpen={vi.fn()} />);
    await screen.findByRole('button');
    vi.mocked(fetchQuota).mockImplementation(async () => { throw new Error('offline'); });
    await act(async () => { fireEvent.focus(window); });
    expect(screen.getByRole('button').textContent).toBe('70% left');
    broadcast([{ ...codex(0), error: 'expired token' }]);
    expect(screen.queryByRole('button')).toBeNull();
    broadcast([]);
    expect(screen.queryByRole('button')).toBeNull();
    broadcast([codex(0)]);
    expect(screen.getByRole('button').textContent).toBe('100% left');
  });
});
