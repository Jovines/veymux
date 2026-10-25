/** Message identifiers only; no read receipts or message bodies. */
export interface SessionChatIndex { conversationId: string; messageIds: string[]; viewedMessageIds?: string[] }
export interface SessionChatAttention {
  mode: boolean;
  index?: SessionChatIndex;
  unreadIds: string[];
}
