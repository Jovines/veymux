/** Message identifiers only; no read receipts or message bodies. */
export interface SessionChatIndex { conversationId: string; messageIds: string[]; viewedMessageIds?: string[] }
export interface SessionChatAttention {
  mode: boolean;
  /** Conversation content, including a submitted message awaiting its receipt. */
  hasMessages?: boolean;
  index?: SessionChatIndex;
  unreadIds: string[];
}
