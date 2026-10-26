import type { ShareResources } from '../../server/shared/shareResources';

export type SessionCapability = 'session.view' | 'session.input' | 'session.resize'
  | 'session.chat-view' | 'session.chat-send' | 'session.terminal-view' | 'session.chat-clear'
  | 'session.owner-menu' | 'session.share' | 'todo.guidance'
  | 'resource.android' | 'resource.computer' | 'resource.files' | 'collaboration.mention';
export type SessionCapabilities = ReadonlySet<SessionCapability>;
export const NO_SESSION_CAPABILITIES: SessionCapabilities = new Set();
/** Only the full service UI receives owner capabilities. Never use in a shared view. */
export const SERVICE_SESSION_CAPABILITIES: SessionCapabilities = new Set<SessionCapability>([
  'session.view', 'session.input', 'session.resize', 'session.owner-menu', 'session.share', 'todo.guidance',
  'session.chat-view', 'session.chat-send', 'session.terminal-view', 'session.chat-clear',
  'resource.android', 'resource.computer', 'resource.files', 'collaboration.mention',
]);
export function sharedResourceTabs(resources: ShareResources): Array<'android' | 'computer' | 'files'> {
  const tabs: Array<'android' | 'computer' | 'files'> = [];
  if (resources.android?.length) tabs.push('android');
  if (resources.computers?.length) tabs.push('computer');
  if (resources.directories?.length) tabs.push('files');
  return tabs;
}
/** Positive allowlist from the authenticated session-list and resource grants.
 * Unknown/new features are never inherited by shared sessions, even with input rights. */
export function sharedSessionCapabilities(session: { canWrite?: boolean; canResize?: boolean; canViewChat?: boolean; canViewTerminal?: boolean; canSendChat?: boolean; canClearChat?: boolean } | undefined, resources: ShareResources = {}): SessionCapabilities {
  const allowed = new Set<SessionCapability>();
  if (session) allowed.add('session.view');
  if (session && session.canViewChat !== false) allowed.add('session.chat-view');
  if (session && session.canViewTerminal !== false) allowed.add('session.terminal-view');
  if (session?.canSendChat === true || session?.canSendChat === undefined && session?.canWrite === true) allowed.add('session.chat-send');
  if (session?.canClearChat === true) allowed.add('session.chat-clear');
  if (session?.canWrite === true) allowed.add('session.input');
  if (session?.canResize === true) allowed.add('session.resize');
  for (const tab of sharedResourceTabs(resources)) allowed.add(`resource.${tab}`);
  return allowed;
}
