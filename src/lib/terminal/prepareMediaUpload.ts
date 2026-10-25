import type { MediaCompressionPreferences } from './mediaCompressionPreferences';
import type { MediaUploadResult } from '../components/terminal/MediaUploadToast';

export function mediaCompressionKind(file: File, preferences: MediaCompressionPreferences): 'image' | 'video' | null {
  if (preferences.videoEnabled && file.type.startsWith('video/')) return 'video';
  if (preferences.imageEnabled && (/\.(?:jpe?g|png|heic|heif)$/i.test(file.name)
    || /^(?:image\/jpeg|image\/png|image\/heic|image\/heif)$/i.test(file.type))) return 'image';
  return null;
}

/** Reuse the terminal's device preferences and local encoders. A cancelled or
 * stale preparation never gets as far as a business upload. */
export async function prepareMediaUpload(file: File, preferences: MediaCompressionPreferences, current: () => boolean,
  progress: (percent: number) => void): Promise<MediaUploadResult> {
  const kind = mediaCompressionKind(file, preferences);
  if (!kind) throw new Error('此文件不需要媒体压缩');
  const check = () => { if (!current()) throw new DOMException('Cancelled', 'AbortError'); };
  check();
  const encoded = kind === 'video'
    ? await (await import('./videoCompression')).compressVideoLocally(file, {
      maxHeight: preferences.videoMaxHeight, videoBitrate: preferences.videoBitrate,
      onProgress: percent => { if (current()) progress(percent); },
    })
    : await (await import('./imageCompression')).compressImageLocally(file, {
      maxDimension: preferences.imageMaxDimension, quality: preferences.imageQuality,
    });
  check();
  return { file: encoded, kind, originalSize: file.size, uploadedSize: encoded.size, originalRetained: encoded === file };
}
