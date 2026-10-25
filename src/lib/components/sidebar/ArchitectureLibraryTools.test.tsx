// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ArchitectureLibraryTools } from './ArchitectureLibraryTools';
import type { ArchitectureDocument } from '../../architecture/model';
import { exportOmmArchitecture } from '../../architecture/native';
import { saveDownloadBlob } from '../../terminal/api';
vi.mock('../../architecture/native', () => ({ exportOmmArchitecture: vi.fn(), architectureHistory: vi.fn() }));
vi.mock('../../terminal/api', () => ({ saveDownloadBlob: vi.fn().mockResolvedValue('saved') }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it.each(['change', 'close', 'hide'])('cancels an archive export after document %s before a late read resolves', async action => {
  let resolve!: (value: Record<string, unknown>) => void;
  vi.mocked(exportOmmArchitecture).mockReturnValue(new Promise(done => { resolve = done; }));
  const props = { root: '/project-a', file: '.omm', document: {} as ArchitectureDocument, onLoaded: vi.fn() };
  const view = render(<ArchitectureLibraryTools {...props} />);
  fireEvent.click(screen.getByText('History, import and sharing'));
  fireEvent.click(screen.getByRole('button', { name: '.omm' }));
  await waitFor(() => expect(exportOmmArchitecture).toHaveBeenCalledOnce());
  if (action === 'change') view.rerender(<ArchitectureLibraryTools {...props} root="/project-b" />);
  else if (action === 'hide') view.rerender(<ArchitectureLibraryTools {...props} active={false} />);
  else view.unmount();
  expect(vi.mocked(exportOmmArchitecture).mock.calls[0][2]?.aborted).toBe(true);
  await act(async () => resolve({ oldDocument: true }));
  expect(saveDownloadBlob).not.toHaveBeenCalled();
});
