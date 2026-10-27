import { createContext, lazy, Suspense, useCallback, useContext, useState, type ReactNode } from 'react';
import { useSessionDirectory } from '../../stores/useSessionDirectory';
import { useTerminalStore } from '../../stores/useTerminalStore';
import { useSessionCapabilities, useShareAccess } from '../../federation/ShareAccessContext';
import { resolveMarkdownLocalLinkTarget, type MarkdownLocalLinkTarget } from '../markdown/MarkdownPreview';
import { ChatFilePreview } from './ChatFilePreview';

import { resolveTerminalPath } from '../../terminal/pathLinks';
import type { ChatAttachment } from './chatComposerContent';
const ContextPreview = lazy(() => import('./ChatContextPreview').then(module => ({ default: module.ChatContextPreview })));

const ChatFileNavigationContext = createContext<{
  filePath: string | null;
  open: (href: string) => void;
  openReference: (file: ChatAttachment) => void;
} | null>(null);
export const useChatFileNavigation = () => useContext(ChatFileNavigationContext);

/** Bind links to their conversation, including retained/offscreen workspaces. */
export function ChatFileNavigation({ sessionId, canWrite = true, active = true, children }: {
  sessionId: string; canWrite?: boolean; active?: boolean; children: ReactNode;
}) {
  const sessions = useSessionDirectory();
  const liveDirectory = useTerminalStore(state => {
    const session = state.sessions.get(sessionId);
    return session?.cwd || session?.directory;
  });
  const access = useShareAccess(), capabilities = useSessionCapabilities();
  const directory = access === undefined
    ? liveDirectory || sessions.find(session => session.sessionId === sessionId)?.cwd
    : access.directories?.[0]?.path;
  // Markdown resolves relative links beside a source file. Chat prose lives at cwd.
  const filePath = directory ? `${directory.replace(/\/$/, '')}/.veymux-chat.md` : null;
  const [target, setTarget] = useState<MarkdownLocalLinkTarget | null>(null);
  const [reference, setReference] = useState<ChatAttachment | null>(null);
  const openReference = useCallback((file: ChatAttachment) => {
    if (!active || !capabilities.has('resource.files')) return;
    const path = resolveTerminalPath(file.path, directory);
    if (!path || access !== undefined && !access.directories?.some(grant => {
      const root = grant.path.replace(/\/$/, '') || '/';
      return root === '/' || path === root || path.startsWith(`${root}/`);
    })) return;
    setTarget(null); setReference({ ...file, path });
  }, [active, capabilities, directory, access]);
  const open = useCallback((href: string) => {
    if (!active || !capabilities.has('resource.files')) return;
    const resolved = resolveMarkdownLocalLinkTarget(href, filePath, null);
    if (!resolved || resolved.directory) return;
    if (access !== undefined && !access.directories?.some(grant => {
      const root = grant.path.replace(/\/$/, '');
      return resolved.path === root || resolved.path.startsWith(`${root}/`);
    })) return;
    setReference(null); setTarget(resolved);
  }, [active, access, capabilities, filePath]);
  return <ChatFileNavigationContext.Provider value={{ filePath, open, openReference }}>
    {children}
    {active && reference && (reference.context?.kind === 'code' || reference.context?.kind === 'directory'
      ? <Suspense fallback={null}><ContextPreview key={`${reference.path}:${reference.reference ?? ''}`} file={reference} close={() => setReference(null)} open={openReference} /></Suspense>
      : <ChatFilePreview key={reference.path} path={reference.path} line={reference.context?.lines?.start} sessionId={sessionId} canWrite={canWrite && capabilities.has('session.input')} close={() => setReference(null)} />)}
    {active && target && <ChatFilePreview key={`${target.path}#${target.fragment ?? ''}`} path={target.path} fragment={target.fragment} rootPath={access?.directories?.find(grant => target.path.startsWith(`${grant.path.replace(/\/$/, '')}/`))?.path ?? null} sessionId={sessionId} canWrite={canWrite && capabilities.has('session.input')} close={() => setTarget(null)} />}
  </ChatFileNavigationContext.Provider>;
}
