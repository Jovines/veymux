import { createHash } from 'node:crypto';
import { Router } from 'express';
import type { CollaborationMessage, CollaborationStore } from './collaborationStore.js';
import { encryptedRequestSubject, hasEncryptedServiceAccess, isRestrictedChatRequest } from '../federation/requestContext.js';
import { chatPresentation } from '../shared/chatPresentation.js';
import { chatReplyExcerpt } from '../shared/chatReplyContext.js';
import { CollaborationError, hasUnconfirmedTerminalWrite } from './collaborationProtocol.js';
import { sessionChatHistory, sessionChatIndex } from './sessionChatHistory.js';
import { chatDelivery } from '../shared/chatDelivery.js';
/** Clients authorized to view this Session share its durable chat history.
 * Per-device delivery addresses remain stable for retries and explicit replies. */
export function sessionChatRoutes(options: {
  store: CollaborationStore;
  resolve(id: string): { sessionId: string; agent?: { slug?: string; displayName?: string } | null } | undefined;
  deliver(id: string): void;
  recover?: (id: string) => Promise<void>;
  canMention?: (source: string, target: string, groupId: string, req: import('express').Request) => boolean;
}) {
  const router = Router();
  const context = (req: import('express').Request) => {
    const session = options.resolve(String(req.params.sessionId));
    const subject = encryptedRequestSubject(req);
    if (!session || !subject) return null;
    const principal = `webchat-${createHash('sha256').update(subject).digest('hex').slice(0, 48)}`;
    return { session, principal };
  };
  router.get('/:sessionId/chat', (req, res) => {
    const ctx = context(req);
    if (!ctx) { res.status(404).json({ error: '会话不可用，请刷新连接' }); return; }
    const { messages: visible } = sessionChatHistory(options.store, ctx.session.sessionId);
    const paged = req.query.limit !== undefined;
    const limit = paged ? Number(req.query.limit) : 500;
    const before = req.query.before, after = req.query.after, around = req.query.around, requestId = req.query.requestId;
    if (paged && (typeof req.query.limit !== 'string' || !/^\d{1,2}$/.test(req.query.limit) || limit < 1 || limit > 60
      || before !== undefined && (typeof before !== 'string' || before.length > 128)
      || after !== undefined && (typeof after !== 'string' || after.length > 128)
      || around !== undefined && (typeof around !== 'string' || around.length > 128)
      || [before, after, around].filter(value => value !== undefined).length > 1
      || requestId !== undefined && (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(requestId)))) { res.status(400).json({ error: '对话分页参数无效' }); return; }
    const cursor = before ?? after ?? around;
    const anchor = cursor === undefined ? -1 : visible.findIndex(message => message.id === cursor);
    if (paged && cursor !== undefined && anchor < 0) { res.status(404).json({ error: '这段对话已不可用，请返回最新消息', code: 'CHAT_CURSOR_UNAVAILABLE' }); return; }
    const aroundStart = Math.max(0, anchor - (limit > 1 ? 1 : 0));
    const end = !paged || cursor === undefined ? visible.length : before !== undefined ? anchor : Math.min(visible.length, around !== undefined ? aroundStart + limit : anchor + 1 + limit);
    const start = paged && around !== undefined ? aroundStart : paged && after !== undefined ? anchor + 1 : Math.max(0, end - limit);
    const originals = new Map(visible.filter(message => !message.toPrincipalId).map(message => [message.id, message]));
    const replyContext = (message: CollaborationMessage) => {
      if (req.query.replyContext !== '1') return {};
      const original = message.toPrincipalId && message.replyTo ? originals.get(message.replyTo) : undefined;
      return original ? { replyContext: { id: original.id, text: chatReplyExcerpt(original.content), createdAt: original.createdAt } } : {};
    };
    const head = options.store.inbox(ctx.session.sessionId, { pendingOnly: true, limit: 1 })[0];
    const blocker = head ? { messageId: head.id, diagnostic: options.store.diagnostic(head.id) } : undefined;
    const project = (m: CollaborationMessage) => ({ id: m.id, role: m.toPrincipalId ? 'assistant' : 'user', ...(m.toPrincipalId ? chatPresentation(m.content, m.metadata) : { content: m.content, delivery: chatDelivery(m.status, options.store.diagnostic(m.id), ctx.session.sessionId, hasEncryptedServiceAccess(req), head?.id !== m.id ? blocker : undefined) }), ...(m.uiState ? { uiState: m.uiState } : {}), createdAt: m.createdAt, status: m.failureReason === 'DELIVERY_CANCELLED_BY_OWNER' ? 'cancelled' : m.status === 'read' ? 'delivered' : m.status, replyTo: m.replyTo, ...replyContext(m), requestId: m.idempotencyKey, responseKind: m.responseKind, ...(paged ? { sequence: m.sequence } : {}) });
    const messages = visible.slice(start, end).map(project);
    // Refresh only the small tail already displayed, including delivery and
    // form revisions, while fetching subsequent replies contiguously.
    const updates = paged && after !== undefined ? visible.slice(Math.max(0, anchor + 1 - limit), anchor + 1).map(project) : undefined;
    const page = paged ? { hasOlder: start > 0, hasNewer: end < visible.length, mode: before !== undefined ? 'before' : after !== undefined ? 'after' : around !== undefined ? 'around' : 'latest' } : undefined;
    let lastRequest: CollaborationMessage | undefined;
    for (let index = visible.length - 1; index >= 0; index--) if (!visible[index].toPrincipalId) { lastRequest = visible[index]; break; }
    const replyPending = !!lastRequest && !['failed', 'expired'].includes(lastRequest.status) && !visible.some(message => message.toPrincipalId && message.replyTo === lastRequest!.id && !chatPresentation(message.content, message.metadata).ui?.streaming && !['ack', 'progress'].includes(message.responseKind || ''));
    const confirmedRequestId = paged && typeof requestId === 'string' && visible.some(message => !message.toPrincipalId && message.idempotencyKey === requestId) ? requestId : undefined;
    const payload = { chatIndex: sessionChatIndex(options.store, ctx.session.sessionId), messages, ...(updates ? { updates } : {}), ...(page ? { page, replyPending, ...(confirmedRequestId ? { confirmedRequestId } : {}) } : {}), agentAvailable: !!ctx.session.agent, agent: ctx.session.agent ? { slug: ctx.session.agent.slug, displayName: ctx.session.agent.displayName || ctx.session.agent.slug } : null };
    const revision = createHash('sha256').update(JSON.stringify(payload)).digest('base64url');
    res.setHeader('Cache-Control', 'no-store');
    // A JSON acknowledgement works inside the encrypted transport and keeps
    // older clients compatible; no HTTP cache contains conversation bodies.
    res.json(req.query.revision === revision ? { unchanged: true, revision } : { ...payload, revision });
  });
  router.post('/:sessionId/chat/viewed', (req, res) => {
    const ctx = context(req), body = req.body;
    if (!ctx) { res.status(404).json({ error: '会话不可用' }); return; }
    if (!body || Object.keys(body).some(key => !['conversationId', 'messageIds'].includes(key))
      || typeof body.conversationId !== 'string' || body.conversationId.length > 128
      || !Array.isArray(body.messageIds) || body.messageIds.length > 100
      || body.messageIds.some((id: unknown) => typeof id !== 'string' || !id || id.length > 128)) { res.status(400).json({ error: '消息查看标记无效' }); return; }
    try {
      options.store.markSessionChatViewed(ctx.session.sessionId, body.conversationId, body.messageIds);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ chatIndex: sessionChatIndex(options.store, ctx.session.sessionId) });
    } catch (error) { res.status(error instanceof CollaborationError ? error.httpStatus : 500).json({ error: error instanceof Error ? error.message : '暂时无法同步查看状态' }); }
  });
  router.post('/:sessionId/chat/recover', async (req, res) => {
    const ctx = context(req);
    if (!ctx) { res.status(404).json({ error: '会话不可用' }); return; }
    if (!hasEncryptedServiceAccess(req)) { res.status(403).json({ error: '此分享入口不能恢复终端连接' }); return; }
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length) { res.status(400).json({ error: '恢复请求无效' }); return; }
    if (!options.recover) { res.status(503).json({ error: '服务暂不支持恢复连接' }); return; }
    try { await options.recover(ctx.session.sessionId); res.json({ ok: true }); }
    catch { res.status(409).json({ error: '暂时无法确认原终端，消息已保留。请查看终端中的会话。' }); }
  });
  router.post('/:sessionId/chat/:messageId/delivery', (req, res) => {
    const ctx = context(req), body = req.body;
    if (!ctx) { res.status(404).json({ error: '会话不可用' }); return; }
    if (!hasEncryptedServiceAccess(req)) { res.status(403).json({ error: '此分享入口不能处理投递结果' }); return; }
    if (!body || Object.keys(body).some(key => !['action', 'attempt', 'blockingMessageId'].includes(key))
      || body.blockingMessageId !== undefined && (typeof body.blockingMessageId !== 'string' || !body.blockingMessageId || body.blockingMessageId.length > 128)) { res.status(400).json({ error: '处理请求无效' }); return; }
    const message = options.store.getMessage(String(req.params.messageId));
    if (!message || message.toSessionId !== ctx.session.sessionId || message.integrationOrigin?.source !== 'session-chat') { res.status(404).json({ error: '消息不可用' }); return; }
    try {
      let targetId = message.id;
      if (body.blockingMessageId !== undefined) {
        const head = options.store.inbox(ctx.session.sessionId, { pendingOnly: true, limit: 1 })[0];
        const diagnostic = head && options.store.diagnostic(head.id);
        if (message.status !== 'pending' || !head || head.id !== body.blockingMessageId
          || !diagnostic?.last_error || diagnostic.last_error === 'DELIVERY_IN_PROGRESS' || !hasUnconfirmedTerminalWrite(diagnostic)) {
          res.status(409).json({ error: '投递状态已变化，请刷新后重试' }); return;
        }
        targetId = head.id;
      }
      options.store.resolveUnconfirmedDelivery(targetId, ctx.session.sessionId, body.action, body.attempt);
      options.deliver(ctx.session.sessionId); res.json({ ok: true });
    } catch (error) { res.status(error instanceof CollaborationError ? error.httpStatus : 500).json({ error: '投递状态已变化，请刷新后重试' }); }
  });
  router.put('/:sessionId/chat/:messageId/state', (req, res) => {
    const ctx = context(req), body = req.body;
    if (!ctx) { res.status(404).json({ error: '会话不可用' }); return; }
    if (!body || typeof body !== 'object' || Object.keys(body).some(key => !['revision', 'values'].includes(key))) { res.status(400).json({ error: '填写内容无效' }); return; }
    try { res.json(options.store.saveChatUIState(String(req.params.messageId), ctx.session.sessionId, body.values, body.revision)); }
    catch (error) { if (error instanceof CollaborationError) res.status(error.httpStatus).json({ error: error.message, ...error.details }); else res.status(500).json({ error: '暂时无法保存，填写内容已保留' }); }
  });
  router.post('/:sessionId/chat', (req, res) => {
    const ctx = context(req);
    if (!ctx) { res.status(404).json({ error: '会话不可用，请刷新连接' }); return; }
    if (!ctx.session.agent) { res.status(409).json({ error: '当前会话未识别到 Agent，请切换终端确认 Agent 已启动' }); return; }
    const body = req.body;
    if (!body || Object.keys(body).some(k => !['content', 'requestId'].includes(k)) || typeof body.content !== 'string' || !body.content.trim() || Buffer.byteLength(body.content) > 32000 || typeof body.requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(body.requestId)) { res.status(400).json({ error: '消息为空、过长或请求无效' }); return; }
    try {
      const marker = '```termdock-context\n', at = body.content.lastIndexOf(marker);
      if (at >= 0 && (at === 0 || body.content.slice(0, at).endsWith('\n\n')) && body.content.endsWith('\n```')) {
        // The metadata is user input, never authority. Narrow shares cannot
        // acquire contact access by submitting a hand-crafted draft.
        let mentions: unknown;
        try { mentions = JSON.parse(body.content.slice(at + marker.length, -4)).mentions; }
        catch { throw new CollaborationError('INVALID_MENTIONS', '提及信息无效，请重新选择会话', 400); }
        if (!Array.isArray(mentions)) throw new CollaborationError('INVALID_MENTIONS', '提及信息无效，请重新选择会话', 400);
        if (mentions.length && (!hasEncryptedServiceAccess(req) || mentions.some(mention => !mention
          || typeof mention.sessionId !== 'string' || typeof mention.groupId !== 'string'
          || !options.canMention?.(ctx.session.sessionId, mention.sessionId, mention.groupId, req)))) {
          throw new CollaborationError('SESSION_SCOPE_DENIED', '无权提及该会话；分享入口不开放协作发现与联系', 403);
        }
      }
      const restricted = isRestrictedChatRequest(req);
      const content = body.content.replace(/\r\n?/g, '\n').trim();
      if (restricted && (/[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(content) || content.startsWith('/'))) throw new CollaborationError('SHARED_CHAT_TEXT_REQUIRED', '此分享仅允许普通消息，不支持终端按键或 Agent 命令', 403);
      const group = options.store.ensureSessionChat(ctx.session.sessionId);
      const [message] = options.store.send({ groupId: group.id, fromSessionId: null, toSessionIds: [ctx.session.sessionId], kind: 'ask', content, ...(restricted ? { metadata: { chatOnly: true, chatSubject: encryptedRequestSubject(req) } } : {}), integrationOrigin: { integrationId: ctx.principal, source: 'session-chat' }, idempotencyKey: body.requestId, threadId: ctx.principal });
      options.deliver(ctx.session.sessionId);
      res.json({ id: message.id, status: message.status, createdAt: message.createdAt });
    } catch (error) { res.status(error instanceof CollaborationError ? error.httpStatus : 409).json({ error: error instanceof Error ? error.message : '发送失败，草稿已保留', ...(error instanceof CollaborationError ? { code: error.code } : {}) }); }
  });
  return router;
}
