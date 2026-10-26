export interface ChatDisplayCutoff { at: number; ids: string[] }
export function chatDisplayCutoff(messages: Array<{ id: string; createdAt: number }>): ChatDisplayCutoff | null {
  if (!messages.length) return null;
  const at = Math.max(...messages.map(message => message.createdAt));
  return { at, ids: messages.filter(message => message.createdAt === at).map(message => message.id) };
}
export function visibleChatMessages<T extends { id: string; createdAt: number }>(messages: T[], cutoff: ChatDisplayCutoff | null): T[] {
  return cutoff ? messages.filter(message => message.createdAt > cutoff.at || message.createdAt === cutoff.at && !cutoff.ids.includes(message.id)) : messages;
}
export function readChatDisplayCutoff(key: string): ChatDisplayCutoff | null {
  try {
    const value = JSON.parse(localStorage.getItem(key + ':display-cutoff') || 'null');
    return value && Number.isSafeInteger(value.at) && Array.isArray(value.ids) && value.ids.every((id: unknown) => typeof id === 'string') ? value : null;
  } catch { return null; }
}
