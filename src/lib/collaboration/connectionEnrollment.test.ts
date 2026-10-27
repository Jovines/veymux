// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installCollaborationEnrollment } from './connectionEnrollment';

const mocks = vi.hoisted(() => ({
  selected: vi.fn(), active: vi.fn(), open: vi.fn(), read: vi.fn(), list: vi.fn(), observe: vi.fn(),
}));
vi.mock('../federation/browserIntegration', () => ({
  savedConnection: mocks.selected, currentSecureClient: mocks.active,
  openAuthorizedServiceClient: mocks.open, readPinnedCollaborationDescriptor: mocks.read,
  SECURE_STATE_EVENT: 'veymux:secure-state',
}));
vi.mock('../services/serviceDirectory', () => ({ listServiceConnections: mocks.list, observeServiceConnections: mocks.observe }));

const a = { serviceId: 'A', origin: 'https://a.internal' };
const b = { serviceId: 'B', origin: 'https://b.internal' };
const bookmark = (node: typeof a) => ({ id: node.serviceId, targetPeerId: node.serviceId, url: node.origin, label: node.serviceId });
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
afterEach(() => { window.dispatchEvent(new Event('pagehide')); delete window.veymuxDesktop; vi.useRealTimers(); });

function fixture(onlyLocal = false) {
  const own = onlyLocal ? a : b;
  const shared: Record<string, typeof a> = onlyLocal ? {} : { A: a };
  const fetch = vi.fn(async (_path: string, options?: RequestInit) => Response.json(options?.method ? { ok: true } : { csrfToken: 'csrf' }));
  const client = { closed: false, request: vi.fn(async () => ({ node: own })), fetch };
  let changed = () => {};
  mocks.selected.mockReturnValue(bookmark(own)); mocks.active.mockReturnValue(client);
  mocks.list.mockResolvedValue(onlyLocal ? [bookmark(a)] : [bookmark(a), bookmark(b)]);
  mocks.observe.mockImplementation(callback => { changed = callback; return () => {}; });
  mocks.read.mockRejectedValue(new TypeError('This service window has no route to that origin'));
  mocks.open.mockRejectedValue(new Error('Other window has its own authorization'));
  const remember = vi.fn(async (node: typeof a) => { shared[node.serviceId] = node; });
  Object.assign(window, { veymuxDesktop: { platform: 'darwin', collaborationDescriptors: async () => shared, rememberCollaborationDescriptor: remember } });
  const posts = () => fetch.mock.calls.filter(([, options]) => options?.method === 'POST');
  return { client, shared, remember, posts, changed: () => changed() };
}

it('enrolls the current service using public metadata from another native window without a cross-window socket', async () => {
  const f = fixture(); installCollaborationEnrollment();
  await vi.advanceTimersByTimeAsync(100);
  expect(f.remember).toHaveBeenCalledWith(b);
  expect(mocks.read).not.toHaveBeenCalled();
  expect(f.posts()).toHaveLength(1);
  expect(JSON.parse(String(f.posts()[0][1]?.body))).toEqual({ origin: b.origin, nodes: [a, b] });
});

it('publishes a lone local service before a peer is added, then enrolls after the other window publishes', async () => {
  const f = fixture(true); installCollaborationEnrollment();
  await vi.advanceTimersByTimeAsync(100);
  expect(f.remember).toHaveBeenCalledWith(a);
  expect(f.posts()).toHaveLength(0);
  f.shared.B = b; mocks.list.mockResolvedValue([bookmark(a), bookmark(b)]); f.changed();
  await vi.advanceTimersByTimeAsync(100);
  expect(f.remember).toHaveBeenCalledOnce();
  expect(mocks.read).not.toHaveBeenCalled();
  expect(JSON.parse(String(f.posts()[0][1]?.body))).toEqual({ origin: a.origin, nodes: [a, b] });
});

it('does not enroll a removed bookmark merely because cached public metadata remains', async () => {
  const f = fixture(true); f.shared.B = b; installCollaborationEnrollment();
  await vi.advanceTimersByTimeAsync(100);
  expect(f.posts()).toHaveLength(0);
});

it('rejects metadata with a different pinned identity', async () => {
  const f = fixture(); f.shared.A = b; installCollaborationEnrollment();
  await vi.advanceTimersByTimeAsync(100);
  expect(f.posts()).toHaveLength(0);
  expect(f.remember).toHaveBeenCalledWith(b);
});

it('preserves encrypted discovery for clients without native public metadata support', async () => {
  const f = fixture(); delete window.veymuxDesktop;
  mocks.read.mockResolvedValue(a); installCollaborationEnrollment();
  await vi.advanceTimersByTimeAsync(100);
  expect(mocks.read).toHaveBeenCalledOnce();
  expect(f.posts()).toHaveLength(1);
});
