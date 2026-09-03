import { describe, expect, it, vi } from 'vitest';
import type { Terminal } from '@xterm/xterm';
import { createTerminalPathLinkProvider, findTerminalPathMatches, resolveTerminalPath } from './pathLinks';

describe('terminal path links', () => {
  it('finds absolute, home, and relative directory paths in terminal prose', () => {
    const line = 'cwd=/home/test/project/src/, then ./docs/ or packages/client/src';
    expect(findTerminalPathMatches(line).map((match) => match.text)).toEqual([
      '/home/test/project/src/',
      './docs/',
      'packages/client/src',
    ]);
  });

  it('leaves web URLs to WebLinksAddon and ignores prose with isolated slashes', () => {
    const line = 'visit https://example.com/docs/ or choose yes/no';
    expect(findTerminalPathMatches(line)).toEqual([]);
  });

  it('keeps shell-escaped spaces and excludes trailing prose punctuation', () => {
    const line = 'directory: ./My\\ Folder/assets/, next';
    expect(findTerminalPathMatches(line)).toEqual([{
      text: './My\\ Folder/assets/',
      startIndex: 11,
      endIndex: 31,
    }]);
  });

  it('resolves relative, parent, absolute, and home paths from the session cwd', () => {
    expect(resolveTerminalPath('src/lib/', '/home/test/project')).toBe('/home/test/project/src/lib');
    expect(resolveTerminalPath('../shared/', '/home/test/project')).toBe('/home/test/shared');
    expect(resolveTerminalPath('/tmp/demo/', '/home/test/project')).toBe('/tmp/demo');
    expect(resolveTerminalPath('~/Downloads/', '/home/test/project')).toBe('/home/test/Downloads');
    expect(resolveTerminalPath('./My\\ Folder/', '/home/test/project')).toBe('/home/test/project/My Folder');
  });

  it('keeps a link range intact when a directory path wraps across buffer lines', () => {
    const makeLine = (text: string, isWrapped: boolean) => ({
      isWrapped,
      length: text.length,
      getCell: (column: number) => ({
        getWidth: () => 1,
        getChars: () => text[column] ?? '',
      }),
    });
    const lines = [
      makeLine('open /home/test/vscode/', false),
      makeLine('web-terminal/src/ now', true),
    ];
    const terminal = {
      buffer: { active: { length: lines.length, getLine: (index: number) => lines[index] } },
    } as unknown as Terminal;
    const activated = vi.fn();
    const provider = createTerminalPathLinkProvider(terminal, activated);

    provider.provideLinks(2, (links) => {
      expect(links).toHaveLength(1);
      expect(links?.[0]?.text).toBe('/home/test/vscode/web-terminal/src/');
      expect(links?.[0]?.range).toEqual({
        start: { x: 6, y: 1 },
        end: { x: 17, y: 2 },
      });
      links?.[0]?.activate({} as MouseEvent, links[0].text);
    });
    expect(activated).toHaveBeenCalledWith('/home/test/vscode/web-terminal/src/');
  });
});
