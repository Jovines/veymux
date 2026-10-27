import { StrictMode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import '../../../index.css';
import { ArchitectureLibraryTools } from '../sidebar/ArchitectureLibraryTools';
import { ArchitectureGenerationForm } from '../sidebar/ArchitectureGenerationForm';
import { DEFAULT_ANALYSIS, type ArchitectureDocument } from '../../architecture/model';
import { exportOmmArchitecture } from '../../architecture/native';
import { saveDownloadBlob } from '../../terminal/api';
import type { VeymuxDesktopBridge } from '../../desktop/nativeBridge';

vi.mock('../../architecture/native', () => ({ exportOmmArchitecture: vi.fn(), architectureHistory: vi.fn(), importOmmArchitecture: vi.fn(), saveNativeArchitecture: vi.fn(), readNativeArchitecture: vi.fn(), writeArchitectureField: vi.fn(), listNativeArchitectures: vi.fn() }));
vi.mock('../../terminal/api', async original => ({ ...await original<typeof import('../../terminal/api')>(), saveDownloadBlob: vi.fn() }));
let root: Root | undefined;
const desktop = window.veymuxDesktop;
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('veymux:locale', 'en'); vi.mocked(saveDownloadBlob).mockResolvedValue('saved'); });
afterEach(() => { root?.unmount(); document.body.replaceChildren(); window.veymuxDesktop = desktop; vi.clearAllMocks(); });
function mount(content: React.ReactNode) {
  const host = document.createElement('div'); document.body.append(host);
  root = createRoot(host); flushSync(() => root!.render(<StrictMode>{content}</StrictMode>));
}

it.each([1440, 390])('uses the same native copy result for architecture prompts at %s px', async width => {
  await page.viewport(width, 844);
  const writeClipboardText = vi.fn().mockResolvedValue(undefined), prepared = vi.fn();
  window.veymuxDesktop = { writeClipboardText } as unknown as VeymuxDesktopBridge;
  mount(<ArchitectureGenerationForm rootPath="/project" initial={DEFAULT_ANALYSIS} onInsertPrompt={vi.fn()} onPrepared={prepared} onClose={vi.fn()} />);
  await page.getByRole('button', { name: 'Copy prompt', exact: true }).click();
  await expect.poll(() => prepared.mock.calls.length).toBe(1);
  expect(writeClipboardText).toHaveBeenCalledOnce();
  writeClipboardText.mockRejectedValueOnce(new Error('native clipboard unavailable'));
  await page.getByRole('button', { name: 'Copy prompt', exact: true }).click();
  await expect.element(page.getByRole('status')).toHaveTextContent(/copy|clipboard/i);
  expect(prepared).toHaveBeenCalledTimes(1);
});

it.each([1440, 390])('cancels an old document export and permits exporting the new document at %s px', async width => {
  await page.viewport(width, 844);
  let resolve!: (value: Record<string, unknown>) => void;
  vi.mocked(exportOmmArchitecture).mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValue({ format: 'veymux-omm-bundle' });
  function Harness() {
    const [project, setProject] = useState('/project-a');
    return <><button onClick={() => setProject('/project-b')}>Switch project</button><ArchitectureLibraryTools root={project} file=".omm" document={{} as ArchitectureDocument} onLoaded={vi.fn()} /></>;
  }
  mount(<Harness />);
  await page.getByText('History, import and sharing', { exact: true }).click();
  await page.getByRole('button', { name: '.omm', exact: true }).click();
  await expect.poll(() => vi.mocked(exportOmmArchitecture).mock.calls.length).toBe(1);
  const signal = vi.mocked(exportOmmArchitecture).mock.calls[0][2]!;
  await expect.element(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Switch project', exact: true }).click();
  expect(signal.aborted).toBe(true);
  resolve({ oldDocument: true });
  await page.getByRole('button', { name: '.omm', exact: true }).click();
  await expect.poll(() => vi.mocked(saveDownloadBlob).mock.calls.length).toBe(1);
  expect(vi.mocked(exportOmmArchitecture).mock.calls[1][0]).toBe('/project-b');
});
