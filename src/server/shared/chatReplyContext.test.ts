import { expect, it } from 'vitest';
import { chatReplyExcerpt } from './chatReplyContext';
it('keeps the actual question and removes transport metadata and a quoted previous message', () => {
  const content = '> Codex · 12:34\n> 之前的结果\n\n【图片1@context-001】\n这次的问题怎么处理？\n\n```termdock-context\n' + JSON.stringify({ attachments: [{ path: '/private/screenshot.png', name: '截图.png', reference: '图片1' }], mentions: [] }) + '\n```';
  expect(chatReplyExcerpt(content)).toBe('【图片1】 这次的问题怎么处理？');
  expect(chatReplyExcerpt(content)).not.toContain('/private/');
});
it('handles attachment-only questions, literal fences and long unicode text', () => {
  expect(chatReplyExcerpt('```termdock-context\n' + JSON.stringify({ attachments: [{ path: '/private/file.png', name: '截图.png', reference: '图片1' }], mentions: [] }) + '\n```')).toBe('图片1');
  expect(chatReplyExcerpt('解释这个代码：\n\n```termdock-context\nnot json\n```')).toBe('解释这个代码： ```termdock-context not json ```');
  expect(Array.from(chatReplyExcerpt('🙂'.repeat(200)))).toHaveLength(160);
});
