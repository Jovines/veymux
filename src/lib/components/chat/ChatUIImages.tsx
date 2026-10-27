import { createContext, useContext, useMemo, useState } from 'react';
import type { ComponentRenderProps } from '@openuidev/react-lang';
import { useChatImageLightbox } from './useChatImagePreview';

type ImageItem = { src: string; alt: string; details?: string };
export const ChatUIMediaRetryContext = createContext(() => {});
export const ChatUIImageChoiceContext = createContext(false);

function ImageButton({ image, gallery, open }: { image: ImageItem; gallery: boolean; open: () => void }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const retry = useContext(ChatUIMediaRetryContext);
  return <div className="min-w-0">
    <button type="button" aria-label={`查看图片：${image.alt}`} onClick={open}
      className="block min-h-11 w-full overflow-hidden rounded-xl border border-border bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
      <img src={image.src} alt={image.alt} decoding="async" onLoad={() => setStatus('ready')} onError={() => setStatus('error')}
        className={`mx-auto block h-auto max-w-full object-contain ${gallery ? 'max-h-64' : 'max-h-[60dvh]'} ${status === 'error' ? 'hidden' : ''}`} />
      {status === 'loading' && <span role="status" className="block p-3 text-xs text-muted-foreground">正在加载图片…</span>}
    </button>
    {status === 'error' && <div role="alert" className="flex items-center justify-between gap-2 p-2 text-xs text-destructive">
      <span>图片加载失败</span><button type="button" className="min-h-11 rounded-lg px-3 text-foreground hover:bg-surface-2" onClick={retry}>重试</button>
    </div>}
    {image.details && <p className="mt-2 text-xs text-muted-foreground">{image.details}</p>}
  </div>;
}

/** Receives only sources prepared by MediaComponent: private paths are blob
 * URLs by this point, so neither thumbnails nor the lightbox bypass fetch. */
export function ChatUIImages({ props }: ComponentRenderProps) {
  const choice = useContext(ChatUIImageChoiceContext);
  const gallery = Array.isArray(props.images);
  const images = useMemo<ImageItem[]>(() => {
    const values = Array.isArray(props.images) ? props.images : [{ src: props.src, alt: props.alt }];
    return values.flatMap((value, index) => {
      if (!value || typeof value !== 'object' || !('src' in value) || typeof value.src !== 'string' || !value.src) return [];
      const alt = 'alt' in value && typeof value.alt === 'string' && value.alt ? value.alt : `图片 ${index + 1}`;
      return [{ src: value.src, alt, details: 'details' in value && typeof value.details === 'string' ? value.details : undefined }];
    });
  }, [props.images, props.src, props.alt]);
  const previews = useMemo(() => images.map(image => ({ kind: 'image' as const, src: image.src, alt: image.alt, title: image.alt })), [images]);
  const lightbox = useChatImageLightbox(previews);
  return <>
    <div className={gallery ? 'grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3' : 'min-w-0'}>
      {images.map((image, index) => choice
        ? <img key={`${image.src}:${index}`} src={image.src} alt={image.alt} className="mx-auto block h-auto max-h-64 max-w-full object-contain" />
        : <ImageButton key={`${image.src}:${index}`} image={image} gallery={gallery} open={() => lightbox.open(image.src)} />)}
    </div>
    {lightbox.preview}
  </>;
}
