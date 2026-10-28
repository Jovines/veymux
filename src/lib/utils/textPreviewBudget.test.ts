import { describe, expect, it } from 'vitest';
import { findTextPreviewMatches, needsBoundedTextPreview, textPreviewPageAt, textPreviewPages, textPreviewRows } from './textPreviewBudget';

describe('preview work budgets', () => {
  it.each(['\n'.repeat(12000), 'x'.repeat(1024 * 1024), '😀'.repeat(10000), 'a,b,c,d\n'.repeat(1000)])('bounds rows and losslessly pages text', content => {
    const pages = textPreviewPages(content);
    expect(pages.map(page => content.slice(page.start, page.end)).join('')).toBe(content);
    for (const page of pages) {
      const rows = textPreviewRows(content, page);
      expect(rows.length).toBeLessThanOrEqual(200);
      expect(rows.every(row => row.text.length <= 1000)).toBe(true);
      expect(textPreviewPageAt(pages, page.start)).toBe(pages.indexOf(page));
    }
  });
  it('keeps line identities across split long lines and pages', () => {
    const content = 'a\n' + 'x'.repeat(20000) + '\nlast';
    const pages = textPreviewPages(content);
    expect(textPreviewRows(content, pages[1])[0]).toMatchObject({ line: 2, continuation: true });
    expect(textPreviewRows(content, pages[1]).at(-1)).toMatchObject({ line: 3, text: 'last' });
  });
  it('budgets raw length, line count, line length and dense markup/tables', () => {
    expect(needsBoundedTextPreview('# Small\n\nhello')).toBe(false);
    for (const text of ['a\n'.repeat(1001), 'x'.repeat(4097), '|a|'.repeat(1001), 'a,'.repeat(2001)]) expect(needsBoundedTextPreview(text)).toBe(true);
  });
  it('searches literal patterns at original Unicode offsets and caps huge match lists', () => {
    expect(findTextPreviewMatches('İ x [a] [A]', '[a]').offsets).toEqual([4, 8]);
    expect(findTextPreviewMatches('x'.repeat(2000), 'x')).toMatchObject({ limited: true });
    expect(findTextPreviewMatches('x'.repeat(2000), 'x').offsets).toHaveLength(1000);
    expect(findTextPreviewMatches('hello', '(.*)+').offsets).toEqual([]);
  });
});
