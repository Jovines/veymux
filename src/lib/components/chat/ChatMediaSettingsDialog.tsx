import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { getActiveKeyboardLayer, useKeyboardLayer } from '../../hooks/useKeyboardLayer';
import { useMediaCompressionPreferences } from '../../terminal/mediaCompressionPreferences';
import { IMAGE_DIMENSIONS, VIDEO_DIMENSIONS, IMAGE_QUALITY, VIDEO_BITRATE, type ImageDimension, type VideoDimension } from '../../terminal/mediaCompressionOptions';
import type { VideoCompressionPreparationState } from '../../terminal/videoCompression';

export function ChatMediaSettingsDialog({ close }: { close: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const { preferences: p, update, saveFailed } = useMediaCompressionPreferences();
  const [preparation, setPreparation] = useState<VideoCompressionPreparationState | null>(null), [error, setError] = useState('');
  useKeyboardLayer(panel, true, close);
  useEffect(() => {
    if (!p.videoEnabled) return;
    let active = true; setError(''); setPreparation(null);
    void import('../../terminal/videoCompression').then(module => module.prepareLocalVideoCompression(state => {
      if (active) setPreparation(state);
    })).catch(failure => { if (active) setError(failure instanceof Error ? failure.message : '转码器准备失败'); });
    return () => { active = false; };
  }, [p.videoEnabled]);
  const field = 'mt-1 block min-h-11 w-full rounded-lg bg-surface-2 px-3 text-sm text-foreground';
  const toggle = 'flex min-h-11 items-center justify-between gap-3 rounded-xl bg-surface-elevated px-3 text-sm';
  const preparationText = !preparation ? '正在检查本机转码器缓存…'
    : preparation.phase === 'loading' ? `正在加载转码器… ${preparation.progress ?? 0}%`
      : preparation.phase === 'saving' ? '加载完成，正在保存到本机…'
        : preparation.phase === 'initializing' ? '正在初始化本地转码器…'
          : preparation.phase === 'ready' ? '本地转码器已就绪' : '正在检查本机转码器缓存…';
  return createPortal(<div data-sidebar-gesture-ignore className="fixed inset-0 z-modal-backdrop flex items-center justify-center bg-[var(--app-backdrop)] preview-safe-area [--preview-safe-area-gap:0.5rem] sm:[--preview-safe-area-gap:1.5rem]"
    onDragOver={event => event.stopPropagation()} onDrop={event => { event.preventDefault(); event.stopPropagation(); }}
    onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <div ref={panel} role="dialog" aria-modal="true" aria-label="媒体压缩设置" tabIndex={-1}
      onKeyDown={event => {
        // The retained chat workspace stops bubbling keyboard events. Handle
        // only this layer's Escape before that ancestor can swallow it.
        if (event.key === 'Escape' && !event.defaultPrevented && !event.nativeEvent.isComposing && getActiveKeyboardLayer()?.element === panel.current) {
          event.preventDefault(); event.stopPropagation(); close();
        }
      }}
      className="z-modal-panel flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-surface text-foreground shadow-xl">
      <header className="flex shrink-0 items-center gap-3 border-b border-border/30 p-3"><h2 className="flex-1 text-sm font-semibold">媒体压缩设置</h2><button type="button" aria-label="关闭媒体压缩设置" className="inline-flex h-11 w-11 items-center justify-center rounded-lg hover:bg-surface-2" onClick={close}><X size={18} /></button></header>
      <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain p-4">
        <p className="text-xs leading-6 text-muted-foreground">与终端共用本机设置。开启对应选项后，先在本机处理再上传；原文件保持不变。</p>
        {saveFailed && <p role="alert" className="text-xs text-destructive">设置未能保存，重新打开后可能恢复默认值。</p>}
        <label className={toggle}><span>显示压缩结果提示</span><input className="h-4 w-4 accent-primary" type="checkbox" checked={p.showResultToast} onChange={event => update({ showResultToast: event.target.checked })} /></label>
        <label className={toggle}><span>压缩图片后上传</span><input className="h-4 w-4 accent-primary" type="checkbox" checked={p.imageEnabled} onChange={event => update({ imageEnabled: event.target.checked })} /></label>
        {p.imageEnabled && <div className="space-y-3"><label className="block text-xs text-muted-foreground">图片最长边<select className={field} value={p.imageMaxDimension} onChange={event => update({ imageMaxDimension: Number(event.target.value) as ImageDimension })}>{IMAGE_DIMENSIONS.map(size => <option key={size} value={size}>{size} px</option>)}</select></label>
          <label className="block text-xs text-muted-foreground">图片画质：{Math.round(p.imageQuality * 100)}%<input aria-label="图片画质" type="range" min={IMAGE_QUALITY.min} max={IMAGE_QUALITY.max} step={IMAGE_QUALITY.step} value={p.imageQuality} onChange={event => update({ imageQuality: Number(event.target.value) })} className="mt-2 w-full accent-primary" /></label>
          <p className="text-xs leading-6 text-muted-foreground">支持 JPEG、PNG、HEIC 照片；GIF、SVG 等保持原文件。压缩后未变小会保留原图。</p></div>}
        <label className={toggle}><span>压缩视频后上传</span><input className="h-4 w-4 accent-primary" type="checkbox" checked={p.videoEnabled} onChange={event => update({ videoEnabled: event.target.checked })} /></label>
        {p.videoEnabled && <div className="space-y-3"><label className="block text-xs text-muted-foreground">视频最长边<select className={field} value={p.videoMaxHeight} onChange={event => update({ videoMaxHeight: Number(event.target.value) as VideoDimension })}>{VIDEO_DIMENSIONS.map(size => <option key={size} value={size}>{size} px</option>)}</select></label>
          <label className="block text-xs text-muted-foreground">目标视频码率：{p.videoBitrate / 1_000_000} Mbps<input aria-label="目标视频码率" type="range" min={VIDEO_BITRATE.min} max={VIDEO_BITRATE.max} step={VIDEO_BITRATE.step} value={p.videoBitrate} onChange={event => update({ videoBitrate: Number(event.target.value) })} className="mt-2 w-full accent-primary" /></label>
          <p role="status" className="text-xs leading-6 text-muted-foreground">{error ? '转码器准备失败，可关闭视频压缩后重试。' : preparationText}</p>
          {preparation?.saved === false && <p className="text-xs text-muted-foreground">转码器未能保存到本机，下次可能需要重新加载。</p>}
          {error && <p role="alert" className="break-words text-xs text-destructive">{error}</p>}</div>}
      </div>
      <footer className="shrink-0 border-t border-border/30 p-3 text-right"><button type="button" className="min-h-11 rounded-lg bg-surface-2 px-4 text-sm hover:bg-surface-elevated" onClick={close}>完成</button></footer>
    </div>
  </div>, document.body);
}
