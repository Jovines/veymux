// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import { useSidebarStore } from '../../stores/useSidebarStore';
import { LeftSidebar } from './LeftSidebar';
import { SIDEBAR_SCROLL_POSITION_KEY } from './useSidebarScrollPosition';

let rowTop = 700;
const rect = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: 280, width: 280, x: 0, y: top, toJSON() {} });
const props: ComponentProps<typeof LeftSidebar> = {
  isOpen: true, pinned: true, drawerWidthPx: 280,
  sessions: [{ id: 'one', name: 'Current session', mode: 'shell' }],
  activeSessionId: 'one', sessionStates: new Map(), splitWorkspaces: [],
  onClose: vi.fn(), onNewSession: vi.fn(), onCloseSession: vi.fn(),
  onSplitSession: vi.fn(), onCloseSplit: vi.fn(), onRemoveFromSplit: vi.fn(),
  onSetSplitLayout: vi.fn(), onReorderSplitWorkspace: vi.fn(), onRenameSplitWorkspace: vi.fn(),
  onCombineSplitSessions: vi.fn(), onReorderSessions: vi.fn(), onOpenSettings: vi.fn(),
};
const view = (overrides: Partial<typeof props> = {}) => (
  <I18nProvider><LeftSidebar {...props} {...overrides} /></I18nProvider>
);
const list = () => document.querySelector('.sidebar-session-primary')!.closest('.overflow-y-auto') as HTMLElement;

