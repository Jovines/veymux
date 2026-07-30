import { describe, expect, it } from 'vitest';
import { escapeShellPath } from './shellPath';

describe('escapeShellPath', () => {
  it('keeps ordinary absolute paths unquoted', () => {
    expect(escapeShellPath('/Users/guest/project/src')).toBe('/Users/guest/project/src');
  });

  it('escapes shell-significant characters individually', () => {
    expect(escapeShellPath('/Users/guest/My Folder/$draft (1).txt'))
      .toBe('/Users/guest/My\\ Folder/\\$draft\\ \\(1\\).txt');
  });

  it('keeps non-ASCII filenames readable', () => {
    expect(escapeShellPath('/Users/guest/桌面/终端 截图.png'))
      .toBe('/Users/guest/桌面/终端\\ 截图.png');
  });

  it('escapes quotes, glob characters, and backslashes', () => {
    expect(escapeShellPath('/tmp/a\'b"c*[x]\\d'))
      .toBe('/tmp/a\\\'b\\"c\\*\\[x\\]\\\\d');
  });
});
