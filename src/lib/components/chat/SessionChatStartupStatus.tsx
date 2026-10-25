import { useEffect, useState } from 'react';
import { LoaderCircle, TerminalSquare } from 'lucide-react';
import type { SessionChatStartup } from './sessionChatStartup';

export function SessionChatStartupStatus({ launch, interrupted, onTerminal }: { launch: SessionChatStartup; interrupted: boolean; onTerminal: () => void }) {
  const [slow, setSlow] = useState(Date.now() - launch.startedAt >= 12_000);
  useEffect(() => {
    const remaining = 12_000 - (Date.now() - launch.startedAt);
    if (remaining <= 0) { setSlow(true); return; }
    const timer = setTimeout(() => setSlow(true), remaining);
    return () => clearTimeout(timer);
  }, [launch.startedAt]);
  const message = launch.error || (interrupted ? '连接已中断，正在恢复…' : slow
    ? `${launch.agent.displayName} 尚未就绪，可查看终端中的启动提示。`
    : `正在启动 ${launch.agent.displayName}，可以先写下需求…`);
  return <div data-chat-startup data-chat-startup-state={launch.error ? 'error' : slow ? 'slow' : 'starting'} role="status" className="flex min-h-11 items-center gap-2 text-xs leading-5 text-muted-foreground">
    {!launch.error && !slow && <LoaderCircle size={13} className="shrink-0 animate-spin text-primary" />}
    <span className="min-w-0 flex-1">{message}</span>
    <button type="button" className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 hover:bg-surface-2" onClick={onTerminal}><TerminalSquare size={13} />查看终端</button>
  </div>;
}
