import { expect, it, vi } from 'vitest';
import { createToolbarPresetWriter } from './toolbarPresetWriter';
import { createDefaultToolbarPresets } from '../components/terminal/mobileKeyboardPresets';

it('serializes saves, coalesces rapid edits and advances the revision before saving again', async () => {
  let resolve!: (value: { updatedAt: number }) => void;
  let revision = 1;
  const save = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    )
    .mockImplementation(async () => ({ updatedAt: revision + 1 }));
  const state = vi.fn(),
    acknowledged = vi.fn((updatedAt: number | undefined) => {
      revision = updatedAt!;
    });
  const writer = createToolbarPresetWriter({ save, state, acknowledged });
  const first = createDefaultToolbarPresets(),
    last = [...first.slice(0, 2)];
  writer.enqueue(first);
  writer.enqueue(first.slice(0, 3));
  writer.enqueue(last);
  expect(save).toHaveBeenCalledTimes(1);
  resolve({ updatedAt: 2 });
  await vi.waitFor(() => expect(writer.dirty()).toBe(false));
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1][0]).toEqual(last);
  expect(acknowledged.mock.calls.map((call) => call[0])).toEqual([2, 3]);
  expect(state.mock.calls.at(-1)).toEqual(['saved']);
});
it('keeps unsaved changes for retry and stops on a server conflict', async () => {
  const state = vi.fn(),
    acknowledged = vi.fn();
  const save = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ updatedAt: 2 });
  const writer = createToolbarPresetWriter({ save, state, acknowledged });
  const presets = createDefaultToolbarPresets();
  writer.enqueue(presets);
  await vi.waitFor(() => expect(state).toHaveBeenLastCalledWith('error'));
  expect(writer.dirty()).toBe(true);
  writer.retry();
  await vi.waitFor(() => expect(state).toHaveBeenLastCalledWith('saved'));
  expect(save.mock.calls[1][0]).toEqual(presets);
  save.mockRejectedValueOnce(Object.assign(new Error('conflict'), { current: { updatedAt: 9 } }));
  writer.enqueue(presets);
  await vi.waitFor(() => expect(state).toHaveBeenLastCalledWith('conflict'));
  writer.retry();
  expect(save).toHaveBeenCalledTimes(3);
  writer.reset();
  expect(writer.dirty()).toBe(false);
});
