// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { readChatTextSelection } from './chatTextSelection';
afterEach(() => { window.getSelection()?.removeAllRanges(); document.body.replaceChildren(); });
function setup() {
  const root = document.createElement('section');
  root.innerHTML = '<article data-chat-message="a"><div data-chat-message-content><p>前缀第一段</p><p>第二段<strong>加粗</strong></p><button>表单提交</button><div hidden>隐藏内容</div></div><div data-chat-message-actions>复制回复 23:45</div></article><p>Agent 标题</p><article data-chat-message="b"><div data-chat-message-content><p>末段后缀</p></div><div data-chat-message-actions>引用消息 23:47</div></article>';
  const outside = document.createElement('p'); outside.textContent = '会话外'; document.body.append(root, outside);
  const selection = window.getSelection()!, range = document.createRange();
  const first = root.querySelector('p')!.firstChild!, last = root.querySelector('[data-chat-message="b"] p')!.firstChild!;
  range.setStart(first, 2); range.setEnd(last, 2); selection.addRange(range);
  return { root, selection, range, outside };
}
it('clips partial endpoints, preserves paragraphs and ignores message chrome, controls and hidden content', () => {
  const { root, selection } = setup();
  expect(readChatTextSelection(root, selection)).toEqual({ parts: [{ id: 'a', text: '第一段\n\n第二段加粗' }, { id: 'b', text: '末段' }], text: '第一段\n\n第二段加粗\n\n末段' });
});
it('rejects selections crossing the conversation boundary or collapsed to a caret', () => {
  const { root, range, selection, outside } = setup();
  range.setEnd(outside.firstChild!, 1);
  expect(readChatTextSelection(root, selection)).toBeNull();
  range.selectNodeContents(root.querySelector('p')!); range.collapse(true);
  expect(readChatTextSelection(root, selection)).toBeNull();
});
it('only quotes the selected table cells and preserves their column/row separators', () => {
  const { root, selection, range } = setup();
  const body = root.querySelector('[data-chat-message-content]')!;
  body.innerHTML = '<table><tbody><tr><td>A</td><td>12</td></tr><tr><td>B</td><td>34</td></tr></tbody></table>';
  range.selectNodeContents(body); selection.removeAllRanges(); selection.addRange(range);
  expect(readChatTextSelection(root, selection)?.text).toBe('A\t12\nB\t34');
});
it('reads selections in a retained service document using that document’s DOM realm', () => {
  const frame = document.createElement('iframe'); document.body.append(frame);
  const doc = frame.contentDocument!, root = doc.createElement('section');
  root.innerHTML = '<div data-chat-message="frame"><div data-chat-message-content><p>服务页面正文</p></div></div>'; doc.body.append(root);
  const range = doc.createRange(); range.selectNodeContents(root.querySelector('p')!);
  const selection = doc.getSelection()!; selection.addRange(range);
  expect(readChatTextSelection(root, selection)?.parts).toEqual([{ id: 'frame', text: '服务页面正文' }]);
});
