import { useState } from 'react';
import { Monitor } from 'lucide-react';
import type { ConnectionIntent } from '../lib/federation/browserIntegration';
import { canOpenDesktopInvitation, desktopInvitationUrl } from '../lib/services/desktopInvitation';

export function DesktopInvitationButton({ invitation, compact = false }: { invitation: ConnectionIntent; compact?: boolean }) {
  const [requested, setRequested] = useState(false);
  if (!canOpenDesktopInvitation()) return null;
  let href: string;
  try { href = desktopInvitationUrl(invitation); } catch { return null; }
  return <div className={compact ? 'text-xs' : 'space-y-2 text-center'}>
    <a href={href} onClick={() => setRequested(true)} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2 ${compact ? 'text-xs' : 'text-sm'} text-primary hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring ${compact ? '' : 'w-full border border-border'}`}><Monitor size={15} aria-hidden="true" />在客户端打开</a>
    {requested && <p role="status" className="text-xs leading-5 text-muted-foreground">未打开？<a href="https://github.com/Jovines/veymux/releases/latest" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">安装或更新 Mac 客户端</a></p>}
  </div>;
}
