import { describe, expect, it } from 'vitest';
import { chatTurns, chatSendStatus, hasUnansweredMessage, hasReplyToLatestMessage, type ChatMessage } from './chatMessages';
const user: ChatMessage = { id: 'u', role: 'user', content: '问题', createdAt: 1, status: 'delivered' };
const reply = (id: string, responseKind: string): ChatMessage => ({ id, role: 'assistant', content: id, createdAt: 2, status: 'stored', replyTo: 'u', responseKind });
describe('chat reading and reply feedback', () => {
  it('distinguishes accepted requests, blocked delivery and actual terminal writes', () => {
    expect(chatSendStatus('pending')).toBe('发送中');
    expect(chatSendStatus('pending', { state: 'binding-required' })).toBe('等待恢复');
    expect(chatSendStatus('delivered', { state: 'binding-required' })).toBe('已发送');
    expect(chatSendStatus('failed')).toBe('发送失败');
  });
  it('groups adjacent assistant updates while preserving text, order, and user boundaries', () => {
    const messages = [user, reply('a1', 'progress'), reply('a2', 'result'), { ...user, id: 'u2' }, reply('a3', 'result')];
    const turns = chatTurns(messages);
    expect(turns.map(turn => turn.messages.map(message => message.id))).toEqual([['u'], ['a1', 'a2'], ['u2'], ['a3']]);
    expect(messages).toHaveLength(5);
  });
  it('keeps waiting through acknowledgments and progress until a matching final reply', () => {
    expect(hasUnansweredMessage([])).toBe(false);
    expect(hasUnansweredMessage([user])).toBe(true);
    expect(hasUnansweredMessage([user, reply('a1', 'ack'), reply('a2', 'progress')])).toBe(true);
    expect(hasUnansweredMessage([user, { ...reply('other', 'result'), replyTo: 'older' }])).toBe(true);
    expect(hasUnansweredMessage([user, reply('a3', 'result')])).toBe(false);
    expect(hasUnansweredMessage([{ ...user, status: 'failed' }])).toBe(false);
    expect(hasUnansweredMessage([user, reply('a3', 'result'), { ...user, id: 'next' }])).toBe(true);
  });
});


it('distinguishes the first reply from final completion without confusing older or legacy replies', () => {
  expect(hasReplyToLatestMessage([])).toBe(false);
  expect(hasReplyToLatestMessage([user])).toBe(false);
  expect(hasReplyToLatestMessage([user, reply('ack', 'ack')])).toBe(true);
  expect(hasReplyToLatestMessage([user, reply('progress', 'progress')])).toBe(true);
  expect(hasUnansweredMessage([user, reply('progress', 'progress')])).toBe(true);
  expect(hasReplyToLatestMessage([user, { ...reply('old', 'result'), replyTo: 'old-user' }])).toBe(false);
  expect(hasReplyToLatestMessage([user, { ...reply('legacy', 'result'), replyTo: undefined }])).toBe(true);
  expect(hasReplyToLatestMessage([user, reply('result', 'result'), { ...user, id: 'next' }])).toBe(false);
  expect(hasReplyToLatestMessage([user, { ...reply('streaming', 'progress'), ui: { version: 2, code: '', streaming: true } }])).toBe(true);
});
