import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { uploadFiles, uploadSessionAttachments } from '../../terminal/api';
import { prepareTerminalClipboardImage } from '../../terminal/clipboardImage';
import { readClipboardContent } from '../../terminal/clipboardContent';
import { escapeShellPath } from '../../desktop/shellPath';
import { selectedTarget } from '../../federation/clientScope';
import { currentSecureClient } from '../../federation/browserIntegration';
import { getActiveKeyboardLayer } from '../../hooks/useKeyboardLayer';
import type { ChatAttachment, ChatInsertionPoint } from './chatComposerContent';
import { useMediaCompressionPreferences, type MediaCompressionPreferences } from '../../terminal/mediaCompressionPreferences';
import { mediaCompressionKind, prepareMediaUpload } from '../../terminal/prepareMediaUpload';
import type { MediaUploadResult } from '../terminal/MediaUploadToast';
interface Options {
  sessionId: string; active: boolean; canWrite: boolean; directory?: string; sessionAttachments?: boolean;
  input: RefObject<HTMLElement>; selection?: () => ChatInsertionPoint; insert: (text: string, focus?: boolean, insertion?: ChatInsertionPoint) => void; error: (message: string) => void;
  attach?: (files: ChatAttachment[], focus: boolean, at: ChatInsertionPoint) => void;
  mediaCompression?: boolean;
}
interface Prepared { prepared: File[]; results: MediaUploadResult[]; preferences: MediaCompressionPreferences }
interface Transfer extends Partial<Prepared> { error?: string; stage: 'reading' | 'compressing' | 'uploading' | 'failed' | 'cancelled'; percent?: number; files?: File[]; paths?: string[]; fileName?: string; fileIndex?: number }
export function useChatInputTransfer(options: Options) {
  const latest = useRef(options); latest.current = options;
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [mediaResult, setMediaResult] = useState<MediaUploadResult | null>(null);
  useEffect(() => setMediaResult(null), [options.sessionId, options.active]);
  const work = useRef<{ controller: AbortController; current: () => boolean; focus: () => boolean; at: ChatInsertionPoint } | null>(null);
  const mounted = useRef(true);
  const begin = useCallback(() => {
    work.current?.controller.abort();
    const scope = latest.current, target = selectedTarget(), client = currentSecureClient(), layer = getActiveKeyboardLayer(), focused = document.activeElement;
    const controller = new AbortController();
    const node = scope.input.current;
    const operation = { controller, at: latest.current.selection?.() ?? { value: node?.textContent ?? '', start: (node?.textContent ?? '').length, end: (node?.textContent ?? '').length }, current: () => mounted.current && !controller.signal.aborted && work.current === operation
      && latest.current.active && latest.current.canWrite && latest.current.sessionId === scope.sessionId
      && selectedTarget() === target && currentSecureClient() === client && !client?.closed && getActiveKeyboardLayer() === layer,
      focus: () => document.activeElement === focused || document.activeElement === scope.input.current || document.activeElement === document.body };
    work.current = operation;
    return operation;
  }, []);
  useEffect(() => {
    const cancelStale = () => { if (work.current && !work.current.current()) { work.current.controller.abort(); work.current = null; setTransfer(null); } };
    cancelStale();
    const revoke = () => { work.current?.controller.abort(); work.current = null; setTransfer(null); setMediaResult(null); };
    window.addEventListener('veymux:secure-state', cancelStale); window.addEventListener('auth:unauthorized', revoke);
    document.addEventListener('focusin', cancelStale);
    return () => { window.removeEventListener('veymux:secure-state', cancelStale); window.removeEventListener('auth:unauthorized', revoke); document.removeEventListener('focusin', cancelStale); };
  }, [options.active, options.canWrite, options.sessionId]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; work.current?.controller.abort(); }; }, []);
  const performUpload = useCallback(async (operation: NonNullable<typeof work.current>, files: File[], paths: string[] = [], previous?: Prepared) => {
    if (!operation.current()) return;
    const preferences = useMediaCompressionPreferences.getState().preferences;
    const reuse = previous && JSON.stringify(previous.preferences) === JSON.stringify(preferences);
    const prepared = reuse ? [...previous.prepared] : [], results = reuse ? [...previous.results] : [];
    const state = (stage: Transfer['stage'], extra: Partial<Transfer> = {}) => {
      if (operation.current()) setTransfer({ stage, files, paths, preferences, prepared: [...prepared], results: [...results], ...extra });
    };
    latest.current.error(''); setMediaResult(null);
    try {
      if (files.length && !latest.current.directory && !latest.current.sessionAttachments) throw new Error('附件上传暂不可用，请重试');
      for (let index = prepared.length; index < files.length; index++) {
        const file = files[index];
        if (latest.current.mediaCompression && mediaCompressionKind(file, preferences)) {
          state('compressing', { fileName: file.name, fileIndex: index + 1 });
          const result = await prepareMediaUpload(file, preferences, operation.current,
            percent => state('compressing', { percent: Math.round(percent), fileName: file.name, fileIndex: index + 1 }));
          if (!operation.current()) return;
          prepared.push(result.file); results.push(result);
        } else prepared.push(file);
      }
      if (!operation.current()) return;
      state('uploading', { percent: files.length ? 0 : undefined });
      const progress = (percent: number) => state('uploading', { percent: Math.round(percent) });
      const result = !files.length ? { files: [] } : latest.current.sessionAttachments
        ? await uploadSessionAttachments(latest.current.sessionId, prepared, operation.controller.signal, progress, operation.current)
        : await uploadFiles(latest.current.directory!, prepared, operation.controller.signal, progress, operation.current);
      if (!operation.current()) return;
      if (result.files.length !== files.length || result.files.some(file => !file.path)) throw new Error('部分文件未上传成功，请重试');
      const references = [...paths, ...result.files.map(file => file.path)];
      if (!references.length) throw new Error('没有可添加的文件');
      if (latest.current.attach) latest.current.attach([
        ...paths.map(path => ({ path, name: path.split('/').pop() || path })),
        ...result.files.map((file, index) => ({ path: file.path, name: prepared[index].name, type: prepared[index].type, size: prepared[index].size })),
      ], operation.focus(), operation.at);
      else latest.current.insert(`${references.map(escapeShellPath).join(' ')} `, operation.focus());
      setMediaResult(results.at(-1) ?? null); setTransfer(null); work.current = null;
    } catch (error) {
      if (!operation.current()) return;
      const message = error instanceof Error ? error.message : '文件处理或上传失败，请重试';
      state('failed', { error: message }); latest.current.error(message);
    }
  }, []);
  const addFiles = useCallback((files: File[]) => {
    if (!latest.current.active || !latest.current.canWrite || !files.length) return;
    void performUpload(begin(), files);
  }, [begin, performUpload]);
  const paste = useCallback(async (eventData?: { files: File[]; text: string }) => {
    if (!latest.current.active || !latest.current.canWrite) return;
    const operation = begin(); setTransfer({ stage: 'reading' }); latest.current.error('');
    const insert = (text: string) => { if (operation.current()) { latest.current.insert(text, operation.focus()); setTransfer(null); work.current = null; } };
    try {
      const content = await readClipboardContent(eventData, operation.current);
      if (content.kind === 'text') { insert(content.text); return; }
      if (content.kind === 'files') {
        const files = content.files.length === 1 && content.files[0].type.startsWith('image/')
          ? [prepareTerminalClipboardImage(content.files[0])] : content.files;
        return await performUpload(operation, files, content.paths);
      }
      throw new Error('剪贴板没有可读取的内容，请使用系统粘贴或选择文件');
    } catch (error) {
      if (operation.current()) { setTransfer(null); latest.current.error(error instanceof Error ? error.message : '粘贴失败，请重试'); }
    }
  }, [begin, performUpload]);
  const cancel = () => { work.current?.controller.abort(); work.current = null; setTransfer(previous => previous ? { ...previous, stage: 'cancelled' } : null); };
  const retry = () => { if (transfer?.files?.length || transfer?.paths?.length) void performUpload(begin(), transfer.files || [], transfer.paths,
    transfer.prepared && transfer.results && transfer.preferences ? { prepared: transfer.prepared, results: transfer.results, preferences: transfer.preferences } : undefined); };
  const dismissMediaResult = useCallback(() => setMediaResult(null), []);
  return { transfer, addFiles, paste, cancel, retry, dismiss: () => setTransfer(null), mediaResult, dismissMediaResult,
    busy: transfer?.stage === 'reading' || transfer?.stage === 'compressing' || transfer?.stage === 'uploading' };
}
