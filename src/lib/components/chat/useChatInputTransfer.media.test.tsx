// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ upload: vi.fn(), image: vi.fn(), video: vi.fn() }));
vi.mock('../../terminal/api', () => ({ uploadFiles: mocks.upload, uploadSessionAttachments: mocks.upload }));
vi.mock('../../terminal/imageCompression', () => ({ compressImageLocally: mocks.image }));
vi.mock('../../terminal/videoCompression', () => ({ compressVideoLocally: mocks.video }));
vi.mock('../../federation/browserIntegration', () => ({ currentSecureClient: () => undefined }));
vi.mock('../../federation/clientScope', () => ({ selectedTarget: () => undefined }));
import { useChatInputTransfer } from './useChatInputTransfer';
import { useMediaCompressionPreferences } from '../../terminal/mediaCompressionPreferences';
const initial = { ...useMediaCompressionPreferences.getState().preferences };
const original = () => new File(['original image data'], 'photo.png', { type: 'image/png' });
const encoded = () => new File(['webp'], 'photo-compressed.webp', { type: 'image/webp' });
beforeEach(() => {
  vi.resetAllMocks();
  useMediaCompressionPreferences.setState({ preferences: { ...initial, imageEnabled: true, videoEnabled: false } });
  mocks.image.mockResolvedValue(encoded());
  mocks.upload.mockImplementation(async (_target, files: File[]) => ({ files: files.map(file => ({ path: `/tmp/${file.name}` })) }));
});
afterEach(() => { cleanup(); useMediaCompressionPreferences.setState({ preferences: initial }); });
function fixture(shared = false) {
  const attach = vi.fn(), error = vi.fn(), insert = vi.fn();
  const input = { current: document.createElement('div') };
  document.body.append(input.current);
  const hook = renderHook(({ active }) => useChatInputTransfer({ sessionId: 'target', active, canWrite: true, mediaCompression: true,
    ...(shared ? { sessionAttachments: true } : { directory: '/tmp' }), input, attach, insert, error }), { initialProps: { active: true } });
  return { ...hook, attach, error };
}
it.each([false, true])('uploads the encoded bytes and attaches the actual filename, MIME type and size (shared %s)', async shared => {
  const f = fixture(shared), file = original(); act(() => f.result.current.addFiles([file]));
  await waitFor(() => expect(f.attach).toHaveBeenCalledOnce());
  const uploaded = mocks.upload.mock.calls[0][1][0] as File;
  expect(uploaded.name).toBe('photo-compressed.webp'); expect(uploaded.type).toBe('image/webp');
  expect(f.attach.mock.calls[0][0]).toEqual([{ path: '/tmp/photo-compressed.webp', name: uploaded.name, type: uploaded.type, size: uploaded.size }]);
  expect(f.result.current.mediaResult).toMatchObject({ originalSize: file.size, uploadedSize: uploaded.size, kind: 'image' });
  expect(mocks.upload.mock.calls[0][0]).toBe(shared ? 'target' : '/tmp');
});
it('does not upload an original silently when compression fails, and retries using a changed compression preference', async () => {
  mocks.image.mockRejectedValueOnce(new Error('Cannot decode image'));
  const f = fixture(), file = original(); act(() => f.result.current.addFiles([file]));
  await waitFor(() => expect(f.result.current.transfer?.stage).toBe('failed'));
  expect(mocks.upload).not.toHaveBeenCalled(); expect(f.attach).not.toHaveBeenCalled();
  act(() => useMediaCompressionPreferences.setState({ preferences: { ...initial, imageEnabled: false } }));
  act(() => f.result.current.retry()); await waitFor(() => expect(f.attach).toHaveBeenCalledOnce());
  expect(mocks.upload.mock.calls[0][1]).toEqual([file]); expect(mocks.image).toHaveBeenCalledOnce();
});
it('reuses prepared media after an upload failure and reports processing success only after upload and attachment insertion', async () => {
  mocks.upload.mockRejectedValueOnce(new Error('Disconnected'));
  const f = fixture(); act(() => f.result.current.addFiles([original()]));
  await waitFor(() => expect(f.result.current.transfer?.stage).toBe('failed'));
  expect(f.result.current.mediaResult).toBeNull(); expect(f.attach).not.toHaveBeenCalled();
  act(() => f.result.current.retry()); await waitFor(() => expect(f.attach).toHaveBeenCalledOnce());
  expect(mocks.image).toHaveBeenCalledOnce(); expect(mocks.upload).toHaveBeenCalledTimes(2);
  expect(f.result.current.mediaResult?.file.name).toBe('photo-compressed.webp');
});
it('cancels during encoding and ignores a late completion, while retaining a retryable original', async () => {
  let finish!: (file: File) => void; mocks.image.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const f = fixture(); act(() => f.result.current.addFiles([original()]));
  await waitFor(() => expect(mocks.image).toHaveBeenCalledOnce());
  expect(f.result.current.transfer?.stage).toBe('compressing');
  act(() => f.result.current.cancel()); expect(f.result.current.busy).toBe(false);
  await act(async () => finish(encoded())); expect(mocks.upload).not.toHaveBeenCalled(); expect(f.attach).not.toHaveBeenCalled();
  expect(f.result.current.transfer?.stage).toBe('cancelled');
  act(() => f.result.current.retry()); await waitFor(() => expect(f.attach).toHaveBeenCalledOnce());
});
it('discards encoded media if the Session becomes inactive before processing finishes', async () => {
  let finish!: (file: File) => void; mocks.image.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const f = fixture(); act(() => f.result.current.addFiles([original()])); await waitFor(() => expect(mocks.image).toHaveBeenCalledOnce());
  f.rerender({ active: false }); await act(async () => finish(encoded()));
  expect(mocks.upload).not.toHaveBeenCalled(); expect(f.attach).not.toHaveBeenCalled(); expect(f.result.current.transfer).toBeNull();
});
it('preserves completed media preparations when a later file fails, without inserting a partial batch', async () => {
  mocks.image.mockResolvedValueOnce(encoded()).mockRejectedValueOnce(new Error('Second image failed')).mockResolvedValueOnce(new File(['jpg'], 'other-compressed.jpg', { type: 'image/jpeg' }));
  const f = fixture(); act(() => f.result.current.addFiles([original(), new File(['other photo'], 'other.jpg', { type: 'image/jpeg' })]));
  await waitFor(() => expect(f.result.current.transfer?.stage).toBe('failed'));
  expect(mocks.upload).not.toHaveBeenCalled(); expect(f.attach).not.toHaveBeenCalled();
  act(() => f.result.current.retry()); await waitFor(() => expect(f.attach).toHaveBeenCalledOnce());
  expect(mocks.image).toHaveBeenCalledTimes(3); expect(f.attach.mock.calls[0][0]).toHaveLength(2);
});
it('keeps GIFs and non-media files unchanged, and applies the terminal video settings to videos', async () => {
  useMediaCompressionPreferences.setState({ preferences: { ...initial, imageEnabled: true, videoEnabled: true } });
  mocks.video.mockResolvedValue(new File(['mp4'], 'clip-compressed.mp4', { type: 'video/mp4' }));
  const f = fixture(), gif = new File(['animation'], 'a.gif', { type: 'image/gif' }), text = new File(['text'], 'a.txt');
  act(() => f.result.current.addFiles([gif, text, new File(['video'], 'clip.mov', { type: 'video/quicktime' })]));
  await waitFor(() => expect(f.attach).toHaveBeenCalledOnce());
  expect(mocks.image).not.toHaveBeenCalled(); expect(mocks.video.mock.calls[0][1]).toMatchObject({ maxHeight: initial.videoMaxHeight, videoBitrate: initial.videoBitrate });
  expect(mocks.upload.mock.calls[0][1].slice(0, 2)).toEqual([gif, text]);
});
