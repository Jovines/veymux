// Budgets apply before parsers and React trees are built, not after rendering.
export function needsBoundedTextPreview(content: string): boolean {
  if (content.length > 64 * 1024) return true;
  let lines = 1, lineLength = 0, markup = 0;
  for (let i = 0; i < content.length; i++) {
    const code = content.charCodeAt(i);
    if (code === 10) { if (++lines > 1000) return true; lineLength = 0; }
    else if (++lineLength > 4096) return true;
    if ('[]<>`|$*{},'.includes(content[i]) && ++markup > 2000) return true;
  }
  return false;
}

export interface TextPreviewPage { start: number; end: number; firstLine: number }
export function textPreviewPages(content: string): TextPreviewPage[] {
  const pages: TextPreviewPage[] = [];
  let start = 0, firstLine = 1, line = 1;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) line++;
    if (i + 1 - start >= 16_000 || line - firstLine >= 160) {
      // Do not split a UTF-16 surrogate pair between pages.
      if (content.charCodeAt(i) >= 0xd800 && content.charCodeAt(i) <= 0xdbff) continue;
      pages.push({ start, end: i + 1, firstLine }); start = i + 1; firstLine = line;
    }
  }
  if (start < content.length || !pages.length) pages.push({ start, end: content.length, firstLine });
  return pages;
}

export function textPreviewPageAt(pages: TextPreviewPage[], offset: number): number {
  let low = 0, high = pages.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (pages[mid].end <= offset) low = mid + 1; else high = mid;
  }
  return low;
}

export function textPreviewRows(content: string, page: TextPreviewPage) {
  const rows: Array<{ text: string; line: number; offset: number; continuation: boolean }> = [];
  let offset = page.start, line = page.firstLine;
  while (offset < page.end) {
    const newline = content.indexOf('\n', offset);
    let end = Math.min(page.end, offset + 1000, newline < 0 ? page.end : newline);
    if (end > offset && end < content.length && content.charCodeAt(end - 1) >= 0xd800 && content.charCodeAt(end - 1) <= 0xdbff) end--;
    rows.push({ text: content.slice(offset, end), line, offset, continuation: offset > 0 && content[offset - 1] !== '\n' });
    offset = end;
    if (offset < page.end && content[offset] === '\n') { offset++; line++; }
  }
  return rows;
}

export function findTextPreviewMatches(content: string, query: string) {
  const needle = query.trim().slice(0, 200);
  if (!needle) return { offsets: [] as number[], limited: false, length: 0 };
  // Literal regex preserves original offsets even for Unicode case mappings.
  const regex = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  const offsets: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content))) {
    if (offsets.length >= 1000) return { offsets, limited: true, length: needle.length };
    offsets.push(match.index);
  }
  return { offsets, limited: false, length: needle.length };
}
