import type { ChatReplyContext } from '../../../server/shared/chatReplyContext';
import type { ChatUI, ChatUIState } from '../../../server/shared/chatPresentation';
import type { ChatDelivery } from '../../../server/shared/chatDelivery';
export interface ChatMessage {
  id: string; role: 'user' | 'assistant'; content: string; createdAt: number; status: string;
  sequence?: number;
  replyTo?: string; replyContext?: ChatReplyContext; requestId?: string; responseKind?: string;
  ui?: ChatUI; uiState?: ChatUIState;
  delivery?: ChatDelivery;
}
export interface ChatTurn { id: string; role: ChatMessage['role']; messages: ChatMessage[] }
/** Adjacent assistant updates read as one turn, with a shared author and separate message actions. */
export function chatTurns(messages: ChatMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const message of messages) {
    const previous = turns[turns.length - 1];
    if (message.role === 'assistant' && previous?.role === 'assistant') previous.messages.push(message);
    else turns.push({ id: message.id, role: message.role, messages: [message] });
  }
  return turns;
}
/** This observes an unanswered message, never the Agent's internal activity. */
export function hasUnansweredMessage(messages: ChatMessage[]): boolean {
  const last = messages.slice().reverse().find(message => message.role === 'user');
  if (!last || ['failed', 'expired', 'cancelled'].includes(last.status)) return false;
  return !messages.some(message => message.role === 'assistant' && message.replyTo === last.id && !message.ui?.streaming && !['ack', 'progress'].includes(message.responseKind || ''));
}
/** First visible reply, including progress/streaming. An explicitly linked
 * older reply must not clear the latest question's waiting affordance. */
export function hasReplyToLatestMessage(messages: ChatMessage[]): boolean {
  const question = messages.slice().reverse().find(message => message.role === 'user');
  if (!question) return false;
  const index = messages.indexOf(question);
  return messages.some((message, at) => message.role === 'assistant'
    && (message.replyTo ? message.replyTo === question.id : at > index));
}
export function chatSendStatus(status: string, delivery?: ChatDelivery): string {
  if (status === 'pending' && delivery?.state === 'binding-required') return '等待恢复';
  if (status === 'pending' && delivery?.state === 'outcome-unknown') return '投递待确认';
  return ({ pending: '待投递', delivered: '已投递', stored: '已发送', failed: '发送失败', expired: '发送失败', cancelled: '已停止投递' }[status] || '待确认');
}

/** Merge overlapping cursor pages without moving or rebuilding unchanged rows. */
export function mergeChatMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(current.map(message => [message.id, message]));
  let changed = false;
  for (const message of incoming) {
    const old = byId.get(message.id);
    if (!old || JSON.stringify(old) !== JSON.stringify(message)) { byId.set(message.id, message); changed = true; }
  }
  return changed ? [...byId.values()].sort((a, b) => (a.sequence ?? a.createdAt) - (b.sequence ?? b.createdAt)) : current;
}