beforeEach(() => {
  localStorage.clear();
  rowTop = 700;
  Object.defineProperty(HTMLElement.prototype, 'getAnimations', { configurable: true, value: () => [] });
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: () => ({ cancel() {}, onfinish: null }) });
  useSidebarStore.setState({ groupByFolder: false, collapsedGroups: new Set() });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ locale: 'en', groups: [], agents: [], tasks: [] }) })));
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('overflow-y-auto') ? 400 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('sidebar-session-primary')) {
      const container = this.closest('.overflow-y-auto') as HTMLElement;
      return rect(100 + rowTop - (container?.scrollTop ?? 0), 36);
    }
    return rect(100, 400);
  });
});
afterEach(() => {
  cleanup();
  delete (HTMLElement.prototype as Partial<HTMLElement>).getAnimations;
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('active sidebar session visibility', () => {
  it('keeps the original avatar and pulse during work, using loading only for connection', () => {
    const state = { cwd: null, activeProgram: 'codex', agentStatus: 'working' as const,
      agent: { slug: 'codex', displayName: 'Codex', icon: 'codex', accentColor: 'var(--foreground)' } };
    const { rerender } = render(view({ sessionStates: new Map([['one', state]]) }));
    const row = () => document.querySelector('.sidebar-session-primary')!;
    expect(row().querySelector('[title="Codex"]')).not.toBeNull();
    expect(row().querySelector('.animate-spin')).toBeNull();
    expect(row().querySelector('.animate-pulse')).not.toBeNull();
    rerender(view({ sessionStates: new Map([['one', { ...state, agentStatus: 'idle', tuiProgress: {
      source: 'osc7501', state: 'indeterminate', progress: null, message: 'Native work',
    } }]]) }));
    expect(row().querySelector('[title="Codex"]')).not.toBeNull();
    expect(row().querySelector('.animate-spin')).toBeNull();
    expect(row().querySelector('[data-terminal-output-activity]')).toBeNull();
    rerender(view({ sessionStates: new Map([['one', { ...state, agentStatus: 'idle',
      chatAttention: { mode: true, hasMessages: true, unreadIds: [] }, tuiProgress: {
        source: 'osc7501', state: 'indeterminate', progress: null, message: 'Native work',
      } }]]) }));
    expect(row().querySelector('[data-terminal-output-activity]')).not.toBeNull();
    rerender(view({ sessionStates: new Map([['one', { ...state, isConnecting: true }]]) }));
    expect(row().querySelector('.animate-spin')).not.toBeNull();
  });

  it('keeps manual folder expansion and collapse in place, then follows an actual session change', () => {
    useSidebarStore.setState({groupByFolder:true,collapsedGroups:new Set(['/manual/other'])});
    const sessions=[{id:'two',name:'Other session',mode:'shell' as const},...props.sessions];
    const sessionStates=new Map([['two',{cwd:'/manual/other',activeProgram:null,agentStatus:null}],['one',{cwd:'/active',activeProgram:null,agentStatus:null}]]);
    const {rerender}=render(view({sessions,sessionStates}));
    list().scrollTop=0;
    rowTop=1000;
    fireEvent.click(document.querySelector('button[title="/manual/other"]')!);
    expect(list().scrollTop).toBe(0);
    rowTop=700;
    fireEvent.click(document.querySelector('button[title="/manual/other"]')!);
    expect(list().scrollTop).toBe(0);
    rerender(view({sessions,sessionStates,activeSessionId:'two'}));
    expect(list().scrollTop).toBeGreaterThan(0);
  });
  it('does not jump when a manually hidden active row is expanded again', () => {
    useSidebarStore.setState({groupByFolder:true,collapsedGroups:new Set()});
    const sessions=[{id:'two',name:'Other session',mode:'shell' as const},...props.sessions];
    const sessionStates=new Map([['two',{cwd:'/manual/other',activeProgram:null,agentStatus:null}],['one',{cwd:'/active',activeProgram:null,agentStatus:null}]]);
    render(view({sessions,sessionStates}));
    list().scrollTop=0;
    fireEvent.click(document.querySelector('button[title="/active"]')!);
    rowTop=1000;
    fireEvent.click(document.querySelector('button[title="/active"]')!);
    expect(list().scrollTop).toBe(0);
  });
  it('reveals the full row and follows late layout changes with unchanged session ID/count', () => {
    const { rerender } = render(view());
    expect(list().scrollTop).toBe(344);
    rowTop = 1000;
    rerender(view({ sessionStates: new Map([['one', { cwd: '/late/group', activeProgram: null, agentStatus: null }]]) }));
    expect(list().scrollTop).toBe(644);
    rowTop = 200;
    rerender(view());
    expect(list().scrollTop).toBe(192);
  });

  it('preserves manual scroll during status updates, then reveals the row on reopen', () => {
    const { rerender } = render(view({ pinned: false }));
    list().scrollTop = 0;
    rerender(view({ pinned: false, sessionStates: new Map([['one', { cwd: null, activeProgram: 'codex', agentStatus: 'working' }]]) }));
    expect(list().scrollTop).toBe(0);
    rerender(view({ pinned: false, isOpen: false }));
    rerender(view({ pinned: false }));
    expect(list().scrollTop).toBe(344);
  });

  it('waits for the selected session to arrive and does not move a visible row', () => {
    const { rerender } = render(view({ sessions: [] }));
    rowTop = 200;
    rerender(view());
    expect(list().scrollTop).toBe(0);
    rowTop = 700;
    rerender(view());
    expect(list().scrollTop).toBe(344);
  });

  it('defers layout work while the desktop panel is hidden, then reveals the active row on first opening', () => {
    const { rerender } = render(view({ isOpen: false }));
    expect(list().scrollTop).toBe(0);
    rerender(view());
    expect(list().scrollTop).toBe(344);
  });

  it('keeps manual desktop scrolling when the panel is collapsed and reopened', () => {
    const { rerender } = render(view());
    list().scrollTop = 100;
    rerender(view({ isOpen: false }));
    rerender(view());
    expect(list().scrollTop).toBe(100);
  });

  it('remembers manual scrolling across remounts when the active row remains visible', () => {
    const first = render(view());
    list().scrollTop = 500;
    fireEvent.scroll(list());
    list().scrollTop = 520;
    fireEvent.scroll(list());
    first.unmount();
    expect(JSON.parse(localStorage.getItem(SIDEBAR_SCROLL_POSITION_KEY)!)).toBe(520);
    render(view());
    expect(list().scrollTop).toBe(520);
  });

  it('adjusts a restored position only enough to reveal a selected row outside the viewport', () => {
    localStorage.setItem(SIDEBAR_SCROLL_POSITION_KEY, '100');
    render(view());
    expect(list().scrollTop).toBe(344);
  });

  it('keeps the saved position while sessions are loading, then restores it', () => {
    localStorage.setItem(SIDEBAR_SCROLL_POSITION_KEY, '520');
    const { rerender } = render(view({ sessions: [] }));
    fireEvent(window, new Event('pagehide'));
    expect(localStorage.getItem(SIDEBAR_SCROLL_POSITION_KEY)).toBe('520');
    rerender(view());
    expect(list().scrollTop).toBe(520);
  });

  it('flushes the latest scroll before refresh and workspace eviction', () => {
    render(view());
    list().scrollTop = 490;
    fireEvent.scroll(list());
    list().scrollTop = 510;
    fireEvent.scroll(list());
    fireEvent(window, new Event('pagehide'));
    expect(localStorage.getItem(SIDEBAR_SCROLL_POSITION_KEY)).toBe('510');
    list().scrollTop = 540;
    fireEvent.scroll(list());
    fireEvent(window, new Event('termdock:before-update'));
    expect(localStorage.getItem(SIDEBAR_SCROLL_POSITION_KEY)).toBe('540');
  });

  it('ignores invalid stored positions', () => {
    localStorage.setItem(SIDEBAR_SCROLL_POSITION_KEY, '"broken"');
    render(view());
    expect(list().scrollTop).toBe(344);
  });
});
