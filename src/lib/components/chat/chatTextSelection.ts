export interface ChatTextSelection {
  parts: { id: string; text: string }[];
  text: string;
}
const blocks = new Set(['DIV', 'SECTION', 'ARTICLE', 'P', 'BLOCKQUOTE', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'DL']);
const controls = 'button, input, textarea, select, svg, script, style, [hidden], [aria-hidden="true"], [inert], [data-chat-message-actions]';

/** Read only the selected body text. Traversing the existing DOM avoids
 * cloning media, and preserves paragraph/table boundaries across replies. */
function selectedText(node: Node, range: Range): string {
  if (!range.intersectsNode(node)) return '';
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    return text.slice(node === range.startContainer ? range.startOffset : 0, node === range.endContainer ? range.endOffset : text.length);
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const element = node as Element;
  if (element.matches(controls)) return '';
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (style?.display === 'none' || style?.visibility === 'hidden' || style?.userSelect === 'none') return '';
  if (element.tagName === 'BR') return '\n';
  const text = Array.from(node.childNodes, child => selectedText(child, range)).join('');
  if (!text) return '';
  if (element.tagName === 'TD' || element.tagName === 'TH') return `${text}\t`;
  if (element.tagName === 'TR' || element.tagName === 'LI' || element.tagName === 'DT' || element.tagName === 'DD') return `${text.trimEnd()}\n`;
  return blocks.has(element.tagName) ? `${text.trimEnd()}\n\n` : text;
}

export function readChatTextSelection(root: HTMLElement, selection: Selection | null): ChatTextSelection | null {
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const parts: ChatTextSelection['parts'] = [];
  for (const body of root.querySelectorAll<HTMLElement>('[data-chat-message-content]')) {
    const id = body.closest<HTMLElement>('[data-chat-message]')?.dataset.chatMessage;
    if (!id || !range.intersectsNode(body)) continue;
    const boundary = root.ownerDocument.createRange(); boundary.selectNodeContents(body);
    const clipped = range.cloneRange();
    if (range.compareBoundaryPoints(Range.START_TO_START, boundary) < 0) clipped.setStart(boundary.startContainer, boundary.startOffset);
    if (range.compareBoundaryPoints(Range.END_TO_END, boundary) > 0) clipped.setEnd(boundary.endContainer, boundary.endOffset);
    const text = selectedText(body, clipped).trim();
    if (text) parts.push({ id, text });
  }
  return parts.length ? { parts, text: parts.map(part => part.text).join('\n\n') } : null;
}
