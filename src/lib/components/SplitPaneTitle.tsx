import { GripVertical, Share2, Terminal } from 'lucide-react';
import { useTerminalStore } from '../stores/useTerminalStore';
import { sessionOption, useSessionDirectory, useSessionDirectoryStore } from '../stores/useSessionDirectory';
import type { TerminalSessionInfo } from './MultiTerminalView';
import { SessionModeSwitch } from './chat/SessionModeSwitch';
import { SidebarVisibilityButton } from './sidebar/SidebarVisibilityButton';

/** Subscribe per pane so background title changes remain visible without focus. */
export function SplitPaneTitle({ session, active, onActivate, onToggleLeftSidebar, onToggleRightSidebar, rightSidebarOpen = false, onShareWorkspace }: {
  session: TerminalSessionInfo;
  active: boolean;
  onActivate: () => void;
  onToggleLeftSidebar?: () => void;
  onToggleRightSidebar?: () => void;
  rightSidebarOpen?: boolean;
  onShareWorkspace?: () => void;
}) {
  const directory = useSessionDirectory();
  const shellNames = useSessionDirectoryStore(state => state.shellNames);
  const fallbackTitle = useTerminalStore(store => sessionOption({ ...session,
    sessionId: session.id, lastActivity: 0 }, store.sessions.get(session.id), shellNames).displayName);
  const title = directory.find(record => record.sessionId === session.id)?.displayName ?? fallbackTitle;

  return (
    <div data-pane-titlebar="true" className="swiper-no-swiping flex h-6 min-h-6 shrink-0 items-center border-b border-border app-chrome-bg text-foreground">
    {onToggleLeftSidebar && <SidebarVisibilityButton side="left" expanded={false} onClick={onToggleLeftSidebar} className="h-full w-7 rounded-none" />}
    <button
      type="button"
      data-split-pane-title={session.id}
      draggable={false}
      onDragStart={event => event.preventDefault()}
      aria-pressed={active}
      title={`${title} · 拖动标题移动，边缘拆分，中央交换`}
      onClick={onActivate}
      className="split-pane-drag-handle flex h-full min-w-0 cursor-grab active:cursor-grabbing flex-1 items-center gap-1.5 overflow-hidden px-2 text-left text-[12px] font-medium leading-none hover:opacity-80 focus-visible:outline focus-visible:outline-1 focus-visible:outline-current focus-visible:-outline-offset-1"
    >
      <Terminal size={11} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <GripVertical size={12} aria-hidden="true" className="shrink-0 opacity-60" />
    </button>
    {onShareWorkspace && <button type="button" aria-label="分享此分屏" title="分享此分屏" className="inline-flex h-full w-7 shrink-0 items-center justify-center hover:opacity-80" onClick={onShareWorkspace}><Share2 size={13} /></button>}
    <SessionModeSwitch sessionId={session.id} share={false} compact onActivate={active ? undefined : onActivate} />
    {onToggleRightSidebar && (
      <SidebarVisibilityButton side="right" expanded={rightSidebarOpen} className="h-full w-7 rounded-none"
        onClick={() => { if (!active) onActivate(); onToggleRightSidebar(); }} />
    )}
    </div>
  );
}
