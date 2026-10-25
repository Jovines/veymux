// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readDesktopSidebarOpen, useSidebarStore } from './useSidebarStore';
import { clampDesktopLeftSidebarWidth } from '../utils/sidebarLayout';
import { clampPinnedRightSidebarWidth } from './useSidebarStore';

let desktop = true;
beforeEach(() => {
  localStorage.clear();
  desktop = true;
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: desktop })));
  useSidebarStore.setState({ leftOpen: false, rightOpen: false, desktopLeftOpen: true, desktopRightOpen: false,
    rootPath: null, contextKey: null, rightSidebarWidthContextKey: null, initialRightSidebarStateBySession: new Map(),
    projectStateCache: new Map(), rootDataCache: new Map(), rightTab: 'files', rightSearchOpen: false, selectedFilePath: null });
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

describe('desktop sidebar visibility', () => {
  it('opens both panels independently and preserves content when collapsed', () => {
    const store = useSidebarStore.getState();
    store.setRootPath('/project', 'a');
    store.setRightTab('git');
    store.setRightSearchOpen(true);
    store.selectFile('/project/readme.md');
    store.setRightSidebarWidth(440);
    store.openRight();
    expect(useSidebarStore.getState()).toMatchObject({ desktopLeftOpen: true, desktopRightOpen: true, leftOpen: false, rightOpen: false });
    store.toggleRight();
    expect(useSidebarStore.getState()).toMatchObject({ desktopRightOpen: false, rightTab: 'git', rightSearchOpen: true, selectedFilePath: '/project/readme.md', rightSidebarWidth: 440 });
    store.toggleRight();
    store.toggleLeft();
    expect(useSidebarStore.getState()).toMatchObject({ desktopLeftOpen: false, desktopRightOpen: true });
    expect(readDesktopSidebarOpen('left')).toBe(false);
    expect(readDesktopSidebarOpen('right')).toBe(true);
  });

  it('ignores old per-session pin caches when switching directories, sessions and split workspaces', () => {
    localStorage.setItem('termdock:right-sidebar:pinned-by-session:v1', JSON.stringify({ data: { a: true, b: false } }));
    const store = useSidebarStore.getState();
    store.openRight();
    for (const [root, session, split] of [['/a','a',null], ['/b','b',null], ['/b','a','split-1'], ['/a','a',null]] as const) {
      store.setRootPath(root, session, split);
      expect(useSidebarStore.getState().desktopRightOpen).toBe(true);
    }
    store.closeRight();
    store.setRootPath('/b','b');
    expect(useSidebarStore.getState().desktopRightOpen).toBe(false);
    store.initializeRightSidebarForSession('new', '/new', { rightOpen: true, rightSidebarWidth: 480, rightTab: 'diff' });
    store.setRootPath('/new', 'new');
    expect(useSidebarStore.getState()).toMatchObject({ desktopRightOpen: false, rightSidebarWidth: 480, rightTab: 'diff' });
    store.inheritRightSidebarStateFromSplitWorkspace('split-1', [{ sessionId: 'a', rootPath: '/a' }]);
    expect(useSidebarStore.getState().desktopRightOpen).toBe(false);
  });

  it('opens terminal paths and search in the desktop panel without dismissing the navigator', () => {
    const store = useSidebarStore.getState();
    store.openTerminalPath({ path: '/a/file.md', kind: 'file' });
    store.openRightSearch();
    expect(useSidebarStore.getState()).toMatchObject({ desktopLeftOpen: true, desktopRightOpen: true, rightSearchOpen: true, rightOpen: false });
    store.closeAll();
    expect(useSidebarStore.getState()).toMatchObject({ desktopLeftOpen: true, desktopRightOpen: true, rightSearchOpen: true });
  });

  it('migrates explicit legacy choices once and lets new visibility choices win', () => {
    expect(readDesktopSidebarOpen('left')).toBe(true);
    expect(readDesktopSidebarOpen('right')).toBe(false);
    localStorage.setItem('termdock-left-sidebar-pinned', '0');
    localStorage.setItem('termdock-right-sidebar-pinned', '1');
    expect(readDesktopSidebarOpen('left')).toBe(false);
    expect(readDesktopSidebarOpen('right')).toBe(true);
    useSidebarStore.getState().setDesktopSidebarOpen('left', true);
    useSidebarStore.getState().setDesktopSidebarOpen('right', false);
    expect(readDesktopSidebarOpen('left')).toBe(true);
    expect(readDesktopSidebarOpen('right')).toBe(false);
  });

  it('keeps a usable workspace at the desktop breakpoint with both panels at maximum width', () => {
    const left = clampDesktopLeftSidebarWidth(500, 1024, true);
    const right = clampPinnedRightSidebarWidth(2000, 1024, left);
    expect(left).toBeGreaterThanOrEqual(200);
    expect(right).toBeGreaterThanOrEqual(320);
    expect(1024 - left - right - 10).toBeGreaterThanOrEqual(280);
  });
});

describe('temporary phone drawers', () => {
  it('keeps one drawer open and never changes persisted desktop preferences', () => {
    const store = useSidebarStore.getState();
    store.setDesktopSidebarOpen('right', true);
    desktop = false;
    store.openLeft();
    expect(useSidebarStore.getState()).toMatchObject({ leftOpen: true, rightOpen: false });
    store.openRight();
    expect(useSidebarStore.getState()).toMatchObject({ leftOpen: false, rightOpen: true });
    store.closeRight();
    store.toggleLeft();
    store.closeAll();
    expect(useSidebarStore.getState()).toMatchObject({ leftOpen: false, rightOpen: false, desktopLeftOpen: true, desktopRightOpen: true });
    expect(readDesktopSidebarOpen('right')).toBe(true);
    desktop = true;
    store.closeAll();
    expect(useSidebarStore.getState().desktopRightOpen).toBe(true);
  });

  it('opens a terminal file in the phone drawer and dismisses the opposite drawer', () => {
    desktop = false;
    const store = useSidebarStore.getState();
    store.openLeft();
    store.openTerminalPath({ path: '/project/file.md', kind: 'file' });
    expect(useSidebarStore.getState()).toMatchObject({ leftOpen: false, rightOpen: true, desktopRightOpen: false });
  });
});
