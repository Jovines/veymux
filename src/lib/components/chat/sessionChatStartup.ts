import { create } from 'zustand';
import { savedConnection } from '../../federation/browserIntegration';
import type { ChatStartupAgent } from '../../../server/shared/chatProgramPolicy';

/** Presentation of our explicit launch request, never a second session directory. */
export interface SessionChatStartup { agent: ChatStartupAgent; startedAt: number; error?: string }
const state = create<{ launches: Record<string, SessionChatStartup | undefined> }>(() => ({ launches: {} }));
const key = (id: string) => `termdock:chat-startup:${savedConnection()?.targetPeerId || location.origin}:${id}`;
function cached(id: string): SessionChatStartup | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(key(id)) || 'null');
    return value && typeof value.startedAt === 'number' && Date.now() - value.startedAt < 120_000 && typeof value.agent?.displayName === 'string'
      ? { agent: { displayName: value.agent.displayName, ...(typeof value.agent.slug === 'string' ? { slug: value.agent.slug } : {}) }, startedAt: value.startedAt, ...(typeof value.error === 'string' ? { error: value.error } : {}) } : undefined;
  } catch { return undefined; }
}
export function beginSessionChatStartup(id: string, agent: ChatStartupAgent): void {
  const value = { agent, startedAt: Date.now() };
  state.setState(current => ({ launches: { ...current.launches, [key(id)]: value } }));
  try { sessionStorage.setItem(key(id), JSON.stringify(value)); } catch { /* Optional reload recovery. */ }
}
export function failSessionChatStartup(id: string): void {
  const launch = state.getState().launches[key(id)] ?? cached(id);
  if (launch) {
    const value = { ...launch, error: '启动命令未能发送，请打开终端检查后重试。' };
    state.setState(current => ({ launches: { ...current.launches, [key(id)]: value } }));
    try { sessionStorage.setItem(key(id), JSON.stringify(value)); } catch { /* Optional cache. */ }
  }
}
export function finishSessionChatStartup(id: string): void {
  state.setState(current => ({ launches: { ...current.launches, [key(id)]: undefined } }));
  try { sessionStorage.removeItem(key(id)); } catch { /* Optional cache. */ }
}
export function useSessionChatStartup(id: string): SessionChatStartup | undefined {
  return state(current => current.launches[key(id)]) ?? cached(id);
}
