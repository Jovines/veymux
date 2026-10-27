/** Explicit reply association; never inferred from the order of messages. */
export interface ChatReplyContext { id: string; text: string; createdAt: number }

/** A short question excerpt without attachment envelopes or quoted earlier text. */
export function chatReplyExcerpt(content: string): string {
  let text = content;
  let files: { name: string; reference?: string }[] = [];
  const marker = '```veymux-context\n', at = content.lastIndexOf(marker);
  if (at >= 0 && (at === 0 || content.slice(0, at).endsWith('\n\n')) && content.endsWith('\n```')) {
    try {
      const value = JSON.parse(content.slice(at + marker.length, -4));
      if (Array.isArray(value?.attachments) && Array.isArray(value?.mentions)
        && value.attachments.every((file: unknown) => !!file && typeof file === 'object' && typeof (file as { name?: unknown }).name === 'string' && typeof (file as { path?: unknown }).path === 'string')) {
        files = value.attachments;
        text = content.slice(0, at ? at - 2 : 0);
      }
    } catch { /* Literal or malformed code remains ordinary message text. */ }
  }
  text = text.replace(/^> [^\n]+ · \d{2}:\d{2}\n(?:>[^\n]*\n)+\n/, '');
  text = text.replace(/【([^】@]+)@[^】]+】/g, '【$1】').replace(/\s+/g, ' ').trim();
  if (!text) text = files.map(file => file.reference || file.name).join('、') || '原消息';
  const letters = Array.from(text);
  return letters.length > 160 ? letters.slice(0, 159).join('') + '…' : text;
}
