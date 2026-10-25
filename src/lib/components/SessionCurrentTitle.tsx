import type { HTMLAttributes, ReactNode } from 'react';

/** The active Session owns this header; paging never renders adjacent titles. */
export function SessionCurrentTitle({ sessionId, name, icon, quota, status, mobile, copyMode = false, labelProps }: {
  sessionId?: string; name: string; icon?: ReactNode; quota?: ReactNode; status?: ReactNode;
  mobile: boolean; copyMode?: boolean; labelProps?: HTMLAttributes<HTMLDivElement>;
}) {
  return <div data-session-current-title={sessionId ?? ''} className={mobile
    ? 'flex h-full min-h-0 min-w-0 flex-1 flex-col justify-center gap-0 px-1 py-1'
    : 'absolute left-1/2 flex max-w-[40%] min-w-0 -translate-x-1/2 items-center justify-center gap-1.5 overflow-hidden'}>
    <div {...labelProps} data-session-current-label className="flex min-h-4 min-w-0 shrink-0 items-center gap-1.5">
      {icon}<span title={name} className={`min-w-0 truncate text-[12px] font-medium leading-4 ${copyMode ? 'text-[color:var(--tmux)]' : 'text-foreground'}`}>{name}</span>{status}
    </div>
    {quota && <div data-session-current-quota className="flex shrink-0 items-center empty:hidden">{quota}</div>}
  </div>;
}
